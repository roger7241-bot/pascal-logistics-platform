// ============================================================================
// AGENT 20 — AP FREIGHT SETTLEMENT (headless)
// Reconciles a carrier invoice against original tender + BOL, categorizes
// each variance (approved tolerance, disputed detention, disputed fuel,
// unauthorized accessorial), generates the voucher-batch row for QB /
// NetSuite / Dynamics export, and drafts a dispute notice for the carrier
// when needed. Any recovered dollars get logged to roi_credits so Agent 19
// picks them up in the monthly ROI report.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";
import { recordRoiCredit } from "./agent19RoiReporter.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export interface CarrierInvoiceLine {
  description: string;
  category: "linehaul" | "fuel" | "detention" | "layover" | "reweigh" | "accessorial" | "other";
  amountUsd: number;
  authorizedByTender: boolean;
  notes?: string;
}

export interface CarrierInvoiceSettlementInput {
  orgId: string;
  carrierName: string;
  carrierInvoiceNumber: string;
  shipmentRef?: string;
  tenderTotalUsd?: number;
  invoicedTotalUsd: number;
  lines: CarrierInvoiceLine[];
  tolerancePct?: number;                 // acceptable variance (default 2%)
}

export interface SettlementVerdict {
  status: "approved_for_pay" | "disputed";
  approvedTotalUsd: number;
  disputedLines: Array<{ line: CarrierInvoiceLine; disputeReason: string; refundClaimUsd: number }>;
  totalDisputeUsd: number;
  voucherBatchRef: string;
  disputeNoticeDraft?: string;
}

