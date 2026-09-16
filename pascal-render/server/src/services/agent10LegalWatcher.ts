// ============================================================================
// AGENT 10 — LEGAL & COMPLIANCE WATCHDOG  (display slot #14)
// Watches every time-boxed obligation Pascal Logistics or its clients hold:
// contract renewals, insurance certificates, POAs, DG certifications,
// USMCA blanket certs, W9 refreshes, customs bond renewals, business
// license renewals, retainer term end. Drafts a heads-up under Agent 10 at
// the appropriate lead time so nothing lapses.
//
// Not a lawyer — flags what needs review, never gives binding legal advice.
// Coordinates with the client's counsel of record for anything requiring
// interpretation.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type LegalCategory =
  | "insurance_renewal"
  | "poa_renewal"
  | "usmca_blanket_renewal"
  | "dg_cert_renewal"
  | "customs_bond_renewal"
  | "w9_refresh"
  | "contract_renewal"
  | "business_license_renewal"
  | "retainer_term_end"
  | "regulatory_deadline"
  | "other";

export interface LegalWatchEvent {
  eventType: string;                           // "insurance_renewal" | "poa_renewal" | ...
  eventDetail: string;
  subject: string;                             // what's expiring / renewing
  ownerOrgId?: string;                         // client_org_id if client-scoped; blank if Pascal itself
  ownerName?: string;
  expiresAtIso: string;                        // YYYY-MM-DD when the thing lapses
  policyOrRef?: string;                        // insurance policy #, POA ref, contract #
  counterpartyName?: string;                   // insurer / broker / carrier / vendor / CBP / CBSA
  counterpartyEmail?: string;
  hasRenewalStarted: boolean;
  notes?: string;
}

export interface LegalOutput {
  category: LegalCategory;
  priority: "urgent" | "normal" | "low";
  daysToExpiry: number;
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "internal" | "counterparty" | "client";
  simulated: boolean;
}

// Lead-time bands per obligation type (days before expiry when we first
// draft a heads-up). Chosen to give the counterparty room to respond and
// still leave a buffer for late fixes.
const LEAD_TIME_DAYS: Record<LegalCategory, number> = {
  insurance_renewal: 45,
  poa_renewal: 60,
  usmca_blanket_renewal: 30,
  dg_cert_renewal: 45,
  customs_bond_renewal: 60,
  w9_refresh: 30,
  contract_renewal: 90,
  business_license_renewal: 45,
  retainer_term_end: 60,
  regulatory_deadline: 21,
  other: 30,
};

