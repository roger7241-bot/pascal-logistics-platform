// ============================================================================
// AGENT 12 — BOOKING & DISPATCH  (display slot #5)
// Owns the load from tender through delivery: tenders to the selected carrier,
// confirms pickup, watches in-transit milestones, flags exceptions, closes out
// POD. Everything outbound (tender email, exception alert, ETA update) lands
// as a pending draft for Roger to review. Human-in-the-loop always.
//
// Live milestone feeds (EDI 214, carrier API, project44, macropoint) are
// wired in later phases. For the first build we accept a simulated event so
// Roger can watch the categorize + draft + review flow end-to-end.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type BookingCategory =
  | "tender"
  | "pickup_confirmation"
  | "in_transit_update"
  | "exception"
  | "pod_received"
  | "other";

export interface BookingEvent {
  shipmentRef: string;
  carrier: string;
  origin: string;
  destination: string;
  eventType: string;
  eventDetail: string;
  eventAtIso?: string;
  clientEmail?: string;
  clientName?: string;
}

export interface BookingOutput {
  category: BookingCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientEmail?: string;
  simulated: boolean;
}

const CATEGORY_GUIDANCE = `Categories:
- tender: we're offering the load to a carrier (dispatch email + rate confirmation)
- pickup_confirmation: carrier has arrived and picked up; notify client with tracking
- in_transit_update: routine milestone (border crossing, at terminal, out for delivery)
- exception: late pickup, missed appt, breakdown, weather delay, HOS shutdown, damage — needs Roger's decision
- pod_received: proof of delivery filed, shipment closed
- other: doesn't fit cleanly

Priority:
- urgent: any exception, delivery-day pickup miss, missed appointment window
- normal: routine updates, tender confirmations, POD receipts
- low: interior milestones (border cleared, arrived at terminal) that don't need client notification`;

const RESPONSE_TONE = `Tone: crisp operational, first-person plural, no jargon.
Recipient is either the carrier (for tenders) or the client (for updates/exceptions).
Never over-promise ETAs — always frame as "targeted for" or "on track for".
Sign-off: "— Roger, Pascal Logistics"`;

export async function categorizeAndDraft(event: BookingEvent): Promise<BookingOutput> {
  if (!client) {
    return {
      category: heuristicCategory(event),
      priority: /exception|late|miss|delay|damag|break/i.test(event.eventType + event.eventDetail) ? "urgent" : "normal",
      summary: `[Simulated] ${event.carrier} on ${event.shipmentRef} (${event.origin} → ${event.destination}): ${event.eventDetail}. This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      suggestedActions: ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      draftResponseSubject: `Update on ${event.shipmentRef}`,
      draftResponseBody: `Hi ${event.clientName ?? "there"},\n\nQuick update on shipment ${event.shipmentRef} moving ${event.origin} → ${event.destination}: ${event.eventDetail}\n\nI'll flag anything that changes on this.\n\n— Roger, Pascal Logistics`,
      recipientEmail: event.clientEmail,
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Booking & Dispatch agent (Agent 6). You own shipments from tender through delivery. You process carrier milestones and produce two kinds of outbound drafts: (a) tender emails to carriers, (b) status/exception updates to clients. Roger reviews and sends every draft.

${CATEGORY_GUIDANCE}

${RESPONSE_TONE}

Return a JSON object with these keys:
- category (one of the six category values)
- priority (urgent / normal / low)
- summary (one sentence for Roger — what happened, what it means)
- suggestedActions (array of 1–4 short imperative strings)
- draftResponseSubject (email subject line)
- draftResponseBody (email body, plain text with \\n line breaks)
- recipientEmail (who this goes to — the client for updates, carrier for tenders; omit if unclear)

Return only the JSON, no prose around it.`;

  const userPrompt = `Shipment event:
Shipment: ${event.shipmentRef}
Carrier: ${event.carrier}
Lane: ${event.origin} → ${event.destination}
Event type: ${event.eventType}
Event detail: ${event.eventDetail}
Occurred at: ${event.eventAtIso ?? "now"}
Client: ${event.clientName ? `${event.clientName} <${event.clientEmail ?? ""}>` : (event.clientEmail ?? "unknown")}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Booking & Dispatch: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category),
    priority: normalizePriority(parsed.priority),
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? `Update on ${event.shipmentRef}`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientEmail: typeof parsed.recipientEmail === "string" ? parsed.recipientEmail : event.clientEmail,
    simulated: false,
  };
}

export async function persistDraft(event: BookingEvent, output: BookingOutput, sourceRef?: string) {
  const payload = { event, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent12_booking_dispatch', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [output.category === "tender" ? "carrier_tender" : "shipment_update", output.category, `${event.shipmentRef}: ${event.eventType}`, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent12_booking_dispatch'`,
  );
  return result.rows[0];
}

function heuristicCategory(e: BookingEvent): BookingCategory {
  const s = `${e.eventType} ${e.eventDetail}`.toLowerCase();
  if (/tender|dispatch|rate con/.test(s)) return "tender";
  if (/pod|proof of delivery|delivered|signed/.test(s)) return "pod_received";
  if (/exception|late|delay|miss|damag|hos|breakdown|weather/.test(s)) return "exception";
  if (/pickup|picked up/.test(s)) return "pickup_confirmation";
  if (/border|terminal|out for delivery|in transit|customs cleared/.test(s)) return "in_transit_update";
  return "other";
}

function normalizeCategory(v: unknown): BookingCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: BookingCategory[] = ["tender", "pickup_confirmation", "in_transit_update", "exception", "pod_received", "other"];
  return (allowed as string[]).includes(s) ? (s as BookingCategory) : "other";
}

function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}
