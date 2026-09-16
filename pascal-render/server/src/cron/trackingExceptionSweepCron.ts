// ============================================================================
// CRON — Tracking Exception Sweep (every 15 minutes)
// Scans the past 20 minutes of shipment_milestones for is_exception=true
// events we haven't already run the transit_exception playbook for, then
// invokes runPlaybook for each. Booking & Dispatch reacts to a rolled
// container, customs hold, or in-transit delay automatically — the
// difference between "we noticed hours later" and "we noticed the moment
// the carrier reported it".
// ============================================================================

import { pool } from "../db/pool.js";
import { runPlaybook } from "../services/quarterback.js";
import { runCron } from "./cronHelpers.js";

interface ExceptionRow {
  id: string;
  subscription_id: string;
  event_type: string;
  event_code: string | null;
  location: string | null;
  occurred_at: string;
  details: Record<string, unknown>;
  org_id: string;
  tracking_number: string;
  reference: string | null;
  origin: string | null;
  destination: string | null;
  mode: string;
}

async function main() {
  // Pull recent exceptions we haven't seen yet. We track "seen" by writing
  // a synthetic activity_log row with event_type = 'tracking_exception_ack:<milestone_id>'.
  const rows = await pool.query<ExceptionRow>(
    `SELECT m.id, m.subscription_id, m.event_type, m.event_code, m.location,
            m.occurred_at, m.details,
            s.org_id, s.tracking_number, s.reference, s.origin, s.destination, s.mode
     FROM shipment_milestones m
     JOIN tracking_subscriptions s ON s.id = m.subscription_id
     WHERE m.is_exception = TRUE
       AND m.reported_at >= now() - INTERVAL '20 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM activity_log a
         WHERE a.event_type = 'tracking_exception_ack:' || m.id::text
       )
     ORDER BY m.reported_at DESC
     LIMIT 50`,
  );

  if (rows.rowCount === 0) {
    console.log("No new tracking exceptions in the last 20 minutes.");
    return;
  }

  let handled = 0;
  for (const r of rows.rows) {
    try {
      await runPlaybook({
        playbookKey: "transit_exception",
        triggerSummary: `${r.event_type.replace(/_/g, " ")} on ${r.tracking_number}${r.location ? ` at ${r.location}` : ""}`,
        clientOrgId: r.org_id,
        contextPayload: {
          shipmentRef: r.tracking_number,
          reference: r.reference,
          mode: r.mode,
          origin: r.origin,
          destination: r.destination,
          exceptionEventType: r.event_type,
          exceptionEventCode: r.event_code,
          exceptionOccurredAtIso: r.occurred_at,
          exceptionDetails: r.details,
        },
      });
      await pool.query(
        `INSERT INTO activity_log (event_type, shipment_id, message, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          `tracking_exception_ack:${r.id}`,
          r.tracking_number,
          `transit_exception playbook fired for ${r.event_type}`,
          JSON.stringify({ subscriptionId: r.subscription_id, orgId: r.org_id }),
        ],
      );
      handled += 1;
    } catch (err) {
      console.error(`Playbook fire failed for milestone ${r.id}:`, err);
    }
  }
  console.log(`Tracking exception sweep: ${handled} of ${rows.rowCount} exceptions handled.`);
}

runCron("tracking_exception_sweep", main);
