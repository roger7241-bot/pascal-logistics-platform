// ============================================================================
// KPI COMPUTE
// Rolls up daily KPIs for a Tier 3 client from ERP data + our own agent
// activity. Called by cron/dailyKpiRefreshCron.ts every 06:00 PT.
// Writes one row per (org_id, date) to client_kpi_snapshots.
//
// KPIs computed:
//   Executive (weekly-visible):
//     otif_pct, perfect_order_pct, freight_to_revenue_pct,
//     cash_to_cash_days, inventory_turns
//   Operational (daily-visible):
//     order_fill_rate_pct, supplier_otif_pct, damage_rate_pct
//   Analytical (quarterly-visible):
//     forecast_accuracy_mape_pct (deferred — needs history), dead_stock_pct
// ============================================================================

import { pool } from "../db/pool.js";
import { getAdapter } from "./erp/erpRegistry.js";

export interface KpiSnapshot {
  orgId: string;
  snapshotDate: string;                      // YYYY-MM-DD
  otifPct: number | null;
  perfectOrderPct: number | null;
  freightToRevenuePct: number | null;
  cashToCashDays: number | null;
  inventoryTurns: number | null;
  orderFillRatePct: number | null;
  supplierOtifPct: number | null;
  damageRatePct: number | null;
  forecastAccuracyMapePct: number | null;
  deadStockPct: number | null;
  ordersTotal: number;
  ordersShippedOntime: number;
  ordersShippedInfull: number;
  ordersDamaged: number;
  freightCostUsd: number;
  revenueUsd: number;
  inventoryValueUsd: number;
  source: "demo" | "erp_pull" | "manual";
}

