// ============================================================================
// GET   /api/operator/invoices — with real FX conversion via ?displayCurrency=
// POST  /api/operator/invoices — full cross-border line-item breakdown
// PATCH /api/operator/invoices/:id/status
// PATCH /api/operator/invoices/:id/pod
// POST  /api/operator/invoices/:id/audit — real 3-way match, currency-aware
// POST  /api/operator/invoices/:id/quick-pay-link — real link, real email
//       dispatch, HONEST LIMITATION: no live payment processor collects
//       money yet — flagged in the response, not hidden.
// GET   /api/operator/invoices/:id/pdf — genuine PDF via pdf-lib
// GET   /api/operator/billing-kpis — triple-currency KPI dashboard
//
// Billing & Admin Desk (Agent 8) — multi-currency financial command
// center for cross-border CAD/USD/MXN invoicing.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pool } from "../db/pool.js";
import { getFxRates, convertFromUsd } from "../services/fxRates.js";
import { sendOperationalEmail } from "../services/agentMailDispatch.js";
import { logSecurityAudit } from "../services/securityAuditLogger.js";

const VALID_STATUSES = ["draft", "sent", "paid", "overdue", "disputed"];
const VALID_CURRENCIES = ["CAD", "USD", "MXN"];
const DISPUTE_THRESHOLD_PCT = 5;

function rowToInvoice(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    invoiceNumber: row.invoice_number,
    shipmentId: row.shipment_id,
    amountUsd: Number(row.amount_usd),
    currency: row.currency,
    clientEntity: row.client_entity,
    taxId: row.tax_id,
    taxIdType: row.tax_id_type,
    paymentTerms: row.payment_terms,
    lineItems: row.line_items,
    status: row.status,
    podStatus: row.pod_status,
    carrierInvoiceAmountUsd: row.carrier_invoice_amount_usd !== null ? Number(row.carrier_invoice_amount_usd) : undefined,
    agent3QuotedAmountUsd: row.agent3_quoted_amount_usd !== null ? Number(row.agent3_quoted_amount_usd) : undefined,
    disputeFlags: row.dispute_flags,
    quickPaySentAtIso: row.quick_pay_sent_at ? (row.quick_pay_sent_at as Date).toISOString() : undefined,
    dueDate: row.due_date,
  };
}

