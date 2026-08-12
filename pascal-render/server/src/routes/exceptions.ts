// ============================================================================
// POST /api/exceptions/detect — runs detection + fault classification
// POST /api/exceptions/:id/dispute — generates the executive dispute draft
// Now persisted to Postgres instead of an in-memory Map.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import type { ExceptionRecord, FacilityCheckIn } from "../types/exception.js";
import { detectException, generateRebookingOptions } from "../services/exceptionRebookingEngine.js";
import { generateExecutiveDisputeDraft } from "../services/executiveDisputeDraft.js";
import type { WsManager } from "../ws/wsManager.js";

function rowToException(row: Record<string, unknown>): ExceptionRecord {
  return {
    id: row.id as string,
    shipmentId: row.shipment_id as string,
    type: row.type as ExceptionRecord["type"],
    minutesPastWindow: row.minutes_past_window as number,
    faultClassification: row.fault_classification as ExceptionRecord["faultClassification"],
    faultReasoning: row.fault_reasoning as string,
    detectedAtIso: (row.detected_at as Date).toISOString(),
  };
}

export function createExceptionsRouter(_wsManager: WsManager): Router {
  const router = Router();

  router.post("/detect", async (req: Request, res: Response) => {
    const checkIn = req.body as Partial<FacilityCheckIn>;
    if (!checkIn.shipmentId || !checkIn.type || !checkIn.scheduledWindowStartIso || !checkIn.scheduledWindowEndIso) {
      return res.status(400).json({ error: "shipmentId, type, scheduledWindowStartIso, and scheduledWindowEndIso are required." });
    }

    const exception = detectException(checkIn as FacilityCheckIn);
    if (!exception) {
      return res.status(200).json({ exceptionDetected: false, message: "Within grace period or vehicle already checked in — no exception." });
    }

    const result = await pool.query(
      `INSERT INTO exceptions (id, shipment_id, type, minutes_past_window, fault_classification, fault_reasoning, detected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [exception.id, exception.shipmentId, exception.type, exception.minutesPastWindow, exception.faultClassification, exception.faultReasoning, exception.detectedAtIso],
    );
    const persisted = rowToException(result.rows[0]);
    const rebookingOptions = generateRebookingOptions(persisted);

    return res.status(200).json({ exceptionDetected: true, exception: persisted, rebookingOptions });
  });

  router.post("/:id/dispute", async (req: Request, res: Response) => {
    const result = await pool.query("SELECT * FROM exceptions WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `No exception on file with id ${req.params.id}.` });
    }
    const exception = rowToException(result.rows[0]);

    const carrierName = typeof req.body?.carrierName === "string" ? req.body.carrierName : "Carrier";

    try {
      const draft = generateExecutiveDisputeDraft(exception, carrierName);
      return res.status(200).json(draft);
    } catch (err) {
      return res.status(409).json({ error: err instanceof Error ? err.message : "Could not generate dispute draft." });
    }
  });

  return router;
}
