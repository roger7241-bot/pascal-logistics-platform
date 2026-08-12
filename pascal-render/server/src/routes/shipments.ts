// ============================================================================
// POST /api/shipments/ingest
// Accepts a NewShipmentPayload from the Client Portal or email intake
// parser, runs the Agent 1-4 pipeline, and broadcasts the result over the
// executive_approval WebSocket channel so the Executive Review Drawer and
// CEO dashboard update live.
// ============================================================================

import { Router, type Request, type Response } from "express";
import type { NewShipmentPayload } from "../types/shipment.js";
import { runPipeline } from "../agents/pipeline.js";
import { pool } from "../db/pool.js";
import { logActivity } from "../services/activityLog.js";
import type { WsManager } from "../ws/wsManager.js";

export function createShipmentsRouter(wsManager: WsManager): Router {
  const router = Router();

  router.post("/ingest", async (req: Request, res: Response) => {
    const payload = req.body as Partial<NewShipmentPayload>;

    if (!payload || typeof payload !== "object" || !payload.shipper || !payload.consignee || !payload.cargo || !payload.customs || !payload.billing) {
      return res.status(400).json({
        error: "Malformed payload — shipper, consignee, cargo, customs, and billing sections are all required.",
      });
    }

    const normalizedPayload: NewShipmentPayload = {
      shipper: payload.shipper,
      consignee: payload.consignee,
      cargo: { ...payload.cargo, handlingUnits: payload.cargo.handlingUnits ?? [], isHazmat: payload.cargo.isHazmat ?? false },
      customs: { ...payload.customs, pgaFlags: payload.customs.pgaFlags ?? [] },
      billing: payload.billing,
      readyDateIso: payload.readyDateIso,
      source: payload.source ?? "manual_operator",
    };

    const result = runPipeline(normalizedPayload);

    // Persist a real draft record for the Executive Review Drawer when the
    // pipeline can't auto-dispatch — previously this was only returned in
    // the response body and never stored, so there was nothing for an
    // operator-side drawer to actually list.
    if (result.approvalStatus === "PENDING_ROGER_APPROVAL") {
      await pool.query(
        `INSERT INTO executive_drafts (shipment_id, draft_type, subject, body, rationale, confidence_score, status)
         VALUES ($1, 'shipment_approval', $2, $3, $4, $5, 'pending')`,
        [
          result.shipmentId,
          `Shipment review required — ${result.shipmentId}`,
          `Confidence score ${result.confidenceScore.toFixed(2)} fell below the 0.90 auto-dispatch threshold.`,
          result.validationErrors.join(" | ") || result.complianceFlags.join(" | ") || "Below confidence threshold.",
          result.confidenceScore,
        ],
      );
    }

    // Genuinely fixes the earlier $0 MTD-savings gap: every Agent 3 result
    // now persists here, so CEO metrics can sum real captured savings
    // instead of only reflecting paid invoice totals.
    if (result.rateOptimization) {
      const savingsUsd = result.rateOptimization.benchmarkSpotRateUsd - result.rateOptimization.contractedRateUsd;
      await pool.query(
        `INSERT INTO rate_optimizations (shipment_id, contracted_rate_usd, benchmark_spot_rate_usd, savings_usd, savings_flagged)
         VALUES ($1,$2,$3,$4,$5)`,
        [result.shipmentId, result.rateOptimization.contractedRateUsd, result.rateOptimization.benchmarkSpotRateUsd, savingsUsd, result.rateOptimization.savingsFlagged],
      );
      if (result.rateOptimization.savingsFlagged) {
        await logActivity("rate_savings_captured", `Agent 3 captured $${savingsUsd.toFixed(0)} savings on spot rate benchmark for ${result.shipmentId}.`, result.shipmentId, result.rateOptimization);
      }
    }

    await logActivity(
      result.approvalStatus === "AUTO_DISPATCHED" ? "paps_released" : "shipment_ingested",
      result.approvalStatus === "AUTO_DISPATCHED"
        ? `${result.shipmentId} auto-dispatched — confidence ${result.confidenceScore.toFixed(2)}.`
        : `${result.shipmentId} routed to Executive Review — confidence ${result.confidenceScore.toFixed(2)}.`,
      result.shipmentId,
    );

    wsManager.broadcastExecutiveApproval(result);
    wsManager.broadcastOcrResult({
      shipmentId: result.shipmentId,
      confidenceScore: result.confidenceScore,
      fieldsExtracted: 12 - result.validationErrors.length,
    });

    const statusCode = result.approvalStatus === "AUTO_DISPATCHED" ? 200 : 202;
    return res.status(statusCode).json(result);
  });

  return router;
}
