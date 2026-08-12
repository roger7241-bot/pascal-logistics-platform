// ============================================================================
// GET  /api/calendar/events
// POST /api/calendar/events
// Shared Logistics Calendar — backs both the Operator desk #9 view and the
// Client Portal's calendar tab. One dataset, two UIs with different
// permissions (client is read-only + their own org; operator sees all).
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";

const VALID_TYPES = ["pickup", "delivery", "laycan", "demurrage_deadline", "poa_expiry", "other"];

function rowToEvent(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    eventType: row.event_type,
    startsAtIso: (row.starts_at as Date).toISOString(),
    endsAtIso: row.ends_at ? (row.ends_at as Date).toISOString() : undefined,
    shipmentId: row.shipment_id,
    notes: row.notes,
  };
}

export function createCalendarRouter(): Router {
  const router = Router();

  router.get("/events", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const result = orgId
      ? await pool.query("SELECT * FROM calendar_events WHERE org_id = $1 ORDER BY starts_at ASC", [orgId])
      : await pool.query("SELECT * FROM calendar_events ORDER BY starts_at ASC");
    res.status(200).json({ events: result.rows.map(rowToEvent) });
  });

  router.post("/events", async (req: Request, res: Response) => {
    const { orgId, title, eventType, startsAtIso, endsAtIso, shipmentId, notes } = req.body ?? {};
    if (!orgId || !title || !VALID_TYPES.includes(eventType) || !startsAtIso) {
      return res.status(400).json({ error: `orgId, title, startsAtIso, and a valid eventType (${VALID_TYPES.join(", ")}) are required.` });
    }
    const result = await pool.query(
      `INSERT INTO calendar_events (org_id, title, event_type, starts_at, ends_at, shipment_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [orgId, title, eventType, startsAtIso, endsAtIso ?? null, shipmentId ?? null, notes ?? null],
    );
    res.status(201).json(rowToEvent(result.rows[0]));
    return;
  });

  return router;
}
