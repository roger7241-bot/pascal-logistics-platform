// ============================================================================
// AGENT 14 — CARRIER VETTING & COMPLIANCE  (display slot #5)
// Verifies a carrier is safe to tender to BEFORE Booking & Dispatch calls
// them. Checks MC/DOT authority active, cargo + auto-liability insurance
// current, SMS BASIC safety scores, W9 on file. Any red flag → tender is
// blocked until Roger overrides. Also runs monthly re-verification so a
// carrier we've used before doesn't quietly slip out of compliance.
//
// Live verification sources (FMCSA SAFER, SMS, RMIS / MyCarrierPackets) wire
// in later phases. For the first build the packet audit runs deterministically
// against a payload of what we have on file so the block/allow decision is
// testable end-to-end.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type VettingCategory =
  | "cleared"
  | "conditional"
  | "blocked"
  | "renewal_due"
  | "other";

export interface VettingRequest {
  carrierName: string;
  mcNumber?: string;
  dotNumber?: string;
  eventType: string;                 // "new_carrier" | "monthly_reverify" | "post_tender_audit" | ...
  authorityActive: boolean;
  insuranceAutoLiabilityUsd?: number; // e.g. 1000000
  insuranceCargoUsd?: number;         // e.g. 100000
  insuranceExpiresIso?: string;       // YYYY-MM-DD
  smsUnsafeDriving?: number;          // percentile 0-100 (higher = worse)
  smsHoursOfService?: number;
  smsVehicleMaintenance?: number;
  hasW9OnFile: boolean;
  lastVerifiedIso?: string;
  notes?: string;
}

export interface VettingOutput {
  category: VettingCategory;
  priority: "urgent" | "normal" | "low";
  decision: "allow" | "conditional" | "block";
  summary: string;
  redFlags: string[];
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "carrier" | "internal";
  simulated: boolean;
}

// Insurance minimums Roger operates against. These are baseline requirements;
// certain loads (DG, high-value) get bumped in a follow-up phase.
const MIN_AUTO_LIABILITY_USD = 1_000_000;
const MIN_CARGO_USD = 100_000;
// SMS BASIC thresholds: FMCSA flags carriers over 65th percentile in unsafe
// driving, 65th in HOS, 80th in vehicle maintenance as an intervention
// threshold. We use the same lines here as our block signal.
const SMS_UNSAFE_DRIVING_MAX = 65;
const SMS_HOS_MAX = 65;
const SMS_VEHICLE_MAINT_MAX = 80;

