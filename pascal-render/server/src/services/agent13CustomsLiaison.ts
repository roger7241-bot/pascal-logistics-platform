// ============================================================================
// AGENT 13 — CUSTOMS LIAISON  (display slot #6)
// Coordinates with the CLIENT'S customs broker of record. Pascal Logistics is
// NOT a licensed customs broker on either side of the border — this agent
// monitors the entry through the broker on file, confirms doc packet
// completeness, tracks entry status, and flags holds/exams. Every outbound
// message (to broker, to client) lands as a pending draft for Roger review.
//
// The doc-packet check is the single most valuable thing this agent does:
// USMCA cert missing → entry filed as MFN → client pays duty that could have
// been zero. Catching that before the entry files is the whole point.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";
import { createTask } from "./orchestrator.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type CustomsCategory =
  | "docs_check"
  | "broker_packet_sent"
  | "entry_filed"
  | "hold_or_exam"
  | "release_confirmed"
  | "missing_doc"
  | "other";

export interface CustomsEvent {
  shipmentRef: string;
  direction: "north_to_south" | "south_to_north" | "domestic";
  brokerName: string;
  brokerEmail?: string;
  eventType: string;
  eventDetail: string;
  hasCommercialInvoice: boolean;
  hasPackingList: boolean;
  hasUsmcaCert: boolean;
  hasPoaOnFile: boolean;
  isDg: boolean;
  hasDgPapers: boolean;
  entryNumber?: string;
  clientEmail?: string;
  clientName?: string;
}

export interface CustomsOutput {
  category: CustomsCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  docPacketIssues: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "broker" | "client" | "internal";
  simulated: boolean;
}

const CATEGORY_GUIDANCE = `Categories:
- docs_check: pre-entry review of the doc packet before broker files
- broker_packet_sent: we've forwarded the complete packet to the broker on file
- entry_filed: broker has filed entry (CBSA / CBP entry number issued)
- hold_or_exam: CBP/CBSA has placed hold, exam, or manifest hold — client needs to know
- release_confirmed: entry released, cargo can move
- missing_doc: broker or agency flagged a missing / defective document
- other: doesn't fit cleanly

Priority:
- urgent: any hold, exam, missing doc that blocks release, penalty risk
- normal: routine packet checks and status updates
- low: informational post-release notes`;

const RESPONSE_TONE = `Tone: precise, factual, no ambiguity.
CRITICAL: Pascal Logistics is NOT a licensed customs broker. Never phrase anything as if we are filing entries ourselves. Always position as coordinating with the broker of record. Never give binding classification or valuation advice — we flag issues for the broker to rule on.
Sign-off: "— Roger, Pascal Logistics"`;

