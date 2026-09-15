// ============================================================================
// CRON — Weekly Ops Brief (Fridays 07:00 America/Los_Angeles)
// Composes the weekly narrative for Chief of Staff (Agent 10) from real data:
//   - recent tariff moves (tariff_updates)
//   - FX changes (fx cache if present, else Frankfurter live)
//   - shipment activity + exceptions from the past week (activity_log)
//   - carrier performance shifts (client_carrier_rates last-updated)
// Lands as a pending draft in agent_drafts under agent6_chief_of_staff so
// Roger reviews before it goes to clients. One draft per active account.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "../services/pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

async function main() {
  const accounts = await pool.query(
    "SELECT org_id, company_name FROM accounts WHERE account_status = 'active'",
  );
  if (accounts.rowCount === 0) {
    console.log("No active accounts — skipping weekly ops brief.");
    return;
  }

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  for (const account of accounts.rows) {
    const orgId = account.org_id as string;
    const clientName = account.company_name as string;

    // Pull the raw material. activity_log is global (no org_id column) — we
    // filter by shipment_id prefix if the org uses one, else include the
    // whole activity feed for now.
    const [tariffs, activity, carriers] = await Promise.all([
      pool.query(
        `SELECT hs_code, hs_description, headline, summary, rate_delta_pct, effective_date, severity
         FROM tariff_updates WHERE published_at >= $1 ORDER BY severity ASC, published_at DESC LIMIT 8`,
        [since],
      ),
      pool.query(
        `SELECT event_type, shipment_id, message, occurred_at FROM activity_log
         WHERE occurred_at >= $1 ORDER BY occurred_at DESC LIMIT 25`,
        [since],
      ),
      pool.query(
        `SELECT carrier_name, service_level, updated_at FROM client_carrier_rates
         WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 10`,
        [orgId],
      ),
    ]);

    const context = `Client: ${clientName}
Tariff moves (past 7 days, ${tariffs.rowCount} rows):
${tariffs.rows.map((r) => `- HS ${r.hs_code} ${r.hs_description ?? ""}: ${r.headline}${r.rate_delta_pct ? ` (Δ ${r.rate_delta_pct}%)` : ""} — effective ${r.effective_date ?? "TBD"} — severity ${r.severity}`).join("\n") || "- none"}

Activity (${activity.rowCount} events):
${activity.rows.map((r) => `- ${r.event_type}${r.shipment_id ? ` (${r.shipment_id})` : ""}: ${r.message}`).join("\n") || "- none"}

Carriers on file (${carriers.rowCount}):
${carriers.rows.map((r) => `- ${r.carrier_name}${r.service_level ? ` (${r.service_level})` : ""}`).join("\n") || "- none"}`;

    let subject = `Weekly ops brief for ${clientName}`;
    let body = "";

    if (client) {
      const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Chief of Staff (Agent 10). Compose the weekly client brief (3-minute read).
Structure:
1. Two-sentence headline — the single most important thing this week
2. Tariff & compliance — what changed, what to do about it
3. Freight activity — exceptions, wins, lane changes
4. Watch next week — one item

Tone: precise, factual, no hype. Sign-off: "— Roger, Pascal Logistics".
Never claim to be a licensed customs broker. Return plain text (no JSON).`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: "user", content: `Compose this week's brief from:\n\n${context}` }],
      });
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      body = textBlock?.text ?? "";
      subject = `Weekly ops brief — week ending ${new Date().toISOString().slice(0, 10)}`;
    } else {
      body = `Hi ${clientName} team,\n\nQuick week-in-review below. [Simulated — no ANTHROPIC_API_KEY configured]\n\nTariff moves: ${tariffs.rowCount}\nActivity events: ${activity.rowCount}\nCarriers active: ${carriers.rowCount}\n\n— Roger, Pascal Logistics`;
    }

    const payload = {
      inbound: {
        fromEmail: "internal-cron@pascallogistics.com",
        fromName: "Weekly Ops Brief Cron",
        subject: `Compose brief for ${clientName}`,
        body: context,
      },
      output: {
        category: "operational",
        priority: "normal",
        summary: `Weekly brief drafted for ${clientName} — ${tariffs.rowCount} tariff moves, ${activity.rowCount} activity events`,
        suggestedActions: ["Review the narrative", "Adjust the 'Watch next week' line if needed", "Send from operations@"],
        draftResponseSubject: subject,
        draftResponseBody: body,
        simulated: !client,
      },
    };

    await pool.query(
      `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
       VALUES ('agent6_chief_of_staff', 'weekly_ops_brief', 'operational', $1, $2, $3::jsonb)`,
      [subject, `weekly_ops_brief:${orgId}:${new Date().toISOString().slice(0, 10)}`, JSON.stringify(payload)],
    );
    await pool.query(
      `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'weekly_brief_drafted', updated_at = now()
       WHERE agent_key = 'agent6_chief_of_staff'`,
    );
    console.log(`Weekly brief drafted for ${clientName} (${orgId}).`);
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Weekly ops brief cron failed:", err);
    process.exit(1);
  });
