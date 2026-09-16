// ============================================================================
// ERP registry — one factory function that returns the right adapter for a
// client. All Tier 3 code paths route through this, so switching a client
// from demo to a real connector is one config row update — no code changes.
// ============================================================================

import { pool } from "../../db/pool.js";
import type { ErpAdapter, ErpProvider } from "./types.js";
import { NetSuiteAdapter, type NetSuiteConfig } from "./netsuiteAdapter.js";
import { QuickBooksAdapter, type QuickBooksConfig } from "./quickbooksAdapter.js";

export interface ErpConnectionRow {
  org_id: string;
  provider: ErpProvider;
  connection_status: "demo" | "not_connected" | "pending_auth" | "connected" | "error" | "suspended";
  demo_mode: boolean;
  last_sync_at: Date | null;
  last_sync_status: string | null;
  last_error: string | null;
  config: Record<string, unknown>;
}

// Load the connection row for a client. Returns null if not configured.
export async function getErpConnection(orgId: string): Promise<ErpConnectionRow | null> {
  const result = await pool.query<ErpConnectionRow>(
    `SELECT org_id, provider, connection_status, demo_mode, last_sync_at,
            last_sync_status, last_error, config
     FROM erp_connections WHERE org_id = $1`,
    [orgId],
  );
  return result.rows[0] ?? null;
}

// Ensure a client has an ERP connection row. If none exists, we create a
// demo-mode 'demo' provider row so Tier 3 features work immediately after
// upgrade. Idempotent.
export async function ensureErpConnection(orgId: string, provider: ErpProvider = "demo"): Promise<ErpConnectionRow> {
  const existing = await getErpConnection(orgId);
  if (existing) return existing;
  const result = await pool.query<ErpConnectionRow>(
    `INSERT INTO erp_connections (org_id, provider, connection_status, demo_mode)
     VALUES ($1, $2, 'demo', TRUE)
     RETURNING org_id, provider, connection_status, demo_mode, last_sync_at,
               last_sync_status, last_error, config`,
    [orgId, provider],
  );
  return result.rows[0];
}

// Return the adapter for a client. Falls back to a demo NetSuite adapter
// if the provider hasn't been chosen yet — Tier 3 features work day-1.
export async function getAdapter(orgId: string): Promise<ErpAdapter> {
  const conn = await ensureErpConnection(orgId);
  const config = conn.config ?? {};
  switch (conn.provider) {
    case "netsuite":
      return new NetSuiteAdapter(conn.demo_mode, orgId, config as NetSuiteConfig);
    case "quickbooks_online":
      return new QuickBooksAdapter(conn.demo_mode, orgId, config as QuickBooksConfig);
    // Dynamics / Sage / Oracle / SAP / Odoo adapters land as we sign a client
    // on each ERP. Until then, demo NetSuite is the fallback — same shape,
    // same schema, same code paths.
    default:
      return new NetSuiteAdapter(true, orgId, {});
  }
}

// Convenience: list the providers we recognize + which have live adapters
// wired vs demo-only. UI shows this so Roger picks the right one on setup.
export function listProviders(): { key: ErpProvider; label: string; liveWired: boolean }[] {
  return [
    { key: "netsuite", label: "NetSuite", liveWired: false },
    { key: "quickbooks_online", label: "QuickBooks Online", liveWired: false },
    { key: "dynamics_365", label: "Microsoft Dynamics 365", liveWired: false },
    { key: "sage_intacct", label: "Sage Intacct", liveWired: false },
    { key: "sage_x3", label: "Sage X3", liveWired: false },
    { key: "oracle_fusion", label: "Oracle Fusion", liveWired: false },
    { key: "sap_s4hana", label: "SAP S/4HANA", liveWired: false },
    { key: "sap_ecc", label: "SAP ECC", liveWired: false },
    { key: "odoo", label: "Odoo", liveWired: false },
    { key: "demo", label: "Demo (no ERP)", liveWired: true },
  ];
}
