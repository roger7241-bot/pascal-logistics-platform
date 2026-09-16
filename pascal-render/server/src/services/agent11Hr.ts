// ============================================================================
// AGENT 11 — HR & ONBOARDING  (display slot #15)
// Drafts offer letters, employee onboarding checklists, contractor
// agreements, benefits explainers, policy-question responses, offboarding
// checklists. Payroll-compliant framing for WA (US) + BC (Canada). Roger
// reviews and signs every outbound — you never send.
//
// Not a licensed employment lawyer. Anything requiring interpretation
// gets flagged for review with the client's counsel of record (or a
// referral to WA/BC-licensed employment counsel if Pascal itself is the
// employer). Never quote binding compensation numbers — Roger sets those.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type HrCategory =
  | "offer_letter"
  | "contractor_agreement"
  | "onboarding_checklist"
  | "benefits_explainer"
  | "policy_response"
  | "performance_note"
  | "offboarding_checklist"
  | "reference_request"
  | "other";

export interface HrRequest {
  eventType: string;
  role: string;
  candidateName?: string;
  candidateEmail?: string;
  employmentType?: "employee" | "contractor" | "intern" | "part_time" | "seasonal";
  jurisdiction?: "wa_us" | "bc_ca" | "on_ca" | "or_us" | "other";
  employerEntity?: "pascal_logistics" | "client";
  clientOrgId?: string;
  effectiveDateIso?: string;
  requestDetail: string;                // freeform description of what to draft
  compensationBand?: string;             // "Tier X per Roger's compensation matrix" — do NOT quote numbers unless explicitly provided
  priorContext?: string;
}

export interface HrOutput {
  category: HrCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "candidate" | "employee" | "client" | "internal";
  simulated: boolean;
}

