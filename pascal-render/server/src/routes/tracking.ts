// ============================================================================
// TRACKING ROUTES — ocean + air visibility
// Operator: full read/write. Client: read own only, subscribe own only.
// Mounted at /api/operator (for operators) AND /api/client via a shared
// createTrackingRoutes factory that clones the handlers with role gates.
// ============================================================================

import { Router, type Request, type Response } from "express";
import {
  subscribeShipment, refreshShipment, listSubscriptions, getSubscriptionWithMilestones,
} from "../services/tracking/trackingRegistry.js";
import type { TrackingMode } from "../services/tracking/types.js";
import { pool } from "../db/pool.js";

function resolveOrgId(req: Request, allowQueryOverride: boolean): string | undefined {
  if (allowQueryOverride && req.authUser?.role === "operator") {
    const q = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    return q ?? req.authUser?.orgId ?? undefined;
  }
  return req.authUser?.orgId ?? undefined;
}

export function createTrackingRouter(scope: "operator" | "client"): Router {
  const router = Router();
  const allowQueryOverride = scope === "operator";

  // List subscriptions for the caller's org (or an operator's ?orgId=…).
  router.get("/tracking/subscriptions", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const mode = typeof req.query.mode === "string" && (req.query.mode === "ocean" || req.query.mode === "air") ? req.query.mode as TrackingMode : undefined;
    const subs = await listSubscriptions(orgId, mode);
    return res.status(200).json({ subscriptions: subs });
  });

  // Get one subscription with its milestone timeline.
  router.get("/tracking/subscriptions/:id", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const detail = await getSubscriptionWithMilestones(req.params.id);
    if (!detail) return res.status(404).json({ error: "Subscription not found." });
    if (detail.subscription.org_id !== orgId && scope === "client") {
      return res.status(403).json({ error: "Not your subscription." });
    }
    return res.status(200).json(detail);
  });

  // Subscribe to a new tracking number. Fires an initial demo/live pull so
  // the timeline populates immediately.
  router.post("/tracking/subscribe", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const b = req.body ?? {};
    if (!b.mode || !b.trackingNumber || (b.mode !== "ocean" && b.mode !== "air")) {
      return res.status(400).json({ error: "mode ('ocean' | 'air') and trackingNumber are required." });
    }
    // Verify org exists.
    const account = await pool.query(`SELECT org_id FROM accounts WHERE org_id = $1`, [orgId]);
    if ((account.rowCount ?? 0) === 0) return res.status(404).json({ error: "Account not found." });

    const result = await subscribeShipment(
      orgId,
      b.mode as TrackingMode,
      {
        trackingNumber: String(b.trackingNumber),
        carrierScacOrIata: b.carrierScacOrIata ? String(b.carrierScacOrIata) : undefined,
        billOfLading: b.billOfLading ? String(b.billOfLading) : undefined,
        bookingNumber: b.bookingNumber ? String(b.bookingNumber) : undefined,
        reference: b.reference ? String(b.reference) : undefined,
        origin: b.origin ? String(b.origin) : undefined,
        destination: b.destination ? String(b.destination) : undefined,
      },
      typeof b.demoMode === "boolean" ? b.demoMode : true,
    );
    return res.status(201).json(result);
  });

  // Force a re-pull for one subscription (webhook fallback path).
  router.post("/tracking/subscriptions/:id/refresh", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const detail = await getSubscriptionWithMilestones(req.params.id);
    if (!detail) return res.status(404).json({ error: "Subscription not found." });
    if (detail.subscription.org_id !== orgId && scope === "client") {
      return res.status(403).json({ error: "Not your subscription." });
    }
    const inserted = await refreshShipment(req.params.id);
    return res.status(200).json({ milestonesInserted: inserted });
  });

  return router;
}
