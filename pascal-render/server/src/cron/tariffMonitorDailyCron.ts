// ============================================================================
// CRON — Daily Tariff Monitor (06:00 America/Los_Angeles)
// Pulls the past 24 hours of tariff-relevant documents from the Federal
// Register API (no key required), Anthropic summarizes each into a
// client-friendly one-liner + rate-delta guess if possible, and writes them
// into tariff_updates for the border-intel widget. Any severity >= 'medium'
// also lands as a pending draft under agent2_compliance so Roger can push a
// heads-up to affected clients.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

interface FrDoc {
  title: string;
  abstract: string | null;
  document_number: string;
  publication_date: string;
  html_url: string;
  agencies: { name: string }[];
}

async function fetchFederalRegister(): Promise<FrDoc[]> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  // conditions[term] search across "tariff" — the FR API OR-joins terms.
  const url = `https://www.federalregister.gov/api/v1/documents.json?conditions[term]=tariff&conditions[publication_date][gte]=${since}&per_page=20&order=newest`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Federal Register API returned ${res.status}`);
  const data = await res.json() as { results?: FrDoc[] };
  return data.results ?? [];
}

// tariff_updates schema constrains:
//   direction ∈ ('US_TO_CA','CA_TO_US','US_INBOUND','CA_INBOUND','BILATERAL')
//   severity  ∈ ('critical','notice','info')
//   hs_code is NOT NULL — we default to 'UNSPECIFIED' when the doc doesn't name one.
type TariffDirection = "US_TO_CA" | "CA_TO_US" | "US_INBOUND" | "CA_INBOUND" | "BILATERAL";
type TariffSeverity = "critical" | "notice" | "info";
interface Summarized {
  headline: string;
  summary: string;
  hsCode: string;
  hsDescription: string | null;
  direction: TariffDirection;
  mechanism: string;
  rateOld: number | null;
  rateNew: number | null;
  rateDeltaPct: number | null;
  effectiveDate: string | null;
  severity: TariffSeverity;
}

const DIRECTIONS: TariffDirection[] = ["US_TO_CA", "CA_TO_US", "US_INBOUND", "CA_INBOUND", "BILATERAL"];
const SEVERITIES: TariffSeverity[] = ["critical", "notice", "info"];

async function summarize(doc: FrDoc): Promise<Summarized> {
  const fallback: Summarized = {
    headline: doc.title.slice(0, 300),
    summary: (doc.abstract ?? doc.title).slice(0, 1500),
    hsCode: "UNSPECIFIED",
    hsDescription: null,
    direction: "US_INBOUND",
    mechanism: doc.agencies[0]?.name ?? "unknown",
    rateOld: null,
    rateNew: null,
    rateDeltaPct: null,
    effectiveDate: null,
    severity: "info",
  };
  if (!client) return fallback;

  const prompt = `Federal Register document:
Title: ${doc.title}
Abstract: ${doc.abstract ?? "(none)"}
Agencies: ${doc.agencies.map((a) => a.name).join(", ")}
Published: ${doc.publication_date}
URL: ${doc.html_url}

