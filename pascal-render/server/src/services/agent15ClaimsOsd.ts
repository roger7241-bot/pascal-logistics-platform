// ============================================================================
// AGENT 15 — CLAIMS & OS&D  (display slot #9)
// Overage / Shortage / Damage claim intake and follow-through. Takes warm
// handoff from Customer Service when a client reports damage, missing goods,
// or an overage. Categorizes, computes a defensible claim value from BOL +
// invoice + photos, drafts the claim to the carrier, and chases past-due
// claims until resolved.
//
// Carrier claims windows matter here:
//   LTL / TL:  9 months to file, 30 days after acknowledgment to respond
//   Ocean:     3 days for visible / 3 years for concealed (Carriage of Goods
//              by Sea Act — US) or 60 days / 1 year (Hague-Visby elsewhere)
//   Air:       7 days for damage, 14 days for delay (Montreal Convention)
//   Rail:      9 months, same as motor
// The agent flags the window on every claim so nothing goes past-due.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type ClaimCategory =
  | "damage"
  | "shortage"
  | "overage"
  | "concealed_damage"
  | "loss"
  | "delay"
  | "other";

export type ClaimStage =
  | "intake"
  | "claim_filed"
  | "carrier_response"
  | "negotiation"
  | "resolved"
  | "denied"
  | "escalated";

export interface ClaimEvent {
  shipmentRef: string;
  mode: "ltl" | "tl" | "ocean" | "air" | "rail" | "unknown";
  carrier: string;
  clientName?: string;
  clientEmail?: string;
  eventType: string;
  eventDetail: string;
  invoiceValueUsd?: number;
  damagedValueUsd?: number;
  hasPhotos: boolean;
  hasBolNotation: boolean;
  hasSignedPod: boolean;
  deliveredAtIso?: string;
  stage: ClaimStage;
  claimAmountUsd?: number;
  filedAtIso?: string;
}

export interface ClaimOutput {
  category: ClaimCategory;
  priority: "urgent" | "normal" | "low";
  stage: ClaimStage;
  summary: string;
  claimValueUsd: number;
  filingWindowDays: number;         // days remaining to file
  documentationGaps: string[];
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "carrier" | "client" | "internal";
  simulated: boolean;
}

const FILING_WINDOW_DAYS: Record<ClaimEvent["mode"], number> = {
  ltl: 270,     // 9 months
  tl: 270,
  rail: 270,
  ocean: 1095,  // COGSA 3 years for concealed; visible is much shorter but claim can still file
  air: 14,      // Montreal Convention max for damage/delay
  unknown: 270,
};

