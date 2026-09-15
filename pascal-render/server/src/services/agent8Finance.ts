// ============================================================================
// AGENT 8 — FINANCE OPERATOR  (display slot #12)
// Stripe + QuickBooks reconciliation, invoice drafting, payment confirmation
// replies, past-due chase drafts (30 / 60 / 90 day cadence), monthly P&L
// snapshot for Roger. Everything outbound (invoice, chase, receipt) lands
// as a pending draft; nothing sends without Roger's sign-off.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type FinanceCategory =
  | "invoice_new"
  | "invoice_reminder"
  | "payment_confirmation"
  | "past_due_30"
  | "past_due_60"
  | "past_due_90"
  | "reconciliation_note"
  | "pnl_snapshot"
  | "other";

export interface FinanceEvent {
  clientName: string;
  clientEmail?: string;
  eventType: string;                // "invoice_new" | "payment_received" | "past_due" | "monthly_close" | ...
  eventDetail: string;
  invoiceNumber?: string;
  amountUsd?: number;
  currency?: "USD" | "CAD";
  daysPastDue?: number;
  paidAtIso?: string;
  dueAtIso?: string;
  stripeRef?: string;
  quickbooksRef?: string;
  serviceDescription?: string;
}

export interface FinanceOutput {
  category: FinanceCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  amountUsd: number;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "client" | "internal";
  simulated: boolean;
}

