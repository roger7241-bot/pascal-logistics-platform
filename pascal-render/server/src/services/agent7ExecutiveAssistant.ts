// ============================================================================
// AGENT 7 — EXECUTIVE ASSISTANT  (display slot #11)
// Owns onboarding, scheduling, meeting prep, and post-call follow-through.
// Sits between Chief of Staff (inbox triage) and Customer Service (client
// operational contact). Where those two respond, EA schedules, prepares,
// and follows up.
//
// Day-1 use cases:
//   - Prospect emails "Can we set up an intro?" → EA drafts times + agenda
//   - New client signup → EA drafts onboarding checklist + kickoff invite
//   - Roger has back-to-back calls → EA drafts a one-pager brief for each
//   - Post-call → EA drafts recap + owner + next-touch date
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type EaCategory =
  | "scheduling_request"
  | "meeting_prep"
  | "onboarding_step"
  | "follow_up"
  | "internal_reminder"
  | "other";

export interface EaRequest {
  eventType: string;                    // "prospect_intro" | "kickoff" | "meeting_prep" | "post_call" | "onboarding_check"
  contactName?: string;
  contactEmail?: string;
  contactCompany?: string;
  contactRole?: string;
  requestDetail: string;
  meetingWhenIso?: string;              // for meeting_prep or post_call
  onboardingStep?: string;              // for onboarding_step — "poa_signed" | "w9_received" | "kickoff_scheduled" | ...
  priorContext?: string;                // any relevant history (paste of prior email thread, etc.)
}

export interface EaOutput {
  category: EaCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "prospect" | "client" | "internal";
  simulated: boolean;
}

const AGENDA_ONBOARDING = [
  "POA on file with each side's broker (US + Canada if cross-border)",
  "W9 / equivalent for our billing",
  "Kickoff call — walk through portal, magic-upload flow, how to reach us",
  "Stripe subscription for retainer",
  "Introduce Customer Service loop (email, phone, portal chat)",
];

