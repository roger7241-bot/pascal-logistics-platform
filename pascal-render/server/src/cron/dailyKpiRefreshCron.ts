// ============================================================================
// CRON — Daily KPI refresh (06:15 America/Los_Angeles)
// For every Tier 3 client, pull from their ERP (or demo adapter if not yet
// wired live), compute today's KPI snapshot, and write to
// client_kpi_snapshots. Idempotent — re-runs same-day update in place.
// ============================================================================

import { pool } from "../db/pool.js";
import { computeAndSaveDailyKpis } from "../services/kpiCompute.js";

async function main() {
  const clients = await pool.query<{ org_id: string; company_name: string }>(
    `SELECT org_id, company_name FROM accounts
     WHERE account_status = 'active' AND retainer_tier IN ('tier3', 'Tier 3', 'tier_3')`,
  );

  if (clients.rowCount === 0) {
    console.log("No Tier 3 clients on file — skipping KPI refresh.");
    return;
  }

  let ok = 0;
  let errored = 0;
  for (const c of clients.rows) {
    try {
      const snap = await computeAndSaveDailyKpis(c.org_id);
      console.log(`KPIs refreshed for ${c.company_name}: OTIF ${snap.otifPct ?? "n/a"}%, orders ${snap.ordersTotal}, revenue $${Math.round(snap.revenueUsd).toLocaleString()}`);
      ok += 1;
    } catch (err) {
      console.error(`KPI refresh failed for ${c.company_name}:`, err);
      errored += 1;
    }
  }
  console.log(`Daily KPI refresh: ${ok} succeeded, ${errored} failed.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Daily KPI refresh cron failed:", err);
    process.exit(1);
  });