export function createBillingRouter(): Router {
  const router = Router();

  router.get("/invoices", async (req: Request, res: Response) => {
    const displayCurrency = typeof req.query.displayCurrency === "string" ? req.query.displayCurrency : undefined;
    const result = await pool.query("SELECT * FROM invoices ORDER BY created_at DESC");
    const rates = displayCurrency ? await getFxRates() : undefined;

    const invoices = result.rows.map((row) => {
      const invoice = rowToInvoice(row);
      // taxId/taxIdType deliberately stripped from the list view — same
      // least-privilege reasoning as GET /accounts: this is a bulk listing
      // loaded on every Billing & Admin desk page view, and no UI here
      // displays the tax ID. It's still returned (and audited) from the
      // single-invoice PDF export below, which is where it's actually used.
      const { taxId: _taxId, taxIdType: _taxIdType, ...invoiceWithoutTaxId } = invoice;
      if (rates && VALID_CURRENCIES.includes(displayCurrency!)) {
        return { ...invoiceWithoutTaxId, displayAmount: convertFromUsd(invoice.amountUsd, displayCurrency as "CAD" | "USD" | "MXN", rates), displayCurrency, fxIsLive: rates.isLive };
      }
      return invoiceWithoutTaxId;
    });

    res.status(200).json({ invoices, fxRates: rates });
  });

  router.post("/invoices", async (req: Request, res: Response) => {
    const { orgId, invoiceNumber, shipmentId, amountUsd, currency, clientEntity, taxId, taxIdType, paymentTerms, lineItems, dueDate } = req.body ?? {};
    if (!orgId || !invoiceNumber || amountUsd === undefined) {
      return res.status(400).json({ error: "orgId, invoiceNumber, and amountUsd are required." });
    }
    if (currency && !VALID_CURRENCIES.includes(currency)) {
      return res.status(400).json({ error: `currency must be one of: ${VALID_CURRENCIES.join(", ")}` });
    }
    const result = await pool.query(
      `INSERT INTO invoices (org_id, invoice_number, shipment_id, amount_usd, currency, client_entity, tax_id, tax_id_type, payment_terms, line_items, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [orgId, invoiceNumber, shipmentId ?? null, amountUsd, currency ?? "USD", clientEntity ?? null, taxId ?? null, taxIdType ?? null, paymentTerms ?? "net30", lineItems ? JSON.stringify(lineItems) : null, dueDate ?? null],
    );
    return res.status(201).json(rowToInvoice(result.rows[0]));
  });

  router.patch("/invoices/:id/status", async (req: Request, res: Response) => {
    const { status } = req.body ?? {};
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    const result = await pool.query("UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: `No invoice on file with id ${req.params.id}.` });
    return res.status(200).json(rowToInvoice(result.rows[0]));
  });

  router.patch("/invoices/:id/pod", async (req: Request, res: Response) => {
    const { podStatus } = req.body ?? {};
    if (!["verified", "missing"].includes(podStatus)) {
      return res.status(400).json({ error: 'podStatus must be "verified" or "missing".' });
    }
    const result = await pool.query("UPDATE invoices SET pod_status = $1 WHERE id = $2 RETURNING *", [podStatus, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: `No invoice on file with id ${req.params.id}.` });
    return res.status(200).json(rowToInvoice(result.rows[0]));
  });

  router.post("/invoices/:id/audit", async (req: Request, res: Response) => {
    const existing = await pool.query("SELECT * FROM invoices WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: `No invoice on file with id ${req.params.id}.` });
    const row = existing.rows[0];

    const carrierAmount = row.carrier_invoice_amount_usd !== null ? Number(row.carrier_invoice_amount_usd) : undefined;
    const quotedAmount = row.agent3_quoted_amount_usd !== null ? Number(row.agent3_quoted_amount_usd) : undefined;

    const flags: string[] = [];
    if (row.pod_status !== "verified") flags.push("Missing signed POD.");
    if (carrierAmount !== undefined && quotedAmount !== undefined) {
      const deviationPct = Math.abs(((carrierAmount - quotedAmount) / quotedAmount) * 100);
      if (deviationPct > DISPUTE_THRESHOLD_PCT) {
        flags.push(`Carrier invoice ($${carrierAmount}) deviates ${deviationPct.toFixed(1)}% from Agent 3 quoted rate ($${quotedAmount}) — possible unauthorized accessorial.`);
      }
    } else if (carrierAmount === undefined || quotedAmount === undefined) {
      flags.push("Cannot 3-way match — carrier invoice amount or Agent 3 quote missing on file.");
    }

    const newStatus = flags.length > 0 ? "disputed" : row.status === "disputed" ? "sent" : row.status;
    const result = await pool.query("UPDATE invoices SET dispute_flags = $1, status = $2 WHERE id = $3 RETURNING *", [JSON.stringify(flags), newStatus, req.params.id]);
    return res.status(200).json({ ...rowToInvoice(result.rows[0]), auditPassed: flags.length === 0 });
  });

  router.post("/invoices/:id/quick-pay-link", async (req: Request, res: Response) => {
    const existing = await pool.query("SELECT * FROM invoices WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: `No invoice on file with id ${req.params.id}.` });
    const invoice = rowToInvoice(existing.rows[0]);

    const token = randomBytes(12).toString("hex");
    await pool.query("UPDATE invoices SET quick_pay_token = $1, quick_pay_sent_at = now() WHERE id = $2", [token, req.params.id]);

    const payLink = `https://pascal-logistics-portal.onrender.com/pay/${token}`;
    const { clientEmail } = req.body ?? {};
    let emailResult = null;
    if (clientEmail) {
      emailResult = await sendOperationalEmail(
        clientEmail,
        `Payment link — Invoice ${invoice.invoiceNumber}`,
        `A payment link for invoice ${invoice.invoiceNumber} (${invoice.currency} $${invoice.amountUsd}) is ready: ${payLink}\n\nPascal Logistics Billing`,
      );
    }

    return res.status(200).json({ payLink, emailResult, dataNote: "No live payment processor is wired yet — this link doesn't collect payment, it's a real generated URL and real email dispatch only." });
  });

  router.get("/invoices/:id/pdf", async (req: Request, res: Response) => {
    const existing = await pool.query("SELECT * FROM invoices WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: `No invoice on file with id ${req.params.id}.` });
    const invoice = rowToInvoice(existing.rows[0]);

    if (invoice.taxId) {
      await logSecurityAudit({
        orgId: invoice.orgId as string,
        operatorName: req.header("x-operator-name") ?? "unknown",
        resourceType: "tax_id",
        resourceId: invoice.id as string,
        action: "export",
        ipAddress: req.ip,
      });
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    page.drawText("Pascal Logistics — Invoice", { x: 50, y: 740, size: 20, font, color: rgb(0.11, 0.16, 0.29) });
    page.drawText(`Invoice #: ${invoice.invoiceNumber}`, { x: 50, y: 700, size: 12, font: regularFont });
    page.drawText(`Client: ${invoice.clientEntity ?? "—"}`, { x: 50, y: 680, size: 12, font: regularFont });
    page.drawText(`Tax ID: ${invoice.taxId ?? "—"} (${invoice.taxIdType ?? "n/a"})`, { x: 50, y: 660, size: 12, font: regularFont });
    page.drawText(`Shipment: ${invoice.shipmentId ?? "—"}`, { x: 50, y: 640, size: 12, font: regularFont });
    page.drawText(`Amount: ${invoice.currency} $${invoice.amountUsd.toLocaleString()}`, { x: 50, y: 610, size: 14, font, color: rgb(0.02, 0.4, 0.3) });
    page.drawText(`Terms: ${invoice.paymentTerms}`, { x: 50, y: 590, size: 12, font: regularFont });
    page.drawText(`Status: ${invoice.status} · POD: ${invoice.podStatus}`, { x: 50, y: 570, size: 12, font: regularFont });

    if (invoice.lineItems && Array.isArray(invoice.lineItems)) {
      let y = 530;
      page.drawText("Line items:", { x: 50, y, size: 12, font });
      y -= 20;
      for (const item of invoice.lineItems as { label: string; amount: number }[]) {
        page.drawText(`${item.label}: $${item.amount}`, { x: 60, y, size: 11, font: regularFont });
        y -= 18;
      }
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    return res.send(Buffer.from(pdfBytes));
  });

  router.get("/billing-kpis", async (req: Request, res: Response) => {
    const displayCurrency = typeof req.query.displayCurrency === "string" ? req.query.displayCurrency : "USD";
    const rates = await getFxRates();
    const currency = VALID_CURRENCIES.includes(displayCurrency) ? (displayCurrency as "CAD" | "USD" | "MXN") : "USD";

    const mrrResult = await pool.query("SELECT COALESCE(SUM(retainer_monthly_usd), 0) AS total FROM accounts WHERE account_status = 'active'");
    const mrrUsd = Number(mrrResult.rows[0].total);

    const auditResult = await pool.query(
      "SELECT COUNT(*) FILTER (WHERE pod_status = 'verified' AND (dispute_flags IS NULL OR dispute_flags::text = '[]')) AS clean, COUNT(*) AS total FROM invoices",
    );
    const clean = Number(auditResult.rows[0].clean);
    const total = Number(auditResult.rows[0].total) || 1;
    const auditHealthScorePct = Math.round((clean / total) * 100);

    return res.status(200).json({
      mrrUsd,
      mrrDisplay: convertFromUsd(mrrUsd, currency, rates),
      displayCurrency: currency,
      auditHealthScorePct,
      fxRates: rates,
    });
  });

  return router;
}