export async function reconcileInvoice(input: CarrierInvoiceSettlementInput): Promise<SettlementVerdict> {
  const tolerance = input.tolerancePct ?? 2;
  const tender = input.tenderTotalUsd ?? 0;
  const invoiceTotal = input.invoicedTotalUsd;
  const variance = invoiceTotal - tender;
  const variancePct = tender > 0 ? (variance / tender) * 100 : 0;
  const withinTolerance = tender > 0 && Math.abs(variancePct) <= tolerance;

  // Any line marked authorized_by_tender = false is a dispute candidate.
  // Deterministic first pass — no LLM needed for the math.
  const disputedLines = input.lines
    .filter((l) => !l.authorizedByTender && l.amountUsd > 0)
    .map((l) => ({
      line: l,
      disputeReason: l.category === "detention"
        ? "Detention charge without documented free-time exceedance in tender"
        : l.category === "fuel"
        ? "Fuel adjustment outside tender's fuel schedule"
        : l.category === "layover"
        ? "Layover not pre-authorized in original dispatch"
        : l.category === "reweigh"
        ? "Reweigh charge without tender-authorized reweigh"
        : `Unauthorized ${l.category} charge`,
      refundClaimUsd: l.amountUsd,
    }));

  const totalDispute = disputedLines.reduce((n, d) => n + d.refundClaimUsd, 0);
  const approvedTotal = invoiceTotal - totalDispute;
  const status: SettlementVerdict["status"] = disputedLines.length === 0 && withinTolerance ? "approved_for_pay" : "disputed";
  const voucherBatchRef = `VB-${input.orgId.slice(0, 8)}-${Date.now().toString().slice(-8)}`;

  let disputeNoticeDraft: string | undefined;
  if (disputedLines.length > 0) {
    if (client) {
      const systemPrompt = `${PASCAL_SYSTEM_PREFIX}

ROLE — You are the Pascal Logistics AP settlement utility (Agent 20). Draft a formal, professional dispute notice to the carrier's AR. No first-person personality. Signed as "Pascal Logistics AP" (system automation). Cite specific invoice line items, tender authorization, and the refund claim per line. Never emotional; strictly factual, contract-referenced.

Output ONLY the letter body — no JSON, no prose around it, no sign-off preamble. Include the sign-off "— Pascal Logistics AP · Carrier Settlement Desk" at the end.`;
      const userPrompt = `Carrier: ${input.carrierName}
Their invoice #: ${input.carrierInvoiceNumber}
Our shipment ref: ${input.shipmentRef ?? "n/a"}
Original tender total: $${tender.toFixed(2)}
Their invoice total: $${invoiceTotal.toFixed(2)}
Variance: $${variance.toFixed(2)} (${variancePct.toFixed(1)}% ${variance > 0 ? "over" : "under"} tender)

Disputed lines:
${disputedLines.map((d, i) => `${i + 1}. ${d.line.description} — ${d.line.category} — $${d.line.amountUsd.toFixed(2)} — Reason: ${d.disputeReason}`).join("\n")}

Total dispute: $${totalDispute.toFixed(2)}
Approved for payment: $${approvedTotal.toFixed(2)}
Voucher batch: ${voucherBatchRef}`;
      try {
        const response = await client.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 700,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });
        disputeNoticeDraft = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
      } catch (err) {
        console.error("AP dispute draft failed:", err);
      }
    } else {
      disputeNoticeDraft = `[SIMULATED — set ANTHROPIC_API_KEY for live draft]\n\nTo: ${input.carrierName} AR Department\nRe: Invoice ${input.carrierInvoiceNumber} — dispute notice\n\nWe are disputing $${totalDispute.toFixed(2)} across ${disputedLines.length} line item(s):\n${disputedLines.map((d, i) => `  ${i + 1}. ${d.line.description} ($${d.line.amountUsd.toFixed(2)}) — ${d.disputeReason}`).join("\n")}\n\nApproved for payment: $${approvedTotal.toFixed(2)} (voucher batch ${voucherBatchRef}).\n\n— Pascal Logistics AP · Carrier Settlement Desk`;
    }
  }

  // Persist the settlement row.
  await pool.query(
    `INSERT INTO carrier_invoice_settlements
       (org_id, carrier_name, carrier_invoice_number, shipment_ref,
        tender_amount_usd, invoiced_amount_usd, disputed_line_items, status, voucher_batch_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     ON CONFLICT (org_id, carrier_name, carrier_invoice_number) DO UPDATE
       SET disputed_line_items = EXCLUDED.disputed_line_items,
           status = EXCLUDED.status,
           voucher_batch_ref = EXCLUDED.voucher_batch_ref`,
    [
      input.orgId, input.carrierName, input.carrierInvoiceNumber, input.shipmentRef ?? null,
      input.tenderTotalUsd ?? null, invoiceTotal,
      JSON.stringify(disputedLines), status, voucherBatchRef,
    ],
  );

  // Any dispute claim gets logged as a roi_credit — even before the money's
  // recovered, we surface the value we caught. Reporter will roll it up.
  if (totalDispute > 0) {
    void recordRoiCredit({
      orgId: input.orgId,
      sourceAgentKey: "agent20_ap_settlement",
      creditType: "dispute_claim_filed",
      headline: `Caught ${disputedLines.length} unauthorized carrier charge${disputedLines.length === 1 ? "" : "s"} — $${totalDispute.toFixed(0)} refund claim filed with ${input.carrierName}.`,
      dollarValueUsd: totalDispute,
    }).catch((err) => console.error("ROI credit failed:", err));
  }

  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = $1, updated_at = now()
     WHERE agent_key = 'agent20_ap_settlement'`,
    [`reconciled:${status}`],
  );

  return {
    status,
    approvedTotalUsd: approvedTotal,
    disputedLines,
    totalDisputeUsd: totalDispute,
    voucherBatchRef,
    disputeNoticeDraft,
  };
}

// Batch export — QuickBooks / NetSuite compatible voucher row per approved settlement.
export async function exportVoucherBatch(orgId: string, batchRefsOrAll?: string[]): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [orgId];
  let where = `WHERE org_id = $1 AND status = 'approved_for_pay' AND voucher_batch_ref IS NOT NULL`;
  if (batchRefsOrAll?.length) {
    params.push(batchRefsOrAll);
    where += ` AND voucher_batch_ref = ANY($2::text[])`;
  }
  const result = await pool.query(
    `SELECT carrier_name, carrier_invoice_number, shipment_ref,
            invoiced_amount_usd, voucher_batch_ref, created_at
     FROM carrier_invoice_settlements ${where}
     ORDER BY created_at ASC`,
    params,
  );
  // Return QuickBooks-friendly row shape — the actual export to their file
  // format wires in when we have their auth.
  return result.rows.map((r) => ({
    vendor: r.carrier_name,
    bill_no: r.carrier_invoice_number,
    ref: r.shipment_ref ?? "",
    amount: Number(r.invoiced_amount_usd).toFixed(2),
    batch: r.voucher_batch_ref,
    dated: r.created_at,
  }));
}
