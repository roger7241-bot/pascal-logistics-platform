// ============================================================================
// GET   /api/operator/executive-drafts
// PATCH /api/operator/executive-drafts/:id/decide
// Executive Review Drawer (Agent 9 / Roger Jervis Desk) — lists real
// persisted PENDING_ROGER_APPROVAL drafts (from the shipment pipeline and
// dispute-letter generation) and records the executive's decision.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";

function rowToDraft(row: Record<string, unknown>) {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    draftType: row.draft_type,
    subject: row.subject,
    body: row.body,
    rationale: row.rationale,
    confidenceScore: row.confidence_score !== null ? Number(row.confidence_score) : undefined,
    status: row.status,
    decidedAtIso: row.decided_at ? (row.decided_at as Date).toISOString() : undefined,
    createdAtIso: (row.created_at as Date).toISOString(),
  };
}

export function createExecutiveDraftsRouter(): Router {
  const router = Router();

  router.get("/executive-drafts", async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const result = await pool.query("SELECT * FROM executive_drafts WHERE status = $1 ORDER BY created_at DESC", [status]);
    res.status(200).json({ drafts: result.rows.map(rowToDraft) });
  });

  router.patch("/executive-drafts/:id/decide", async (req: Request, res: Response) => {
    const { decision } = req.body ?? {};
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected".' });
    }
    const result = await pool.query(
      "UPDATE executive_drafts SET status = $1, decided_at = now() WHERE id = $2 AND status = 'pending' RETURNING *",
      [decision, req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `No pending draft on file with id ${req.params.id} (it may already be decided).` });
    }
    res.status(200).json(rowToDraft(result.rows[0]));
    return;
  });

  return router;
}
