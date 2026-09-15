// ============================================================================
// AGENT 6 — CHIEF OF STAFF
// Categorizes incoming operations@ emails and drafts responses for
// Roger to review, edit, and send. Human-in-the-loop is non-negotiable:
// nothing outbound goes without operator sign-off. Uses the same
// Anthropic SDK integration pattern as Agent 5, with an honest
// simulation path when no ANTHROPIC_API_KEY is configured so the
// review UI is testable end-to-end regardless.
//
// Inbound intake is external (Postmark webhook, SES, IMAP poll — TBD).
// For now, the /operator/agents/chief-of-staff/simulate endpoint
// injects a message via API so Roger can watch the categorize + draft
// + review flow end-to-end without a live inbox integration.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type ChiefOfStaffCategory = "quote_request" | "operational" | "billing" | "vendor" | "spam" | "other";

export interface InboundMessage {
  fromEmail: string;
  fromName?: string;
  subject: string;
  body: string;
  receivedAtIso?: string;
}

export interface ChiefOfStaffOutput {
  category: ChiefOfStaffCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  simulated: boolean;
}

const CATEGORY_GUIDANCE = `Categories:
- quote_request: prospect asking about pricing, tiers, our services, book a review
- operational: existing client asking about shipment status, exception, doc upload, tariff question
- billing: invoice question, retainer payment, receipt request, dispute
- vendor: broker / carrier / 3PL / insurance / bank / regulator communication
- spam: cold outreach unrelated to logistics, mass mail, phishing
- other: doesn't fit the above cleanly

Priority:
- urgent: shipment in transit needing decision, dispute with dollar value, regulatory deadline < 48h
- normal: default for legitimate inbox items
- low: informational, no action needed, marketing subscriptions we can't turn off`;

const RESPONSE_TONE = `Tone for drafts: warm and professional, first-person plural ("we"), never over-promise.
Never claim customs brokerage services (Pascal Logistics is NOT a licensed customs broker; we coordinate with the client's broker of record).
Sign-off: "— Roger, Pascal Logistics" (Roger reviews and sends, so the sign-off is his).
Keep drafts short — 3–6 sentences. If the request needs more info, ask for it directly instead of guessing.`;

export async function categorizeAndDraft(message: InboundMessage): Promise<ChiefOfStaffOutput> {
  if (!client) {
    // Deterministic simulated fallback so the review flow still works
    // without live Anthropic access. Not a hallucination; obviously fake.
    return {
      category: heuristicCategory(message),
      priority: "normal",
      summary: `[Simulated] Roger, ${message.fromName ?? message.fromEmail} wrote about "${message.subject}". This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      suggestedActions: ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      draftResponseSubject: `Re: ${message.subject}`,
      draftResponseBody: `Hi ${message.fromName ?? "there"},\n\nThanks for reaching out. I'll review and get back to you within the business day.\n\n— Roger, Pascal Logistics`,
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Chief of Staff (Agent 10). You triage incoming email to operations@pascallogistics.com and draft responses for Roger to review and send.

${CATEGORY_GUIDANCE}

${RESPONSE_TONE}

Return a JSON object with these keys:
- category (one of the six category values)
- priority (urgent / normal / low)
- summary (one sentence for Roger, plain English, includes sender + intent)
- suggestedActions (array of 1–4 short imperative strings — what Roger might do next)
- draftResponseSubject (email subject line)
- draftResponseBody (email body, plain text with \\n line breaks, no HTML)

Return only the JSON, no prose around it.`;

  const userPrompt = `Incoming email:
From: ${message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}
Subject: ${message.subject}

${message.body}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Chief of Staff: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category),
    priority: normalizePriority(parsed.priority),
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? `Re: ${message.subject}`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    simulated: false,
  };
}

// Persist the categorization + draft as an agent_draft awaiting operator review.
export async function persistDraft(message: InboundMessage, output: ChiefOfStaffOutput, sourceRef?: string) {
  const payload = {
    inbound: message,
    output,
  };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent6_chief_of_staff', 'email_response', $1, $2, $3, $4::jsonb)
     RETURNING *`,
    [output.category, message.subject, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent6_chief_of_staff'`,
  );
  return result.rows[0];
}

function heuristicCategory(msg: InboundMessage): ChiefOfStaffCategory {
  const s = `${msg.subject} ${msg.body}`.toLowerCase();
  if (/quote|pricing|book a review|tier|retainer/.test(s)) return "quote_request";
  if (/invoice|billing|payment|receipt/.test(s)) return "billing";
  if (/shipment|pars|paps|border|carrier|broker/.test(s)) return "operational";
  if (/unsubscribe|newsletter|sale ends|limited time/.test(s)) return "spam";
  return "other";
}

function normalizeCategory(v: unknown): ChiefOfStaffCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: ChiefOfStaffCategory[] = ["quote_request", "operational", "billing", "vendor", "spam", "other"];
  return (allowed as string[]).includes(s) ? (s as ChiefOfStaffCategory) : "other";
}

function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}

// Strip common markdown code fences the model sometimes wraps JSON in.
function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}
