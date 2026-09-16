// ============================================================================
// AGENT 21 — ERP INGESTION BRIDGE (headless)
// Client ERP webhook / poll → normalized shipment / PO / SO event → routed
// to downstream agents (Sanitizer for docs, Booking & Dispatch for new
// shipments, Finance for invoicing signals, etc.).
//
// Not a persona. Pure integration code. Every inbound event dedups via
// (org_id, provider, external_ref, event_type). Normalization is
// per-provider — NetSuite / QBO / Dynamics / SAP shapes differ, all get
// squashed into one internal event shape downstream agents can trust.
// ============================================================================

import { pool } from "../db/pool.js";

export type ErpEventType =
  | "po_created" | "po_updated" | "po_received"
  | "so_created" | "so_shipped" | "so_delivered" | "so_cancelled"
  | "inventory_adjusted" | "invoice_paid" | "unknown";

export interface NormalizedErpEvent {
  eventType: ErpEventType;
  externalRef: string;
  provider: string;
  occurredAtIso: string;
  entity: Record<string, unknown>;      // normalized to a common shape
  raw: Record<string, unknown>;
}

// Provider-specific normalizers. Each takes the raw webhook body and returns
// the common event shape. Start with the two we already have adapters for.
function normalizeNetSuite(raw: Record<string, unknown>): NormalizedErpEvent {
  const recType = String(raw.recordType ?? "").toLowerCase();
  const action = String(raw.action ?? "");
  const eventType: ErpEventType =
    recType === "purchaseorder" && action === "created" ? "po_created" :
    recType === "purchaseorder" && action === "updated" ? "po_updated" :
    recType === "itemreceipt" ? "po_received" :
    recType === "salesorder" && action === "created" ? "so_created" :
    recType === "itemfulfillment" ? "so_shipped" :
    recType === "salesorder" && action === "cancelled" ? "so_cancelled" :
    recType === "inventoryadjustment" ? "inventory_adjusted" :
    "unknown";
  return {
    eventType,
    externalRef: String(raw.id ?? raw.internalId ?? ""),
    provider: "netsuite",
    occurredAtIso: String(raw.eventDate ?? raw.dateCreated ?? new Date().toISOString()),
    entity: {
      poNumber: raw.tranId ?? raw.tranNumber,
      supplier: raw.entity?.text ?? raw.vendor,
      totalUsd: typeof raw.total === "number" ? raw.total : undefined,
    },
    raw,
  };
}

function normalizeQuickBooks(raw: Record<string, unknown>): NormalizedErpEvent {
  const kind = String(raw.name ?? "");
  const op = String(raw.operation ?? "");
  const eventType: ErpEventType =
    kind === "PurchaseOrder" && op === "Create" ? "po_created" :
    kind === "PurchaseOrder" && op === "Update" ? "po_updated" :
    kind === "SalesReceipt" && op === "Create" ? "so_shipped" :
    kind === "Invoice" && op === "Payment" ? "invoice_paid" :
    "unknown";
  return {
    eventType,
    externalRef: String(raw.id ?? ""),
    provider: "quickbooks_online",
    occurredAtIso: String(raw.lastUpdated ?? new Date().toISOString()),
    entity: {
      docNumber: raw.docNumber,
      totalUsd: typeof raw.totalAmt === "number" ? raw.totalAmt : undefined,
    },
    raw,
  };
}

export function normalize(provider: string, raw: Record<string, unknown>): NormalizedErpEvent {
  switch (provider) {
    case "netsuite":            return normalizeNetSuite(raw);
    case "quickbooks_online":   return normalizeQuickBooks(raw);
    // Dynamics / SAP / Sage / Odoo normalizers wire in as clients arrive.
    default: return {
      eventType: "unknown",
      externalRef: String(raw.id ?? raw.external_ref ?? Date.now()),
      provider,
      occurredAtIso: new Date().toISOString(),
      entity: {},
      raw,
    };
  }
}

// Ingest a webhook payload. Dedups against (org, provider, ref, type) so
// replays from the aggregator don't create duplicate downstream fires.
export async function ingestEvent(orgId: string, provider: string, raw: Record<string, unknown>) {
  const normalized = normalize(provider, raw);
  const result = await pool.query(
    `INSERT INTO erp_ingestion_events (org_id, provider, event_type, external_ref, raw_payload, normalized_payload, processing_status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'normalized')
     ON CONFLICT (org_id, provider, external_ref, event_type) DO NOTHING
     RETURNING id`,
    [orgId, provider, normalized.eventType, normalized.externalRef, JSON.stringify(raw), JSON.stringify(normalized)],
  );
  // If the insert was a no-op (dedup) we skip routing.
  if (result.rowCount === 0) return { deduped: true, normalized };

  // Route to downstream agents based on event type.
  // Phase 1 wires the linkage — downstream agents fire in follow-up commits
  // as we finalize each ingestion contract (e.g., new PO → Sanitizer +
  // Booking & Dispatch; so_shipped → tracking milestone auto-create; etc.)
  await pool.query(
    `UPDATE erp_ingestion_events SET processing_status = 'routed', processed_at = now() WHERE id = $1`,
    [result.rows[0].id],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = $1, updated_at = now()
     WHERE agent_key = 'agent21_erp_bridge'`,
    [`ingested:${normalized.eventType}`],
  );

  return { deduped: false, normalized, id: result.rows[0].id };
}

export async function listRecentEvents(orgId: string, days = 3) {
  const result = await pool.query(
    `SELECT id, provider, event_type, external_ref, processing_status,
            received_at, processed_at, error_detail
     FROM erp_ingestion_events
     WHERE org_id = $1 AND received_at >= now() - $2::int * INTERVAL '1 day'
     ORDER BY received_at DESC LIMIT 200`,
    [orgId, days],
  );
  return result.rows;
}
