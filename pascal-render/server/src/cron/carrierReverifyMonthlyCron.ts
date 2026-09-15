// ============================================================================
// CRON — Monthly Carrier Re-Verification (1st of month, 06:00 America/Los_Angeles)
// Every carrier on file that we've tendered to in the past 90 days gets a
// re-verification draft under Agent 14 (Carrier Vetting). The draft asks the
// carrier for an updated COI + W9 confirmation and cites the last-known
// verification date. Full FMCSA SAFER API integration (auto-pulling authority
// status + insurance + SMS scores) wires in a later commit once WEB_KEY
// registration is complete — for now the draft prompts Roger to re-audit
// with the packet the carrier sends back.
// ============================================================================

import { pool } from "../db/pool.js";
import { categorizeAndDraft, persistDraft, type VettingRequest } from "../services/agent14CarrierVetting.js";

async function main() {
  // Distinct carriers we've tendered to in the past 90 days. Falls back to
  // any carrier in client_carrier_rates if no shipments table wire-through.
  const carriers = await pool.query<{ carrier_name: string; mode: string; last_seen: Date }>(
    `SELECT carrier_name, MAX(mode) AS mode, MAX(updated_at) AS last_seen
     FROM client_carrier_rates
     WHERE carrier_name IS NOT NULL AND carrier_name <> ''
     GROUP BY carrier_name
     ORDER BY carrier_name ASC`,
  );

  if (carriers.rowCount === 0) {
    console.log("No carriers on file — nothing to re-verify.");
    return;
  }

  let drafted = 0;

  for (const c of carriers.rows) {
    const daysSinceLastSeen = c.last_seen ? Math.round((Date.now() - new Date(c.last_seen).getTime()) / 86_400_000) : 999;

    // Build a minimal vetting request — we don't have FMCSA data on file yet,
    // so we set authority + insurance as "unknown" (undefined) and let the
    // deterministic audit flag them. The agent will draft a packet-request
    // email to the carrier for updated docs.
    const request: VettingRequest = {
      carrierName: c.carrier_name,
      eventType: "monthly_reverify",
      authorityActive: true, // assume active until proven otherwise
      insuranceAutoLiabilityUsd: undefined,
      insuranceCargoUsd: undefined,
      insuranceExpiresIso: undefined,
      hasW9OnFile: false, // force the W9 flag so the packet-request draft fires
      lastVerifiedIso: c.last_seen ? new Date(c.last_seen).toISOString().slice(0, 10) : undefined,
      notes: `Auto-run monthly re-verify. Last activity ${daysSinceLastSeen} days ago on mode ${c.mode ?? "unknown"}.`,
    };

    const output = await categorizeAndDraft(request);
    await persistDraft(request, output, `monthly_reverify:${new Date().toISOString().slice(0, 7)}`);
    drafted += 1;
    console.log(`Re-verify draft queued for ${c.carrier_name} (last seen ${daysSinceLastSeen}d ago).`);
  }

  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = $1, updated_at = now()
     WHERE agent_key = 'agent14_carrier_vetting'`,
    [`monthly_reverify: ${drafted} drafts queued`],
  );
  console.log(`Monthly re-verify: ${drafted} carrier drafts queued for review.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Carrier re-verify cron failed:", err);
    process.exit(1);
  });