export async function categorizeAndDraft(event: ClaimEvent): Promise<ClaimOutput> {
  const gaps = auditDocumentation(event);
  const claimValueUsd = event.claimAmountUsd ?? event.damagedValueUsd ?? event.invoiceValueUsd ?? 0;
  const windowDaysRemaining = calcWindowDays(event);

  if (!client) {
    return {
      category: heuristicCategory(event),
      priority: windowDaysRemaining < 30 || event.stage === "escalated" ? "urgent" : "normal",
      stage: event.stage,
      summary: `[Simulated] ${event.shipmentRef} ${event.mode.toUpperCase()} on ${event.carrier}: ${event.eventDetail}. Claim value $${claimValueUsd.toLocaleString()}. ${gaps.length > 0 ? `Doc gaps: ${gaps.join("; ")}. ` : ""}Filing window: ${windowDaysRemaining} days remaining. This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      claimValueUsd,
      filingWindowDays: windowDaysRemaining,
      documentationGaps: gaps,
      suggestedActions: gaps.length > 0 ? gaps.map((g) => `Obtain: ${g}`) : ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      draftResponseSubject: `Claim ${event.shipmentRef} — ${event.mode.toUpperCase()} ${event.eventType}`,
      draftResponseBody: `${event.carrier} Claims Department,\n\nWe are filing a cargo claim on behalf of our client for shipment ${event.shipmentRef}, delivered ${event.deliveredAtIso ?? "recently"} on carrier ${event.carrier}.\n\nNature of claim: ${event.eventDetail}\nClaim value: $${claimValueUsd.toLocaleString()} USD\n\nSupporting documents attached${gaps.length > 0 ? ` (missing: ${gaps.join(", ")} — will forward on receipt)` : ""}.\n\nPlease acknowledge receipt and provide your claim number.\n\n— Roger, Pascal Logistics`,
      recipientRole: gaps.length > 0 ? "client" : "carrier",
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Claims & OS&D agent (Agent 9). You handle overage / shortage / damage cargo claims on behalf of clients against carriers. You draft the actual claim letter to the carrier and progress it through resolution.

Category set: damage / shortage / overage / concealed_damage / loss / delay / other
Stage set: intake / claim_filed / carrier_response / negotiation / resolved / denied / escalated

Doctrinal filing windows (already computed and passed in as filingWindowDays):
- LTL / TL / Rail: 9 months from delivery
- Ocean: COGSA 3 years for concealed damage
- Air: Montreal Convention — 14 days for damage/delay
Priority urgent if window < 30 days OR stage escalated. Otherwise normal.

Return only a JSON object with keys: category, priority, stage, summary, claimValueUsd (numeric), filingWindowDays (numeric), documentationGaps (array), suggestedActions (array), draftResponseSubject, draftResponseBody, recipientRole ("carrier" for claim to carrier, "client" for status update to client, "internal" for note to Roger).

Draft tone: precise, factual, cite the shipment ref and delivery date, state claim value in USD, list supporting docs. Sign-off: "— Roger, Pascal Logistics"`;

  const userPrompt = `Claim event:
Shipment: ${event.shipmentRef}
Mode: ${event.mode}
Carrier: ${event.carrier}
Client: ${event.clientName ?? "unknown"} ${event.clientEmail ? `<${event.clientEmail}>` : ""}
Event type: ${event.eventType}
Event detail: ${event.eventDetail}
Stage: ${event.stage}
Invoice value: $${(event.invoiceValueUsd ?? 0).toLocaleString()}
Damaged / short value: $${(event.damagedValueUsd ?? 0).toLocaleString()}
Explicit claim amount: ${event.claimAmountUsd ? `$${event.claimAmountUsd.toLocaleString()}` : "not specified"}
Delivered at: ${event.deliveredAtIso ?? "unknown"}
Filed at: ${event.filedAtIso ?? "not yet filed"}
Filing window remaining: ${windowDaysRemaining} days

Documentation on file:
- Photos of damage: ${event.hasPhotos ? "yes" : "MISSING"}
- Notation on BOL / delivery receipt at time of delivery: ${event.hasBolNotation ? "yes" : "MISSING (may be concealed_damage instead of damage)"}
- Signed POD: ${event.hasSignedPod ? "yes" : "MISSING"}

Deterministic doc audit found: ${gaps.join("; ") || "no gaps"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 900,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Claims & OS&D: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category),
    priority: normalizePriority(parsed.priority),
    stage: normalizeStage(parsed.stage, event.stage),
    summary: String(parsed.summary ?? ""),
    claimValueUsd: typeof parsed.claimValueUsd === "number" ? parsed.claimValueUsd : claimValueUsd,
    filingWindowDays: typeof parsed.filingWindowDays === "number" ? parsed.filingWindowDays : windowDaysRemaining,
    documentationGaps: Array.isArray(parsed.documentationGaps) ? parsed.documentationGaps.map(String) : gaps,
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? `Claim ${event.shipmentRef}`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: normalizeRecipient(parsed.recipientRole),
    simulated: false,
  };
}

export async function persistDraft(event: ClaimEvent, output: ClaimOutput, sourceRef?: string) {
  const payload = { event, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent15_claims_osd', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [output.recipientRole === "carrier" ? "carrier_claim" : output.recipientRole === "client" ? "client_claim_update" : "internal_note", output.category, `${event.shipmentRef}: ${event.eventType}`, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent15_claims_osd'`,
  );
  return result.rows[0];
}

function auditDocumentation(e: ClaimEvent): string[] {
  const gaps: string[] = [];
  if (!e.hasPhotos) gaps.push("damage photos");
  if (!e.hasSignedPod) gaps.push("signed POD");
  // Missing BOL notation at delivery converts a visible damage into a
  // concealed-damage claim, which is a harder fight — flag it explicitly.
  if (!e.hasBolNotation && /damage/i.test(e.eventType)) gaps.push("BOL notation at delivery (visible damage becomes concealed-damage claim without it)");
  return gaps;
}

function calcWindowDays(e: ClaimEvent): number {
  const totalWindow = FILING_WINDOW_DAYS[e.mode];
  if (!e.deliveredAtIso) return totalWindow;
  const daysSinceDelivery = Math.round((Date.now() - new Date(e.deliveredAtIso).getTime()) / 86_400_000);
  return Math.max(0, totalWindow - daysSinceDelivery);
}

function heuristicCategory(e: ClaimEvent): ClaimCategory {
  const s = `${e.eventType} ${e.eventDetail}`.toLowerCase();
  if (/overage|extra|surplus/.test(s)) return "overage";
  if (/lost|missing|not delivered/.test(s)) return "loss";
  if (/shortage|short|missing piece/.test(s)) return "shortage";
  if (/concealed/.test(s)) return "concealed_damage";
  if (/delay|late/.test(s)) return "delay";
  if (/damage|broken|crushed|torn/.test(s)) return "damage";
  return "other";
}

function normalizeCategory(v: unknown): ClaimCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: ClaimCategory[] = ["damage", "shortage", "overage", "concealed_damage", "loss", "delay", "other"];
  return (allowed as string[]).includes(s) ? (s as ClaimCategory) : "other";
}

function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}

function normalizeStage(v: unknown, fallback: ClaimStage): ClaimStage {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: ClaimStage[] = ["intake", "claim_filed", "carrier_response", "negotiation", "resolved", "denied", "escalated"];
  return (allowed as string[]).includes(s) ? (s as ClaimStage) : fallback;
}

function normalizeRecipient(v: unknown): "carrier" | "client" | "internal" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "carrier" || s === "client" || s === "internal" ? s : "carrier";
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}