// Compute one client's KPIs for the past N days and write the daily rollup.
export async function computeAndSaveDailyKpis(orgId: string, windowDays = 30): Promise<KpiSnapshot> {
  const adapter = await getAdapter(orgId);
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const [inventory, sos] = await Promise.all([
    adapter.getInventory(),
    adapter.getSalesOrders(since),
  ]);

  const ordersTotal = sos.length;
  const ordersShipped = sos.filter((s) => s.status === "shipped" || s.status === "delivered");
  const ordersDelivered = sos.filter((s) => s.status === "delivered");

  const onTime = ordersDelivered.filter((s) => {
    if (!s.requestedDeliveryDate || !s.actualDeliveryDate) return false;
    return new Date(s.actualDeliveryDate) <= new Date(s.requestedDeliveryDate);
  }).length;

  const inFull = ordersShipped.filter((s) => s.fillRatePct >= 100).length;
  const damaged = 0;  // no damage signal in SO shape yet — comes from agent15_claims_osd

  const otifPct = ordersDelivered.length > 0
    ? Math.round((Math.min(onTime, inFull) / ordersDelivered.length) * 10000) / 100
    : null;

  const perfectOrderPct = ordersDelivered.length > 0
    ? Math.round(((onTime * 0.5 + inFull * 0.5) / ordersDelivered.length) * 10000) / 100
    : null;

  const revenueUsd = sos.reduce((sum, s) => sum + Number(s.totalUsd), 0);
  const inventoryValueUsd = inventory.reduce((sum, i) => sum + i.onHandUnits * i.unitCostUsd, 0);

  // Freight cost — pull from our own invoices for this org over the same
  // window. Fallback to a 3-5% assumption on revenue if we don't have data.
  const freightRow = await pool.query<{ freight_usd: number }>(
    `SELECT COALESCE(SUM(carrier_invoice_amount_usd), 0)::numeric AS freight_usd
     FROM invoices WHERE org_id = $1 AND created_at >= $2`,
    [orgId, since],
  );
  const freightCostUsd = Number(freightRow.rows[0]?.freight_usd ?? 0);
  const freightToRevenuePct = revenueUsd > 0
    ? Math.round((freightCostUsd / revenueUsd) * 10000) / 100
    : null;

  const orderFillRatePct = ordersShipped.length > 0
    ? Math.round((ordersShipped.reduce((sum, s) => sum + s.fillRatePct, 0) / ordersShipped.length) * 100) / 100
    : null;

  // Supplier OTIF — from PO expected vs actual received.
  const pos = await adapter.getPurchaseOrders(since);
  const receivedPos = pos.filter((p) => p.status === "received" || p.status === "closed");
  const supplierOnTime = receivedPos.filter((p) => {
    if (!p.expectedDate || !p.actualReceivedDate) return false;
    return new Date(p.actualReceivedDate) <= new Date(p.expectedDate);
  }).length;
  const supplierOtifPct = receivedPos.length > 0
    ? Math.round((supplierOnTime / receivedPos.length) * 10000) / 100
    : null;

  // Inventory turns — annualized. COGS proxy = revenue - 25% margin.
  const cogs = revenueUsd * 0.75;
  const dailyCogs = cogs / windowDays;
  const inventoryTurns = inventoryValueUsd > 0
    ? Math.round((dailyCogs * 365 / inventoryValueUsd) * 100) / 100
    : null;

  // Dead stock — SKUs where on_hand exceeds 6 months of sales (or no sales).
  // Simplified: SKUs with high on-hand but no committed units in past window.
  const deadUnits = inventory.filter((i) => i.committedUnits === 0 && i.onHandUnits > i.safetyStockUnits * 2).length;
  const deadStockPct = inventory.length > 0
    ? Math.round((deadUnits / inventory.length) * 10000) / 100
    : null;

  const snapshot: KpiSnapshot = {
    orgId,
    snapshotDate: new Date().toISOString().slice(0, 10),
    otifPct,
    perfectOrderPct,
    freightToRevenuePct,
    cashToCashDays: null,             // needs AR + AP data — Phase 2
    inventoryTurns,
    orderFillRatePct,
    supplierOtifPct,
    damageRatePct: ordersTotal > 0 ? Math.round((damaged / ordersTotal) * 10000) / 100 : 0,
    forecastAccuracyMapePct: null,    // needs demand-forecast history — Phase 2
    deadStockPct,
    ordersTotal,
    ordersShippedOntime: onTime,
    ordersShippedInfull: inFull,
    ordersDamaged: damaged,
    freightCostUsd,
    revenueUsd,
    inventoryValueUsd,
    source: adapter.demoMode ? "demo" : "erp_pull",
  };

  // Persist. UNIQUE (org_id, snapshot_date) means re-runs update in place.
  await pool.query(
    `INSERT INTO client_kpi_snapshots
       (org_id, snapshot_date, otif_pct, perfect_order_pct, freight_to_revenue_pct,
        cash_to_cash_days, inventory_turns, order_fill_rate_pct, supplier_otif_pct,
        damage_rate_pct, forecast_accuracy_mape_pct, dead_stock_pct,
        orders_total, orders_shipped_ontime, orders_shipped_infull, orders_damaged,
        freight_cost_usd, revenue_usd, inventory_value_usd, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (org_id, snapshot_date) DO UPDATE SET
       otif_pct = EXCLUDED.otif_pct,
       perfect_order_pct = EXCLUDED.perfect_order_pct,
       freight_to_revenue_pct = EXCLUDED.freight_to_revenue_pct,
       cash_to_cash_days = EXCLUDED.cash_to_cash_days,
       inventory_turns = EXCLUDED.inventory_turns,
       order_fill_rate_pct = EXCLUDED.order_fill_rate_pct,
       supplier_otif_pct = EXCLUDED.supplier_otif_pct,
       damage_rate_pct = EXCLUDED.damage_rate_pct,
       forecast_accuracy_mape_pct = EXCLUDED.forecast_accuracy_mape_pct,
       dead_stock_pct = EXCLUDED.dead_stock_pct,
       orders_total = EXCLUDED.orders_total,
       orders_shipped_ontime = EXCLUDED.orders_shipped_ontime,
       orders_shipped_infull = EXCLUDED.orders_shipped_infull,
       orders_damaged = EXCLUDED.orders_damaged,
       freight_cost_usd = EXCLUDED.freight_cost_usd,
       revenue_usd = EXCLUDED.revenue_usd,
       inventory_value_usd = EXCLUDED.inventory_value_usd,
       source = EXCLUDED.source`,
    [
      snapshot.orgId, snapshot.snapshotDate, snapshot.otifPct, snapshot.perfectOrderPct,
      snapshot.freightToRevenuePct, snapshot.cashToCashDays, snapshot.inventoryTurns,
      snapshot.orderFillRatePct, snapshot.supplierOtifPct, snapshot.damageRatePct,
      snapshot.forecastAccuracyMapePct, snapshot.deadStockPct,
      snapshot.ordersTotal, snapshot.ordersShippedOntime, snapshot.ordersShippedInfull, snapshot.ordersDamaged,
      snapshot.freightCostUsd, snapshot.revenueUsd, snapshot.inventoryValueUsd, snapshot.source,
    ],
  );

  return snapshot;
}

// Query recent snapshots for a client — for exec pack cron + the UI.
export async function listRecentSnapshots(orgId: string, days = 30) {
  const result = await pool.query(
    `SELECT * FROM client_kpi_snapshots
     WHERE org_id = $1 AND snapshot_date >= (CURRENT_DATE - $2::int * INTERVAL '1 day')
     ORDER BY snapshot_date DESC`,
    [orgId, days],
  );
  return result.rows;
}

export async function getKpiTargets(orgId: string) {
  const result = await pool.query(`SELECT * FROM client_kpi_targets WHERE org_id = $1`, [orgId]);
  return result.rows[0] ?? null;
}