export async function categorizeAndDraft(request: HrRequest): Promise<HrOutput> {
  const category = heuristicCategory(request);

  if (!client) {
    return {
      category,
      priority: category === "offer_letter" || category === "offboarding_checklist" ? "normal" : "low",
      summary: `[Simulated] ${category.replace(/_/g, " ")} for ${request.candidateName ?? "candidate"} — role ${request.role}. This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      suggestedActions: ["Roger reviews wording", "Confirm compensation band before sending", "Route to employment counsel if anything requires interpretation"],
      draftResponseSubject: draftSubject(request, category),
      draftResponseBody: draftBody(request, category),
      recipientRole: category === "offer_letter" || category === "contractor_agreement" ? "candidate" : category === "policy_response" || category === "benefits_explainer" || category === "performance_note" ? "employee" : "internal",
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are HR & Onboarding (Agent 15). You draft offer letters, contractor agreements, onboarding checklists, benefits explainers, policy responses, performance notes, offboarding checklists, and reference-request drafts.

CRITICAL: You are NOT a licensed employment lawyer. If a request requires legal interpretation — compensation in a state you don't know, non-compete enforceability, termination-with-cause reasoning, immigration status, wage-and-hour edge cases — flag it in suggestedActions for review with employment counsel. Never quote binding compensation numbers unless Roger has explicitly provided the amount. Use "per your compensation band" or "[compensation to be inserted by Roger]" if a number would go here.

JURISDICTION note: Pascal Logistics itself sits in WA (US) + BC (Canada). US offers should default to at-will language (WA), Canadian offers to just-cause + reasonable notice (BC). Use jurisdiction field to steer. NEVER assume; if jurisdiction is unclear, flag it.

Employer entity: if employer_entity = "client", the draft goes out on the CLIENT's letterhead — do not sign as Roger. If "pascal_logistics", sign as Roger.

Tone: warm, professional, precise. Never over-promise.

Return only a JSON object with keys: category, priority, summary, suggestedActions, draftResponseSubject, draftResponseBody, recipientRole ("candidate" / "employee" / "client" / "internal").`;

  const userPrompt = `HR request:
Event type: ${request.eventType}
Role: ${request.role}
Candidate: ${request.candidateName ?? "n/a"} ${request.candidateEmail ? `<${request.candidateEmail}>` : ""}
Employment type: ${request.employmentType ?? "unspecified"}
Jurisdiction: ${request.jurisdiction ?? "unspecified"}
Employer entity: ${request.employerEntity ?? "pascal_logistics"}
Client org (if applicable): ${request.clientOrgId ?? "n/a"}
Effective: ${request.effectiveDateIso ?? "TBD"}
Compensation guidance: ${request.compensationBand ?? "leave placeholder — Roger fills in"}
Request detail: ${request.requestDetail}
Prior context: ${request.priorContext ?? "n/a"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1200,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("HR: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category ?? category),
    priority: normalizePriority(parsed.priority),
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? draftSubject(request, category)),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: normalizeRecipient(parsed.recipientRole),
    simulated: false,
  };
}

export async function persistDraft(request: HrRequest, output: HrOutput, sourceRef?: string) {
  const payload = { request, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent11_hr', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [
      output.recipientRole === "internal" ? "internal_hr_note" : output.category,
      output.category,
      `${request.role}: ${request.eventType}`,
      sourceRef ?? null,
      JSON.stringify(payload),
    ],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent11_hr'`,
  );
  return result.rows[0];
}

function heuristicCategory(r: HrRequest): HrCategory {
  const s = `${r.eventType} ${r.requestDetail}`.toLowerCase();
  if (/offer/.test(s)) return "offer_letter";
  if (/contractor|1099|consulting/.test(s)) return "contractor_agreement";
  if (/onboard|first day|welcome/.test(s)) return "onboarding_checklist";
  if (/benefits|health|401k|rrsp|dental/.test(s)) return "benefits_explainer";
  if (/policy|vacation|pto|sick|remote work/.test(s)) return "policy_response";
  if (/performance|review|feedback/.test(s)) return "performance_note";
  if (/offboard|separation|exit/.test(s)) return "offboarding_checklist";
  if (/reference/.test(s)) return "reference_request";
  return "other";
}

function draftSubject(r: HrRequest, cat: HrCategory): string {
  if (cat === "offer_letter") return `Offer — ${r.role}`;
  if (cat === "contractor_agreement") return `Contractor engagement — ${r.role}`;
  if (cat === "onboarding_checklist") return `Onboarding — ${r.role}${r.candidateName ? ` (${r.candidateName})` : ""}`;
  if (cat === "offboarding_checklist") return `Offboarding checklist — ${r.candidateName ?? r.role}`;
  return `${r.role}: ${r.eventType}`;
}

function draftBody(r: HrRequest, cat: HrCategory): string {
  const name = r.candidateName?.split(" ")[0] ?? "there";
  if (cat === "offer_letter") return `Hi ${name},\n\n[Simulated placeholder — offer letter for ${r.role}. Compensation band: ${r.compensationBand ?? "[Roger to insert]"}. Jurisdiction: ${r.jurisdiction ?? "[to confirm]"}.]\n\n— Roger, Pascal Logistics`;
  if (cat === "onboarding_checklist") return `Onboarding checklist for ${name} — ${r.role}\n☐ I-9 / TD1 forms\n☐ W2 / TD1BC on file\n☐ Direct deposit set up\n☐ IT provisioning (email, TMS access, MFA)\n☐ First-week 1:1 scheduled\n☐ Benefits enrolment window opened`;
  return `${r.requestDetail}`;
}

function normalizeCategory(v: unknown): HrCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: HrCategory[] = ["offer_letter", "contractor_agreement", "onboarding_checklist", "benefits_explainer", "policy_response", "performance_note", "offboarding_checklist", "reference_request", "other"];
  return (allowed as string[]).includes(s) ? (s as HrCategory) : "other";
}
function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}
function normalizeRecipient(v: unknown): "candidate" | "employee" | "client" | "internal" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "candidate" || s === "employee" || s === "client" || s === "internal" ? s : "internal";
}
function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return {}; }
}