Extract as JSON only:
{
  "headline": "one-sentence client-facing headline",
  "summary": "2-3 sentence plain-English summary of what changed and who is affected",
  "hsCode": "HS/HTS code if named (10-digit or shorter), else the string UNSPECIFIED",
  "hsDescription": "goods description if named, else null",
  "direction": "one of US_TO_CA, CA_TO_US, US_INBOUND, CA_INBOUND, BILATERAL (pick the best fit — most Federal Register items affecting US importers are US_INBOUND)",
  "mechanism": "ordinary duty | Section 232 | Section 301 | ADD/CVD | quota | retaliatory tariff | other",
  "rateOld": numeric percent old rate or null,
  "rateNew": numeric percent new rate or null,
  "rateDeltaPct": numeric delta or null,
  "effectiveDate": "YYYY-MM-DD or null",
  "severity": "one of critical, notice, info — critical if rate change >5pp OR broad goods category OR imminent effective date; notice if named change with modest impact; info otherwise"
}`;
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<Summarized>;
    const direction = DIRECTIONS.includes(parsed.direction as TariffDirection) ? (parsed.direction as TariffDirection) : "US_INBOUND";
    const severity = SEVERITIES.includes(parsed.severity as TariffSeverity) ? (parsed.severity as TariffSeverity) : "info";
    return {
      headline: String(parsed.headline ?? doc.title).slice(0, 300),
      summary: String(parsed.summary ?? doc.abstract ?? "").slice(0, 1500),
      hsCode: parsed.hsCode ? String(parsed.hsCode).slice(0, 40) : "UNSPECIFIED",
      hsDescription: parsed.hsDescription ? String(parsed.hsDescription) : null,
      direction,
      mechanism: parsed.mechanism ? String(parsed.mechanism) : "unknown",
      rateOld: typeof parsed.rateOld === "number" ? parsed.rateOld : null,
      rateNew: typeof parsed.rateNew === "number" ? parsed.rateNew : null,
      rateDeltaPct: typeof parsed.rateDeltaPct === "number" ? parsed.rateDeltaPct : null,
      effectiveDate: parsed.effectiveDate ? String(parsed.effectiveDate) : null,
      severity,
    };
  } catch {
    return fallback;
  }
}

async function main() {
  const docs = await fetchFederalRegister();
  console.log(`Federal Register: ${docs.length} tariff-related documents in past 24h.`);
  if (docs.length === 0) return;

  let inserted = 0;
  let escalated = 0;

  for (const doc of docs) {
    // Dedupe by external_ref (Federal Register document_number) — table has
    // a UNIQUE constraint on external_ref if set up right, but we double-
    // check here so a re-run doesn't spam.
    const existing = await pool.query(`SELECT id FROM tariff_updates WHERE external_ref = $1`, [doc.document_number]);
    if ((existing.rowCount ?? 0) > 0) continue;

    const s = await summarize(doc);
    await pool.query(
      `INSERT INTO tariff_updates
         (external_ref, hs_code, hs_description, direction, mechanism, headline, summary,
          old_rate, new_rate, rate_delta_pct, effective_date, source_url, severity, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        doc.document_number, s.hsCode, s.hsDescription, s.direction, s.mechanism,
        s.headline, s.summary, s.rateOld, s.rateNew, s.rateDeltaPct,
        s.effectiveDate, doc.html_url, s.severity, doc.publication_date,
      ],
    );
    inserted += 1;

    // Any critical / notice severity item → draft under Compliance for
    // Roger to push to affected clients. 'info' items land in tariff_updates
    // for the border-intel widget but don't wake anyone up.
    if (s.severity === "critical" || s.severity === "notice") {
      const payload = {
        inbound: {
          fromEmail: "federalregister@govinfo.gov",
          fromName: "Federal Register",
          subject: s.headline,
          body: `${s.summary}\n\nSource: ${doc.html_url}`,
        },
        output: {
          category: "operational",
          priority: s.severity === "critical" ? "urgent" : "normal",
          summary: `${s.mechanism} change${s.hsCode ? ` on HS ${s.hsCode}` : ""}${s.effectiveDate ? ` effective ${s.effectiveDate}` : ""} — ${s.headline}`,
          suggestedActions: [
            "Identify affected clients (query shipments by HS code)",
            "Draft client heads-up email",
            "Update border-intel widget if not auto-refreshed",
          ],
          draftResponseSubject: `Tariff change alert: ${s.headline}`,
          draftResponseBody: `Hi team,\n\nA change came through in the Federal Register today that likely affects clients importing under HS ${s.hsCode ?? "[not specified]"}:\n\n${s.summary}\n\nEffective: ${s.effectiveDate ?? "see notice"}\nOld rate: ${s.rateOld ?? "n/a"}%\nNew rate: ${s.rateNew ?? "n/a"}%\nMechanism: ${s.mechanism}\n\nWe'll flag this into your entry docs and coordinate with your broker on file.\n\nSource: ${doc.html_url}\n\n— Roger, Pascal Logistics`,
          simulated: !client,
        },
      };
      await pool.query(
        `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
         VALUES ('agent2_compliance', 'tariff_alert', 'operational', $1, $2, $3::jsonb)`,
        [s.headline, `federal_register:${doc.document_number}`, JSON.stringify(payload)],
      );
      escalated += 1;
    }
  }

  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = $1, updated_at = now()
     WHERE agent_key = 'agent2_compliance'`,
    [`tariff_monitor: ${inserted} inserted, ${escalated} escalated`],
  );
  console.log(`Tariff monitor: ${inserted} inserted into tariff_updates, ${escalated} escalated to Compliance review queue.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Tariff monitor cron failed:", err);
    process.exit(1);
  });
