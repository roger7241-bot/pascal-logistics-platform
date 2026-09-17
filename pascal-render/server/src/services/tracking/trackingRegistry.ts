// ============================================================================
// Tracking registry + subscription workflow
// One entry point for the routes and Booking & Dispatch. Handles subscribe
// (creates row + immediate seed pull) and refresh (pull the latest and
// upsert new milestones — dedup by (subscription_id, event_type, occurred_at)).
// ============================================================================

import { pool } from "../../db/pool.js";
import type { TrackingAdapter, TrackingMode, TrackingProvider, SubscribeRequest, TrackingMilestone } from "./types.js";
import { Terminal49Adapter } from "./terminal49Adapter.js";
import { CargoAiAdapter } from "./cargoAiAdapter.js";
import { MacroPointAdapter } from "./macroPointAdapter.js";

function pickAdapter(mode: TrackingMode, demoMode = true): TrackingAdapter {
  if (mode === "ocean") {
    const apiKey = process.env.TERMINAL49_API_KEY;
    return new Terminal49Adapter(demoMode || !apiKey, apiKey);
  }
  if (mode === "air") {
    const apiKey = process.env.CARGOAI_API_KEY;
    return new CargoAiAdapter(demoMode || !apiKey, apiKey);
  }
  // Land freight — LTL / TL / rail via MacroPoint
  const apiKey = process.env.MACROPOINT_API_KEY;
  return new MacroPointAdapter(demoMode || !apiKey, mode, apiKey);
}