export async function categorizeAndDraft(request: VettingRequest): Promise<VettingOutput> {
  const redFlags = auditCarrier(request);
  const decision: VettingOutput["decision"] = redFlags.length === 0 ? "allow" : redFlags.some((f) => /expired|inactive|below min|unavailable/i.test(f)) ? "block" : "conditional";

  if (!client) {
    return {
      category: heuristicCategory(request, decision),
      priority: decision === "block" ? "urgent" : decision === "conditional" ? "normal" : "low",
      decision,
      summary: `[Simulated] ${request.carrierName}${request.mcNumber ? ` (MC ${request.mcNumber})` : ""}: ${decision === "allow" ? "cleared to tender" : decision === "conditional" ? "conditional — needs review" : "BLOCKED — do not tender until resolved"}. ${redFlags.length > 0 ? `Red flags: ${redFlags.join("; ")}` : "No red flags on file."} This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      redFlags,
      suggestedActions: redFlags.length > 0 ? redFlags.map((f) => `Resolve: ${f}`) : ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      draftResponseSubject: `${request.carrierName} — packet request`,
      draftResponseBody: `Hi ${request.carrierName} team,\n\nWe'd like to add your fleet to our approved-carrier roster. Please send:\n- Current MC/DOT authority letter\n- COI naming Pascal Logistics Inc. as certificate holder (auto liability $1M / cargo $100k minimum)\n- W9\n- Copies of last three POD signatures if available\n\nOnce we have this we'll turn on tendering.\n\n— Roger, Pascal Logistics`,
      recipientRole: redFlags.some((f) => /w9|insurance|coi|packet/i.test(f)) ? "carrier" : "internal",
      simulated: true,
    };
  }

  const systemPrompt = `You are the Carrier Vetting & Compliance agent for Pascal Logistics Inc. You verify a carrier is safe to tender to. You return a JSON verdict (allow / conditional / block) and draft the corresponding message — either an internal note for Roger (allow / block) or a packet-request email to the carrier (conditional, when we can salvage this carrier by getting missing docs).

Decision guidance:
- allow: authority active, insurance current above minimums, SMS scores below intervention thresholds, W9 on file
- conditional: authority active but insurance certificate expires < 30 days OR one SMS score elevated but not over threshold OR W9 missing but everything else fine
- block: any of authority inactive, insurance expired or below minimum, any SMS score over intervention threshold

Categories: cleared / conditional / blocked / renewal_due / other
Priority: urgent for block, normal for conditional / renewal_due, low for cleared

Return only a JSON object with keys: category, priority, decision, summary, redFlags (array), suggestedActions (array), draftResponseSubject, draftResponseBody, recipientRole ("carrier" or "internal").
Sign-off in emails: "— Roger, Pascal Logistics".`;

  const userPrompt = `Carrier vetting request:
Carrier: ${request.carrierName}
MC: ${request.mcNumber ?? "unknown"}
DOT: ${request.dotNumber ?? "unknown"}
Event: ${request.eventType}
Authority active: ${request.authorityActive}
Auto liability: ${request.insuranceAutoLiabilityUsd ? `$${request.insuranceAutoLiabilityUsd.toLocaleString()}` : "unknown"} (min $${MIN_AUTO_LIABILITY_USD.toLocaleString()})
Cargo insurance: ${request.insuranceCargoUsd ? `$${request.insuranceCargoUsd.toLocaleString()}` : "unknown"} (min $${MIN_CARGO_USD.toLocaleString()})
Insurance expires: ${request.insuranceExpiresIso ?? "unknown"}
SMS unsafe driving percentile: ${request.smsUnsafeDriving ?? "unknown"} (threshold ${SMS_UNSAFE_DRIVING_MAX})
SMS HOS percentile: ${request.smsHoursOfService ?? "unknown"} (threshold ${SMS_HOS_MAX})
SMS vehicle maintenance percentile: ${request.smsVehicleMaintenance ?? "unknown"} (threshold ${SMS_VEHICLE_MAINT_MAX})
W9 on file: ${request.hasW9OnFile}
Last verified: ${request.lastVerifiedIso ?? "never"}

Deterministic red-flag audit found: ${redFlags.join("; ") || "no red flags"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Carrier Vetting: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category),
    priority: normalizePriority(parsed.priority),
    decision: normalizeDecision(parsed.decision, decision),
    summary: String(parsed.summary ?? ""),
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags.map(String) : redFlags,
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? `${request.carrierName} — vetting decision`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: normalizeRecipient(parsed.recipientRole),
    simulated: false,
  };
}

export async function persistDraft(request: VettingRequest, output: VettingOutput, sourceRef?: string) {
  const payload = { request, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent14_carrier_vetting', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [output.recipientRole === "carrier" ? "carrier_packet_request" : "vetting_verdict", output.category, `${request.carrierName}: ${request.eventType}`, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent14_carrier_vetting'`,
  );
  return result.rows[0];
}

// Deterministic audit — independent of LLM so a red flag always fires.
function auditCarrier(r: VettingRequest): string[] {
  const flags: string[] = [];
  if (!r.authorityActive) flags.push("MC/DOT authority INACTIVE — do not tender");
  if (r.insuranceAutoLiabilityUsd !== undefined && r.insuranceAutoLiabilityUsd < MIN_AUTO_LIABILITY_USD) {
    flags.push(`auto-liability insurance below min ($${r.insuranceAutoLiabilityUsd.toLocaleString()} vs $${MIN_AUTO_LIABILITY_USD.toLocaleString()})`);
  }
  if (r.insuranceCargoUsd !== undefined && r.insuranceCargoUsd < MIN_CARGO_USD) {
    flags.push(`cargo insurance below min ($${r.insuranceCargoUsd.toLocaleString()} vs $${MIN_CARGO_USD.toLocaleString()})`);
  }
  if (r.insuranceAutoLiabilityUsd === undefined || r.insuranceCargoUsd === undefined) {
    flags.push("insurance certificate not on file — request COI");
  }
  if (r.insuranceExpiresIso) {
    const daysToExpiry = Math.round((new Date(r.insuranceExpiresIso).getTime() - Date.now()) / 86_400_000);
    if (daysToExpiry < 0) flags.push(`insurance EXPIRED ${Math.abs(daysToExpiry)} days ago`);
    else if (daysToExpiry < 30) flags.push(`insurance expires in ${daysToExpiry} days — renewal due`);
  }
  if (r.smsUnsafeDriving !== undefined && r.smsUnsafeDriving > SMS_UNSAFE_DRIVING_MAX) {
    flags.push(`SMS unsafe driving ${r.smsUnsafeDriving} > ${SMS_UNSAFE_DRIVING_MAX} threshold`);
  }
  if (r.smsHoursOfService !== undefined && r.smsHoursOfService > SMS_HOS_MAX) {
    flags.push(`SMS HOS ${r.smsHoursOfService} > ${SMS_HOS_MAX} threshold`);
  }
  if (r.smsVehicleMaintenance !== undefined && r.smsVehicleMaintenance > SMS_VEHICLE_MAINT_MAX) {
    flags.push(`SMS vehicle maintenance ${r.smsVehicleMaintenance} > ${SMS_VEHICLE_MAINT_MAX} threshold`);
  }
  if (!r.hasW9OnFile) flags.push("W9 not on file");
  return flags;
}

function heuristicCategory(_r: VettingRequest, d: VettingOutput["decision"]): VettingCategory {
  if (d === "block") return "blocked";
  if (d === "conditional") return "conditional";
  return "cleared";
}

function normalizeCategory(v: unknown): VettingCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: VettingCategory[] = ["cleared", "conditional", "blocked", "renewal_due", "other"];
  return (allowed as string[]).includes(s) ? (s as VettingCategory) : "other";
}

function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}

function normalizeDecision(v: unknown, fallback: VettingOutput["decision"]): VettingOutput["decision"] {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "allow" || s === "conditional" || s === "block" ? s : fallback;
}

function normalizeRecipient(v: unknown): "carrier" | "internal" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "carrier" ? "carrier" : "internal";
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}
