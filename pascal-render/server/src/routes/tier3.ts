// ============================================================================
// TIER 3 ROUTES
// GET  /accounts/:orgId/tier3-snapshot — one-shot: KB + KPIs + ERP + targets
// PUT  /accounts/:orgId/knowledge-base — replace client KB
// PUT  /accounts/:orgId/kpi-targets    — set/update KPI targets
// PUT  /accounts/:orgId/erp-connection — pick provider + demo/live mode
// GET  /erp-providers                   — list wired providers
// POST /accounts/:orgId/refresh-kpis    — trigger ad-hoc KPI recompute
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { getKnowledgeBase, upsertKnowledgeBase, type KnowledgeBase } from "../services/clientKnowledgeBase.js";
import { getKpiTargets, listRecentSnapshots, computeAndSaveDailyKpis } from "../services/kpiCompute.js";
import { getErpConnection, ensureErpConnection, listProviders } from "../services/erp/erpRegistry.js";
import type { ErpProvider } from "../services/erp/types.js";

export function createTier3Router(): Router {
  const router = Router();

  router.get("/erp-providers", async (_req: Request, res: Response) => {
    return res.status(200).json({ providers: listProviders() });
  });

  router.get("/accounts/:orgId/tier3-snapshot", async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const account = await pool.query(
      `SELECT org_id, company_name, primary_contact_name, retainer_tier
       FROM accounts WHERE org_id = $1`,
      [orgId],
    );
    if (account.rowCount === 0) return res.status(404).json({ error: "Account not found." });

    const [kb, targets, snapshots, erp] = await Promise.all([
      getKnowledgeBase(orgId),
      getKpiTargets(orgId),
      listRecentSnapshots(orgId, 30),
      getErpConnection(orgId),
    ]);

    return res.status(200).json({
      account: account.rows[0],
      knowledgeBase: kb,
      kpiTargets: targets,
      kpiSnapshots: snapshots,
      erpConnection: erp,
    });
  });

  router.put("/accounts/:orgId/knowledge-base", async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const knowledge = req.body?.knowledge;
    if (!knowledge || typeof knowledge !== "object") {
      return res.status(400).json({ error: "Body must contain { knowledge: {...} }." });
    }
    // Sanity: reject if account doesn't exist so we don't create orphan KBs.
    const account = await pool.query(`SELECT org_id FROM accounts WHERE org_id = $1`, [orgId]);
    if (account.rowCount === 0) return res.status(404).json({ error: "Account not found." });
    const updated = await upsertKnowledgeBase(orgId, knowledge as KnowledgeBase);
    return res.status(200).json({ knowledgeBase: updated });
  });

  router.put("/accounts/:orgId/kpi-targets", async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const account = await pool.query(`SELECT org_id FROM accounts WHERE org_id = $1`, [orgId]);
    if (account.rowCount === 0) return res.status(404).json({ error: "Account not found." });

    const b = req.body ?? {};
    const cols = [
      "otif_target_pct", "perfect_order_target_pct", "freight_to_revenue_target_pct",
      "cash_to_cash_target_days", "inventory_turns_target",
      "order_fill_rate_target_pct", "supplier_otif_target_pct", "damage_rate_target_pct",
      "forecast_accuracy_mape_target_pct", "dead_stock_target_pct",
    ];
    const jsCols = cols.map((c) => c.replace(/_(\w)/g, (_, l) => l.toUpperCase()));
    const values = jsCols.map((k) => (typeof b[k] === "number" ? b[k] : null));

    const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    const result = await pool.query(
      `INSERT INTO client_kpi_targets (org_id, ${cols.join(", ")})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
       ON CONFLICT (org_id) DO UPDATE SET ${setClause}, updated_at = now()
       RETURNING *`,
      [orgId, ...values],
    );
    return res.status(200).json({ kpiTargets: result.rows[0] });
  });

  router.put("/accounts/:orgId/erp-connection", async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    const account = await pool.query(`SELECT org_id FROM accounts WHERE org_id = $1`, [orgId]);
    if (account.rowCount === 0) return res.status(404).json({ error: "Account not found." });

    const { provider, demoMode, config } = req.body ?? {};
    const validProviders: ErpProvider[] = [
      "netsuite", "quickbooks_online", "quickbooks_desktop", "dynamics_365",
      "sage_intacct", "sage_x3", "oracle_fusion", "sap_s4hana", "sap_ecc", "odoo", "demo",
    ];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: `provider must be one of: ${validProviders.join(", ")}` });
    }

    // Ensure a row exists then update it.
    await ensureErpConnection(orgId, provider as ErpProvider);
    const result = await pool.query(
      `UPDATE erp_connections
         SET provider = $1,
             demo_mode = COALESCE($2, demo_mode),
             connection_status = CASE WHEN COALESCE($2, demo_mode) THEN 'demo' ELSE connection_status END,
             config = CASE WHEN $3::jsonb IS NULL THEN config ELSE $3::jsonb END,
             updated_at = now()
       WHERE org_id = $4
       RETURNING *`,
      [provider, typeof demoMode === "boolean" ? demoMode : null, config ? JSON.stringify(config) : null, orgId],
    );
    return res.status(200).json({ erpConnection: result.rows[0] });
  });

  router.post("/accounts/:orgId/refresh-kpis", async (req: Request, res: Response) => {
    const orgId = req.params.orgId;
    try {
      const snap = await computeAndSaveDailyKpis(orgId);
      return res.status(200).json({ snapshot: snap });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "KPI refresh failed." });
    }
  });

  return router;
}
