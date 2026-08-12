// ============================================================================
// Cron entry point — invoked by the Render Cron Job (see render.yaml) 3x
// daily. Polls every legacy carrier account on file and reports results.
// HONEST LIMITATION: the carrier list below stands in for a real query
// against the platform's CRM/carrier-accounts table — wire
// `loadLegacyCarrierAccounts` to that data source when it exists.
// ============================================================================

import { pollLegacyCarrierBatch } from "./workers/legacyScraper.js";
import type { LegacyTrackingRequest } from "./types/shipment.js";

async function loadLegacyCarrierAccounts(): Promise<LegacyTrackingRequest[]> {
  // Placeholder — replace with a real database query once the carrier
  // accounts table exists. Shape matches exactly what the worker expects.
  return [];
}

async function main() {
  const accounts = await loadLegacyCarrierAccounts();
  if (accounts.length === 0) {
    console.log("No legacy carrier accounts on file — nothing to poll.");
    return;
  }

  console.log(`Polling ${accounts.length} legacy carrier tracking number(s)...`);
  const results = await pollLegacyCarrierBatch(accounts);

  const blocked = results.filter((r) => r.blocked);
  const succeeded = results.filter((r) => !r.blocked);

  console.log(`Polling complete: ${succeeded.length} succeeded, ${blocked.length} blocked (Tier 2 fallback triggered).`);
  results.forEach((r) => {
    console.log(`  ${r.carrierName} / ${r.trackingNumber}: ${r.blocked ? `BLOCKED (${r.blockReason})` : r.milestone}`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cron poll failed:", err);
    process.exit(1);
  });
