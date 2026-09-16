// ============================================================================
// UTILITY AGENT ROUTES — ROI reporter + AP settlement + ERP bridge preview
// All operator-scoped (Roger + Elena see them). ERP webhook mounts publicly.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { generateMonthlyRoi, previewUnreportedCredits, recordRoiCredit } from "../services/agent19RoiReporter.js";
import { reconcileInvoice, exportVoucherBatch, type CarrierInvoiceSettlementInput } from "../services/agent20ApSettlement.js";
import { ingestEvent, listRecentEvents } from "../services/agent21ErpBridge.js";
import { pool } from "../db/pool.js";

export function createUtilityAgentRouter(): Router {
  const router = Router();

  // -------- ROI Reporter (Agent 19) --------
  router.get("/accounts/:orgId/roi-credits", async (req: Request, res: Response) => {
    const credits = await previewUnreportedCredits(req.params.orgId);
    return res.status(200).json({ credits });
  });
  router.post("/accounts/:orgId/roi-credits", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.sourceAgentKey || !b.creditType || !b.headline || typeof b.dollarValueUsd !== "number") {
      return res.status(400).json({ error: "sourceAgentKey, creditType, headline, dollarValueUsd required." });
    }
    const id = await recordRoiCredit({
      orgId: req.params.orgId,
      sourceAgentKey: String(b.sourceAgentKey),
      creditType: String(b.creditType),
      headline: String(b.headline),
      dollarValueUsd: b.dollarValueUsd,
      hoursSavedValueUsd: typeof b.hoursSavedValueUsd === "number" ? b.hoursSavedValueUsd : undefined,
      linkedDraftId: b.linkedDraftId ? String(b.linkedDraftId) : undefined,
      linkedTaskId: b.linkedTaskId ? String(b.linkedTaskId) : undefined,
    });
    return res.status(201).json({ id });
  });
  router.post("/accounts/:orgId/roi-report/generate", async (req: Request, res: Response) => {
    const targetMonth = typeof req.body?.targetMonthIso === "string" ? req.body.targetMonthIso : undefined;
    const summary = await generateMonthlyRoi(req.params.orgId, targetMonth);
    if (!summary) return res.status(404).json({ error: "No unreported credits for that month." });
    return res.status(200).json({ summary });
  });

  // -------- AP Settlement (Agent 20) --------
  router.post("/accounts/:orgId/ap-settlement/reconcile", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.carrierName || !b.carrierInvoiceNumber || typeof b.invoicedTotalUsd !== "number" || !Array.isArray(b.lines)) {
      return res.status(400).json({ error: "carrierName, carrierInvoiceNumber, invoicedTotalUsd, lines[] required." });
    }
    const input: CarrierInvoiceSettlementInput = {
      orgId: req.params.orgId,
      carrierName: String(b.carrierName),
      carrierInvoiceNumber: String(b.carrierInvoiceNumber),
      shipmentRef: b.shipmentRef ? String(b.shipmentRef) : undefined,
      tenderTotalUsd: typeof b.tenderTotalUsd === "number" ? b.tenderTotalUsd : undefined,
      invoicedTotalUsd: b.invoicedTotalUsd,
      lines: b.lines,
      tolerancePct: typeof b.tolerancePct === "number" ? b.tolerancePct : undefined,
    };
    const verdict = await reconcileInvoice(input);
    return res.status(200).json({ verdict });
  });
  router.get("/accounts/:orgId/ap-settlement/voucher-batch.json", async (req: Request, res: Response) => {
    const batchRefs = typeof req.query.batchRefs === "string" ? req.query.batchRefs.split(",") : undefined;
    const rows = await exportVoucherBatch(req.params.orgId, batchRefs);
    return res.status(200).json({ rows });
  });
  router.get("/accounts/:orgId/ap-settlement/pending", async (req: Request, res: Response) => {
    const result = await pool.query(
      `SELECT * FROM carrier_invoice_settlements
       WHERE org_id = $1 AND status IN ('pending_review', 'disputed')
       ORDER BY created_at DESC LIMIT 100`,
      [req.params.orgId],
    );
    return res.status(200).json({ settlements: result.rows });
  });

  // -------- ERP Bridge (Agent 21) --------
  router.get("/accounts/:orgId/erp-ingestion-events", async (req: Request, res: Response) => {
    const days = req.query.days ? Math.min(30, Math.max(1, Number(req.query.days))) : 3;
    const events = await listRecentEvents(req.params.orgId, days);
    return res.status(200).json({ events });
  });

  return router;
}

// Public ERP webhook — mounted on /api/webhooks before auth so client ERPs
// can POST without a session. Client is identified by orgId in the path.
export function createErpWebhookRouter(): Router {
  const router = Router();
  router.post("/erp/:orgId/:provider", async (req: Request, res: Response) => {
    try {
      const result = await ingestEvent(req.params.orgId, req.params.provider, req.body ?? {});
      return res.status(result.deduped ? 200 : 201).json(result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Ingest failed." });
    }
  });
  return router;
}
