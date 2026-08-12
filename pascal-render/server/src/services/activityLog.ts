// ============================================================================
// ACTIVITY LOG
// A real, queryable audit trail — every insert here corresponds to an
// actual backend event (shipment ingest, rate savings captured, border
// reroute triggered, executive decision made). The CEO Hub's live ticker
// reads directly from this table, not a simulated feed.
// ============================================================================

import { pool } from "../db/pool.js";

export type ActivityEventType = "paps_released" | "rate_savings_captured" | "reroute_triggered" | "executive_decision" | "shipment_ingested";

export async function logActivity(eventType: ActivityEventType, message: string, shipmentId?: string, metadata?: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO activity_log (event_type, shipment_id, message, metadata) VALUES ($1,$2,$3,$4)`,
    [eventType, shipmentId ?? null, message, metadata ? JSON.stringify(metadata) : null],
  );
}