export async function subscribeShipment(
  orgId: string,
  mode: TrackingMode,
  req: SubscribeRequest,
  demoMode = true,
) {
  const adapter = pickAdapter(mode, demoMode);
  const provider: TrackingProvider = adapter.demoMode ? "demo" : adapter.provider;

  const existing = await pool.query(
    `SELECT id FROM tracking_subscriptions WHERE org_id = $1 AND mode = $2 AND tracking_number = $3`,
    [orgId, mode, req.trackingNumber],
  );

  let subscriptionId: string;
  if ((existing.rowCount ?? 0) > 0) {
    subscriptionId = existing.rows[0].id as string;
    await pool.query(
      `UPDATE tracking_subscriptions
         SET provider = $1, demo_mode = $2, status = CASE WHEN $2 THEN 'demo' ELSE 'subscribed' END,
             carrier_scac_or_iata = COALESCE($3, carrier_scac_or_iata),
             bill_of_lading = COALESCE($4, bill_of_lading),
             booking_number = COALESCE($5, booking_number),
             reference = COALESCE($6, reference),
             origin = COALESCE($7, origin),
             destination = COALESCE($8, destination),
             updated_at = now()
       WHERE id = $9`,
      [provider, adapter.demoMode, req.carrierScacOrIata ?? null, req.billOfLading ?? null, req.bookingNumber ?? null, req.reference ?? null, req.origin ?? null, req.destination ?? null, subscriptionId],
    );
  } else {
    await adapter.subscribe(req);
    const inserted = await pool.query(
      `INSERT INTO tracking_subscriptions
        (org_id, mode, provider, tracking_number, carrier_scac_or_iata,
         bill_of_lading, booking_number, reference, origin, destination,
         status, demo_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        orgId, mode, provider, req.trackingNumber, req.carrierScacOrIata ?? null,
        req.billOfLading ?? null, req.bookingNumber ?? null, req.reference ?? null,
        req.origin ?? null, req.destination ?? null,
        adapter.demoMode ? "demo" : "subscribed", adapter.demoMode,
      ],
    );
    subscriptionId = inserted.rows[0].id as string;
  }

  const milestones = await adapter.fetchMilestones(req);
  const sourceLabel = adapter.demoMode ? "demo"
    : adapter.provider === "terminal49" ? "terminal49_pull"
    : adapter.provider === "cargoai" ? "cargoai_pull"
    : "macropoint_pull";
  await upsertMilestones(subscriptionId, sourceLabel, milestones);
  await pool.query(`UPDATE tracking_subscriptions SET last_sync_at = now() WHERE id = $1`, [subscriptionId]);
  return { subscriptionId, provider, demoMode: adapter.demoMode, milestonesInserted: milestones.length };
}

export async function refreshShipment(subscriptionId: string) {
  const row = await pool.query(
    `SELECT * FROM tracking_subscriptions WHERE id = $1`,
    [subscriptionId],
  );
  if ((row.rowCount ?? 0) === 0) throw new Error("Subscription not found.");
  const s = row.rows[0];
  const adapter = pickAdapter(s.mode, s.demo_mode);
  const milestones = await adapter.fetchMilestones({
    trackingNumber: s.tracking_number,
    carrierScacOrIata: s.carrier_scac_or_iata ?? undefined,
    billOfLading: s.bill_of_lading ?? undefined,
    bookingNumber: s.booking_number ?? undefined,
    reference: s.reference ?? undefined,
    origin: s.origin ?? undefined,
    destination: s.destination ?? undefined,
  });
  const refreshSourceLabel = adapter.demoMode ? "demo"
    : adapter.provider === "terminal49" ? "terminal49_pull"
    : adapter.provider === "cargoai" ? "cargoai_pull"
    : "macropoint_pull";
  const inserted = await upsertMilestones(subscriptionId, refreshSourceLabel, milestones);
  await pool.query(`UPDATE tracking_subscriptions SET last_sync_at = now() WHERE id = $1`, [subscriptionId]);
  return inserted;
}

async function upsertMilestones(subscriptionId: string, source: string, milestones: TrackingMilestone[]) {
  let inserted = 0;
  for (const m of milestones) {
    const dup = await pool.query(
      `SELECT id FROM shipment_milestones
       WHERE subscription_id = $1 AND event_type = $2 AND occurred_at = $3`,
      [subscriptionId, m.eventType, m.occurredAtIso],
    );
    if ((dup.rowCount ?? 0) > 0) continue;
    await pool.query(
      `INSERT INTO shipment_milestones
         (subscription_id, event_type, event_code, location, latitude, longitude,
          occurred_at, is_exception, details, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        subscriptionId, m.eventType, m.eventCode ?? null, m.location ?? null,
        m.latitude ?? null, m.longitude ?? null, m.occurredAtIso, m.isException,
        JSON.stringify(m.details ?? {}), source,
      ],
    );
    inserted += 1;
  }
  return inserted;
}

export async function listSubscriptions(orgId: string, mode?: TrackingMode) {
  const params: unknown[] = [orgId];
  let where = "WHERE org_id = $1";
  if (mode) {
    params.push(mode);
    where += ` AND mode = $2`;
  }
  const result = await pool.query(
    `SELECT s.*,
            (SELECT COUNT(*)::int FROM shipment_milestones m WHERE m.subscription_id = s.id) AS milestone_count,
            (SELECT MAX(occurred_at) FROM shipment_milestones m WHERE m.subscription_id = s.id) AS latest_event_at
     FROM tracking_subscriptions s
     ${where}
     ORDER BY s.updated_at DESC LIMIT 100`,
    params,
  );
  return result.rows;
}

export async function getSubscriptionWithMilestones(subscriptionId: string) {
  const [sub, milestones] = await Promise.all([
    pool.query(`SELECT * FROM tracking_subscriptions WHERE id = $1`, [subscriptionId]),
    pool.query(
      `SELECT event_type, event_code, location, latitude, longitude, occurred_at, is_exception, details, source
       FROM shipment_milestones WHERE subscription_id = $1 ORDER BY occurred_at ASC`,
      [subscriptionId],
    ),
  ]);
  if ((sub.rowCount ?? 0) === 0) return null;
  return { subscription: sub.rows[0], milestones: milestones.rows };
}