export async function categorizeAndDraft(event: CustomsEvent): Promise<CustomsOutput> {
  const packetIssues = auditPacket(event);

  if (!client) {
    return {
      category: heuristicCategory(event, packetIssues),
      priority: packetIssues.length > 0 || /hold|exam|penalty|missing/i.test(event.eventType + event.eventDetail) ? "urgent" : "normal",
      summary: `[Simulated] ${event.shipmentRef} ${event.direction}, broker ${event.brokerName}: ${event.eventDetail}. ${packetIssues.length > 0 ? `Doc packet issues: ${packetIssues.join("; ")}.` : "Doc packet appears complete."} This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      suggestedActions: packetIssues.length > 0 ? packetIssues.map((issue) => `Resolve: ${issue}`) : ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      docPacketIssues: packetIssues,
      draftResponseSubject: `${event.shipmentRef} — packet for ${event.brokerName}`,
      draftResponseBody: `Hi ${event.brokerName} team,\n\nSending you the packet for shipment ${event.shipmentRef} for your review before entry. Full docs attached${packetIssues.length > 0 ? `. Flagging: ${packetIssues.join("; ")}` : ""}.\n\nPlease confirm receipt and let us know if you need anything else from the shipper.\n\n— Roger, Pascal Logistics`,
      recipientRole: "broker",
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Customs Liaison agent (Agent 7). You coordinate with the client's customs broker of record — Pascal Logistics is NOT a licensed customs broker and never files entries directly. You audit doc packets before entry, forward packets to the broker, track entry status, and flag holds or exams.

${CATEGORY_GUIDANCE}

${RESPONSE_TONE}

Return a JSON object with these keys:
- category (one of the seven category values)
- priority (urgent / normal / low)
- summary (one sentence for Roger)
- suggestedActions (array of 1–4 short imperative strings)
- docPacketIssues (array of specific missing/defective doc items, or empty)
- draftResponseSubject (email subject)
- draftResponseBody (email body, plain text)
- recipientRole ("broker" if this goes to the broker on file, "client" if this notifies the client, "internal" if this is for Roger only)

Return only the JSON, no prose around it.`;

  const userPrompt = `Customs event:
Shipment: ${event.shipmentRef}
Direction: ${event.direction}
Broker on file: ${event.brokerName}${event.brokerEmail ? ` <${event.brokerEmail}>` : ""}
Event type: ${event.eventType}
Event detail: ${event.eventDetail}
Entry number: ${event.entryNumber ?? "not yet issued"}
Client: ${event.clientName ?? "unknown"}${event.clientEmail ? ` <${event.clientEmail}>` : ""}

Doc packet on file:
- Commercial invoice: ${event.hasCommercialInvoice ? "yes" : "MISSING"}
- Packing list: ${event.hasPackingList ? "yes" : "MISSING"}
- USMCA certificate of origin: ${event.hasUsmcaCert ? "yes" : "not on file"}
- POA current with broker: ${event.hasPoaOnFile ? "yes" : "MISSING"}
- DG shipment: ${event.isDg ? "YES" : "no"}
- DG papers (if applicable): ${event.isDg ? (event.hasDgPapers ? "yes" : "MISSING") : "n/a"}

Pre-audit found these packet issues: ${auditPacket(event).join("; ") || "none"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Customs Liaison: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category),
    priority: normalizePriority(parsed.priority),
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    docPacketIssues: Array.isArray(parsed.docPacketIssues) ? parsed.docPacketIssues.map(String) : packetIssues,
    draftResponseSubject: String(parsed.draftResponseSubject ?? `${event.shipmentRef} — customs update`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: normalizeRecipient(parsed.recipientRole),
    simulated: false,
  };
}

export async function persistDraft(event: CustomsEvent, output: CustomsOutput, sourceRef?: string) {
  const payload = { event, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent13_customs_liaison', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [output.recipientRole === "broker" ? "broker_message" : output.recipientRole === "client" ? "client_customs_update" : "internal_note", output.category, `${event.shipmentRef}: ${event.eventType}`, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent13_customs_liaison'`,
  );

  // Cross-agent handoff: if the packet audit surfaced a missing USMCA cert,
  // hand off to Customer Service (Agent 8, key agent5_client_chat) so they
  // draft the client outreach. Roger sees the trail in the Task board.
  const missingUsmca = output.docPacketIssues.find((s) => /usmca/i.test(s));
  if (missingUsmca && event.direction !== "domestic") {
    await createTask({
      taskType: "usmca_missing_alert",
      originAgentKey: "agent13_customs_liaison",
      nextAgentKey: "agent5_client_chat", // Customer Service (display slot 8)
      subject: `USMCA cert missing — ${event.shipmentRef}`,
      payload: {
        shipmentRef: event.shipmentRef,
        direction: event.direction,
        brokerName: event.brokerName,
        estimatedImpact: "Will file at MFN duty rate unless resolved before entry — usually 3-10% duty depending on HS classification.",
      },
      originContribution: `Pre-entry packet audit flagged missing USMCA cert of origin on ${event.shipmentRef}. ${missingUsmca}`,
      linkedDraftId: result.rows[0].id as string,
      humanGateReason: "Confirm client is USMCA-qualifying before we draft outreach",
    });
  }

  return result.rows[0];
}

// Deterministic pre-audit — independent of LLM, so packet gaps are caught
// even when Anthropic is unavailable. Cross-border shipments need extras.
function auditPacket(e: CustomsEvent): string[] {
  const issues: string[] = [];
  const isCrossBorder = e.direction !== "domestic";
  if (isCrossBorder) {
    if (!e.hasCommercialInvoice) issues.push("commercial invoice missing");
    if (!e.hasPackingList) issues.push("packing list missing");
    if (!e.hasPoaOnFile) issues.push("POA with broker not on file or expired");
    if (!e.hasUsmcaCert) issues.push("USMCA certificate of origin missing — will file at MFN duty rate unless resolved");
  }
  if (e.isDg && !e.hasDgPapers) issues.push("DG shipment missing dangerous-goods declaration");
  return issues;
}

function heuristicCategory(e: CustomsEvent, issues: string[]): CustomsCategory {
  const s = `${e.eventType} ${e.eventDetail}`.toLowerCase();
  if (issues.length > 0) return "missing_doc";
  if (/hold|exam/.test(s)) return "hold_or_exam";
  if (/released|release confirmed/.test(s)) return "release_confirmed";
  if (/entry number|entry filed/.test(s)) return "entry_filed";
  if (/packet sent|forwarded/.test(s)) return "broker_packet_sent";
  if (/docs check|pre-entry/.test(s)) return "docs_check";
  return "other";
}

function normalizeCategory(v: unknown): CustomsCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: CustomsCategory[] = ["docs_check", "broker_packet_sent", "entry_filed", "hold_or_exam", "release_confirmed", "missing_doc", "other"];
  return (allowed as string[]).includes(s) ? (s as CustomsCategory) : "other";
}

function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}

function normalizeRecipient(v: unknown): "broker" | "client" | "internal" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "broker" || s === "client" || s === "internal" ? s : "broker";
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}
