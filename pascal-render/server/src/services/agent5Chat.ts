// ============================================================================
// AGENT 5 EMBEDDED ASSISTANT
// Real Claude-powered chat, scoped to the client's own org data (shipments,
// POA status) — not a generic chatbot. Same real/fallback pattern as
// documentExtraction.ts: falls back to a clearly-labeled canned response
// when no ANTHROPIC_API_KEY is configured, but the actual call is real.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export interface ChatResult {
  reply: string;
  simulated: boolean;
}

async function buildOrgContext(orgId: string): Promise<string> {
  const poaResult = await pool.query("SELECT status, expires_at FROM poa_records WHERE org_id = $1", [orgId]);
  const poa = poaResult.rows[0];

  const invoiceResult = await pool.query("SELECT COUNT(*) AS overdue FROM invoices WHERE org_id = $1 AND status = 'overdue'", [orgId]);
  const overdueInvoices = Number(invoiceResult.rows[0]?.overdue ?? 0);

  return [
    `Customs POA status: ${poa?.status ?? "unknown"}${poa?.expires_at ? `, expires ${new Date(poa.expires_at).toDateString()}` : ""}.`,
    `Overdue invoices: ${overdueInvoices}.`,
    `Note: live shipment tracking data is available via GET /api/client/shipments — the assistant should refer the client there for specific shipment status rather than guess.`,
  ].join(" ");
}

export async function askAgent5(orgId: string, question: string): Promise<ChatResult> {
  if (!client) {
    return {
      simulated: true,
      reply: `[Simulated — no ANTHROPIC_API_KEY configured] I'd normally answer "${question}" using your live shipment and POA data. Once an API key is set, this becomes a real AI-powered response.`,
    };
  }

  try {
    const context = await buildOrgContext(orgId);
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      system:
        "You are Agent 5, Pascal Logistics' client support assistant. Answer only using the account context provided. Be concise and grounded — no filler, no robotic AI clichés. If the question needs data you don't have, say so plainly and point to the right place in the portal rather than guessing.",
      messages: [{ role: "user", content: `Account context: ${context}\n\nClient question: ${question}` }],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return { simulated: false, reply: textBlock?.text ?? "I couldn't generate a response — please try rephrasing." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { simulated: false, reply: `Something went wrong reaching the assistant: ${message}` };
  }
}