export async function categorizeAndDraft(event: LegalWatchEvent): Promise<LegalOutput> {
  const daysToExpiry = Math.round((new Date(event.expiresAtIso).getTime() - Date.now()) / 86_400_000);
  const category = normalizeCategory(event.eventType);
  const leadTime = LEAD_TIME_DAYS[category];

  const priority: LegalOutput["priority"] = daysToExpiry <= 7 ? "urgent" : daysToExpiry <= leadTime ? "normal" : "low";

  if (!client) {
    return {
      category,
      priority,
      daysToExpiry,
      summary: `[Simulated] ${event.subject} expires ${event.expiresAtIso} — ${daysToExpiry} days remaining. Category: ${category}. This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      suggestedActions: [event.hasRenewalStarted ? "Confirm counterparty has issued renewal" : "Send renewal request to counterparty", "Update expiry date on file after renewal received"],
      draftResponseSubject: `Renewal reminder: ${event.subject} — expires ${event.expiresAtIso}`,
      draftResponseBody: `Hi ${event.counterpartyName ?? event.ownerName ?? "there"},\n\nThis is a heads-up that ${event.subject} is set to expire on ${event.expiresAtIso} — ${daysToExpiry} days from today. Could you confirm the renewal is in motion, or send the updated document when it's ready?\n\n${event.policyOrRef ? `Reference: ${event.policyOrRef}\n\n` : ""}Let me know if you need anything from our side.\n\n— Roger, Pascal Logistics`,
      recipientRole: event.counterpartyEmail ? "counterparty" : "internal",
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Legal & Compliance Watchdog (Agent 14). You track every time-boxed obligation Pascal Logistics or its clients hold and draft the appropriate heads-up at the right lead time.

CATEGORIES you handle:
- insurance_renewal (auto liability, cargo, cyber, E&O — 45d lead)
- poa_renewal (customs POA both sides — 60d lead; this is the pinch point)
- usmca_blanket_renewal (annual USMCA blanket certificate — 30d lead)
- dg_cert_renewal (DG shipper certification, TDG training — 45d lead)
- customs_bond_renewal (Type 3 continuous, single-entry — 60d lead)
- w9_refresh (annual carrier W9 refresh — 30d lead)
- contract_renewal (MSA, SOW, retainer term — 90d lead so we can talk pricing)
- business_license_renewal (WA UBI, BC business number — 45d lead)
- retainer_term_end (client retainer end — 60d lead so we can renew or offboard)
- regulatory_deadline (CARM Phase 3, Section 232 exclusion filing, tariff comment window — 21d lead)

CRITICAL rule: you are NOT giving legal advice. You flag what needs review. Anything requiring interpretation goes to the client's counsel of record (never say "our" counsel — say "your counsel").

Tone: precise, factual, no alarm. Sign-off "— Roger, Pascal Logistics" on anything going to a counterparty or client.

Return only a JSON object with keys: category, priority, daysToExpiry (numeric), summary, suggestedActions, draftResponseSubject, draftResponseBody, recipientRole ("internal" / "counterparty" / "client").`;

  const userPrompt = `Legal watchdog event:
Type: ${event.eventType}
Subject: ${event.subject}
Detail: ${event.eventDetail}
Owner: ${event.ownerName ?? "Pascal Logistics"} ${event.ownerOrgId ? `(org ${event.ownerOrgId})` : ""}
Expires: ${event.expiresAtIso} (${daysToExpiry} days from today)
Reference: ${event.policyOrRef ?? "n/a"}
Counterparty: ${event.counterpartyName ?? "n/a"} ${event.counterpartyEmail ? `<${event.counterpartyEmail}>` : ""}
Renewal already in motion: ${event.hasRenewalStarted}
Notes: ${event.notes ?? "n/a"}

Lead time for this category: ${leadTime} days.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Legal Watcher: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category ?? category),
    priority: normalizePriority(parsed.priority, priority),
    daysToExpiry,
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? `Renewal reminder: ${event.subject}`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: normalizeRecipient(parsed.recipientRole),
    simulated: false,
  };
}

export async function persistDraft(event: LegalWatchEvent, output: LegalOutput, sourceRef?: string) {
  const payload = { event, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent10_legal_watcher', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [
      output.recipientRole === "internal" ? "internal_watch" : output.recipientRole === "client" ? "client_reminder" : "counterparty_renewal_request",
      output.category,
      `${event.subject} — ${output.daysToExpiry}d to expiry`,
      sourceRef ?? null,
      JSON.stringify(payload),
    ],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent10_legal_watcher'`,
  );
  return result.rows[0];
}

function normalizeCategory(v: unknown): LegalCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: LegalCategory[] = ["insurance_renewal", "poa_renewal", "usmca_blanket_renewal", "dg_cert_renewal", "customs_bond_renewal", "w9_refresh", "contract_renewal", "business_license_renewal", "retainer_term_end", "regulatory_deadline", "other"];
  return (allowed as string[]).includes(s) ? (s as LegalCategory) : "other";
}
function normalizePriority(v: unknown, fallback: LegalOutput["priority"]): LegalOutput["priority"] {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "normal" || s === "low" ? (s as LegalOutput["priority"]) : fallback;
}
function normalizeRecipient(v: unknown): "internal" | "counterparty" | "client" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "internal" || s === "counterparty" || s === "client" ? s : "internal";
}
function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return {}; }
}