export async function categorizeAndDraft(request: EaRequest): Promise<EaOutput> {
  if (!client) {
    const cat = heuristicCategory(request);
    return {
      category: cat,
      priority: cat === "scheduling_request" || cat === "onboarding_step" ? "normal" : "low",
      summary: `[Simulated] ${cat.replace(/_/g, " ")} for ${request.contactName ?? request.contactCompany ?? "contact"}: ${request.requestDetail.slice(0, 120)}. This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      suggestedActions: ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      draftResponseSubject: draftSubject(request, cat),
      draftResponseBody: draftBody(request, cat),
      recipientRole: cat === "internal_reminder" || cat === "meeting_prep" ? "internal" : (request.eventType.includes("prospect") ? "prospect" : "client"),
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Executive Assistant (Agent 11). Roger's EA, not the client's.

EA-specific context: onboarding checklist is fixed and boring on purpose (POA both sides, W9, kickoff call, Stripe subscription, intro to Customer Service loop). Order matters: POA is the item that dies quietly if not chased weekly. Roger's cleanest call windows are Tue/Wed/Thu mornings PT; late Fridays are for the ops brief.

TASK: handle scheduling, onboarding, meeting prep, and post-call follow-through.

Categories:
- scheduling_request: someone wants to book time with Roger (intro, review, quarterly)
- meeting_prep: draft a one-page brief FOR Roger before his next call — internal only
- onboarding_step: a new client hitting a checklist step (POA, W9, kickoff, first shipment)
- follow_up: post-call recap + owner + next-touch date, sent to the meeting attendee
- internal_reminder: EA needs to prompt Roger about something (missing action, chase-back)
- other

Priority: normal for scheduling / onboarding / follow_up; low for meeting prep and reminders; urgent only if a scheduled call is <24h away and something is missing.

For scheduling drafts, propose 3 time windows in Pacific Time using the format "Tue Oct 21 · 10:30–11:00 AM PT" — Roger is in Blaine, WA / S. Surrey, BC.
For onboarding drafts, tick off completed items and name the next one clearly.
For meeting prep, use bullet format: WHO, WHAT they want, PRIOR CONTEXT, RECOMMENDED APPROACH, ONE-LINE OPENER for Roger.
For follow-up, structure: What we discussed / What we agreed / What's next / When we'll circle back.

Tone: warm but efficient. Sign-off "— Roger, Pascal Logistics" for anything going to a prospect or client; leave internal briefs unsigned.

Return only a JSON object with keys: category, priority, summary, suggestedActions, draftResponseSubject, draftResponseBody, recipientRole ("prospect" / "client" / "internal").`;

  const userPrompt = `Executive Assistant request:
Event type: ${request.eventType}
Contact: ${request.contactName ?? "unknown"}${request.contactCompany ? ` at ${request.contactCompany}` : ""}${request.contactRole ? ` (${request.contactRole})` : ""}${request.contactEmail ? ` <${request.contactEmail}>` : ""}
Detail: ${request.requestDetail}
Meeting when: ${request.meetingWhenIso ?? "n/a"}
Onboarding step: ${request.onboardingStep ?? "n/a"}
Prior context: ${request.priorContext ?? "n/a"}

Onboarding checklist Pascal uses:
${AGENDA_ONBOARDING.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 900,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("EA: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category),
    priority: normalizePriority(parsed.priority),
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? draftSubject(request, "other")),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: normalizeRecipient(parsed.recipientRole),
    simulated: false,
  };
}

export async function persistDraft(request: EaRequest, output: EaOutput, sourceRef?: string) {
  const payload = { request, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent7_executive_assist', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [output.recipientRole === "internal" ? "internal_brief" : output.category, output.category, `${request.contactName ?? request.contactCompany ?? "EA"}: ${request.eventType}`, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent7_executive_assist'`,
  );
  return result.rows[0];
}

function heuristicCategory(r: EaRequest): EaCategory {
  const s = `${r.eventType} ${r.requestDetail}`.toLowerCase();
  if (/prep|brief/.test(s)) return "meeting_prep";
  if (/schedul|book|intro|call|meet/.test(s)) return "scheduling_request";
  if (/onboard|poa|w9|kickoff|first shipment/.test(s) || r.onboardingStep) return "onboarding_step";
  if (/follow.?up|recap|after|post/.test(s)) return "follow_up";
  if (/remind|chase/.test(s)) return "internal_reminder";
  return "other";
}

function draftSubject(r: EaRequest, cat: EaCategory): string {
  const who = r.contactName || r.contactCompany || "contact";
  if (cat === "scheduling_request") return `Times for our intro — ${who}`;
  if (cat === "meeting_prep") return `Prep brief — ${who}${r.meetingWhenIso ? ` (${r.meetingWhenIso.slice(0, 10)})` : ""}`;
  if (cat === "onboarding_step") return `Onboarding update — ${who}`;
  if (cat === "follow_up") return `Recap + next steps — ${who}`;
  if (cat === "internal_reminder") return `Reminder: ${r.requestDetail.slice(0, 80)}`;
  return `${who}: ${r.eventType}`;
}

function draftBody(r: EaRequest, cat: EaCategory): string {
  const name = r.contactName?.split(" ")[0] ?? "there";
  if (cat === "scheduling_request") {
    return `Hi ${name},\n\nHappy to set up an intro. A few times that work on our side (Pacific Time):\n\n• Tue · 10:30–11:00 AM PT\n• Wed · 1:00–1:30 PM PT\n• Thu · 9:00–9:30 AM PT\n\nLet me know which works and I'll send an invite with dial-in. If none of those work, share a few that do.\n\n— Roger, Pascal Logistics`;
  }
  if (cat === "meeting_prep") {
    return `PREP: ${r.contactName ?? "contact"} — ${r.meetingWhenIso ?? "TBD"}\n\nWHO: ${r.contactName ?? "?"}${r.contactCompany ? ` · ${r.contactCompany}` : ""}${r.contactRole ? ` · ${r.contactRole}` : ""}\nWHAT THEY WANT: ${r.requestDetail}\nPRIOR CONTEXT: ${r.priorContext ?? "first touch"}\nRECOMMENDED APPROACH: Anchor on their cross-border pain, mention Tier 1.5 as the likely fit, don't over-quote before we see volume.\nOPENER: "Thanks for making time — before I dive in, tell me what a good outcome looks like for you on this call."`;
  }
  if (cat === "onboarding_step") {
    return `Hi ${name},\n\nQuick onboarding update:\n\n${AGENDA_ONBOARDING.map((s) => `☐ ${s}`).join("\n")}\n\nCurrent step: ${r.onboardingStep ?? r.requestDetail}\n\nLet me know if anything's blocking — usually POA is the pinch-point.\n\n— Roger, Pascal Logistics`;
  }
  if (cat === "follow_up") {
    return `Hi ${name},\n\nThanks for the call today. Quick recap:\n\nWhat we discussed: ${r.requestDetail}\nWhat we agreed: [Roger to fill]\nWhat's next: [Roger to fill]\nWhen we'll circle back: [Roger to fill]\n\n— Roger, Pascal Logistics`;
  }
  return `${r.requestDetail}`;
}

function normalizeCategory(v: unknown): EaCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: EaCategory[] = ["scheduling_request", "meeting_prep", "onboarding_step", "follow_up", "internal_reminder", "other"];
  return (allowed as string[]).includes(s) ? (s as EaCategory) : "other";
}

function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}

function normalizeRecipient(v: unknown): "prospect" | "client" | "internal" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "prospect" || s === "client" || s === "internal" ? s : "client";
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}