export async function categorizeAndDraft(event: FinanceEvent): Promise<FinanceOutput> {
  const amount = event.amountUsd ?? 0;
  const priority: FinanceOutput["priority"] = (event.daysPastDue ?? 0) >= 60 ? "urgent" : (event.daysPastDue ?? 0) >= 30 || /past.?due|failed/i.test(event.eventType) ? "normal" : "low";

  if (!client) {
    const cat = heuristicCategory(event);
    return {
      category: cat,
      priority,
      summary: `[Simulated] ${event.clientName}: ${event.eventDetail}${amount ? ` — $${amount.toLocaleString()} ${event.currency ?? "USD"}` : ""}${event.daysPastDue ? ` (${event.daysPastDue}d past due)` : ""}. This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      amountUsd: amount,
      suggestedActions: ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      draftResponseSubject: draftSubject(event, cat),
      draftResponseBody: draftBody(event, cat),
      recipientRole: cat === "reconciliation_note" || cat === "pnl_snapshot" ? "internal" : "client",
      simulated: true,
    };
  }

  const systemPrompt = `You are the Finance Operator for Pascal Logistics Inc. You handle Stripe + QuickBooks reconciliation, invoice drafting, payment confirmations, past-due chases, and month-end P&L snippets. Every outbound message lands as a draft for Roger to review and send.

Category set:
- invoice_new: send a fresh invoice
- invoice_reminder: gentle nudge before due date
- payment_confirmation: thank client, mark paid
- past_due_30 / past_due_60 / past_due_90: escalating tone by aging bucket
- reconciliation_note: internal-only, Stripe/QB mismatch or booking question
- pnl_snapshot: monthly P&L draft for Roger, internal only
- other

Priority: urgent for >= 60 days past due, normal for 30-59 or newly failed payments, low for on-time / paid.

Tone: crisp, professional, never anxious. On chase drafts escalate by aging bucket — 30d polite, 60d firm, 90d "before we pause service". Never threaten legal action in a draft. Sign-off: "— Roger, Pascal Logistics".

Return only a JSON object with keys: category, priority, summary, amountUsd (numeric), suggestedActions (array), draftResponseSubject, draftResponseBody, recipientRole ("client" or "internal").`;

  const userPrompt = `Finance event:
Client: ${event.clientName}${event.clientEmail ? ` <${event.clientEmail}>` : ""}
Event: ${event.eventType} — ${event.eventDetail}
Invoice: ${event.invoiceNumber ?? "n/a"}
Amount: ${event.amountUsd ? `$${event.amountUsd.toLocaleString()} ${event.currency ?? "USD"}` : "n/a"}
Service: ${event.serviceDescription ?? "n/a"}
Due: ${event.dueAtIso ?? "n/a"}
Paid: ${event.paidAtIso ?? "not paid"}
Days past due: ${event.daysPastDue ?? 0}
Stripe ref: ${event.stripeRef ?? "n/a"}
QuickBooks ref: ${event.quickbooksRef ?? "n/a"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Finance: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeCategory(parsed.category),
    priority: normalizePriority(parsed.priority),
    summary: String(parsed.summary ?? ""),
    amountUsd: typeof parsed.amountUsd === "number" ? parsed.amountUsd : amount,
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? draftSubject(event, "other")),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: parsed.recipientRole === "internal" ? "internal" : "client",
    simulated: false,
  };
}

export async function persistDraft(event: FinanceEvent, output: FinanceOutput, sourceRef?: string) {
  const payload = { event, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent8_finance', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [output.recipientRole === "internal" ? "internal_note" : output.category, output.category, `${event.clientName}: ${event.eventType}`, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent8_finance'`,
  );
  return result.rows[0];
}

function heuristicCategory(e: FinanceEvent): FinanceCategory {
  const s = `${e.eventType} ${e.eventDetail}`.toLowerCase();
  if (/paid|payment.received|stripe.success|invoice.settled/.test(s)) return "payment_confirmation";
  if (e.daysPastDue !== undefined && e.daysPastDue >= 90) return "past_due_90";
  if (e.daysPastDue !== undefined && e.daysPastDue >= 60) return "past_due_60";
  if (e.daysPastDue !== undefined && e.daysPastDue >= 30) return "past_due_30";
  if (/new.invoice|generate.invoice|invoice.request/.test(s)) return "invoice_new";
  if (/reminder|upcoming.due/.test(s)) return "invoice_reminder";
  if (/reconcil|mismatch|stripe.*quickbooks/.test(s)) return "reconciliation_note";
  if (/pnl|p&l|month.end|monthly.close/.test(s)) return "pnl_snapshot";
  return "other";
}

function draftSubject(e: FinanceEvent, cat: FinanceCategory): string {
  if (cat === "payment_confirmation") return `Payment received — Invoice ${e.invoiceNumber ?? ""}`.trim();
  if (cat === "past_due_30" || cat === "past_due_60" || cat === "past_due_90") return `Invoice ${e.invoiceNumber ?? ""} — ${e.daysPastDue ?? "?"} days past due`.trim();
  if (cat === "invoice_new") return `Invoice ${e.invoiceNumber ?? ""} — Pascal Logistics`.trim();
  if (cat === "invoice_reminder") return `Invoice ${e.invoiceNumber ?? ""} — reminder`.trim();
  return `${e.clientName} — ${e.eventType}`;
}

function draftBody(e: FinanceEvent, cat: FinanceCategory): string {
  const amt = e.amountUsd ? `$${e.amountUsd.toLocaleString()} ${e.currency ?? "USD"}` : "";
  if (cat === "payment_confirmation") return `Hi ${e.clientName},\n\nThanks — we've received your payment of ${amt} on invoice ${e.invoiceNumber ?? ""}. Your retainer is current.\n\n— Roger, Pascal Logistics`;
  if (cat === "past_due_30") return `Hi ${e.clientName},\n\nA quick nudge — invoice ${e.invoiceNumber ?? ""} for ${amt} is now ${e.daysPastDue ?? 30} days past due. If it slipped through, no problem — just let me know when you can turn it around.\n\n— Roger, Pascal Logistics`;
  if (cat === "past_due_60") return `Hi ${e.clientName},\n\nFollowing up — invoice ${e.invoiceNumber ?? ""} for ${amt} is ${e.daysPastDue ?? 60} days past due. Could you let me know when we can expect payment, or if there's anything blocking it on your end?\n\n— Roger, Pascal Logistics`;
  if (cat === "past_due_90") return `Hi ${e.clientName},\n\nInvoice ${e.invoiceNumber ?? ""} for ${amt} is now ${e.daysPastDue ?? 90} days past due. Before we need to pause service on the account, I'd like to get this resolved — please reply with a payment date or let me know what's happening.\n\n— Roger, Pascal Logistics`;
  if (cat === "invoice_new") return `Hi ${e.clientName},\n\nAttached: invoice ${e.invoiceNumber ?? ""} for ${amt}${e.serviceDescription ? ` — ${e.serviceDescription}` : ""}. Payable via the link on the invoice.\n\n— Roger, Pascal Logistics`;
  return `Hi ${e.clientName},\n\nRegarding ${e.eventType}: ${e.eventDetail}\n\n— Roger, Pascal Logistics`;
}

function normalizeCategory(v: unknown): FinanceCategory {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: FinanceCategory[] = ["invoice_new", "invoice_reminder", "payment_confirmation", "past_due_30", "past_due_60", "past_due_90", "reconciliation_note", "pnl_snapshot", "other"];
  return (allowed as string[]).includes(s) ? (s as FinanceCategory) : "other";
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
