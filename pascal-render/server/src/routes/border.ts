// ============================================================================
// GET /api/border/telemetry
// Returns the latest polled snapshot of all border wait-time readings and
// any active reroute triggers. Live updates also stream over the
// border_telemetry WebSocket channel — this endpoint is for initial page
// load / polling clients that don't hold a socket open.
// ============================================================================

import { Router, type Request, type Response } from "express";
import type { BorderTelemetryService } from "../services/borderTelemetryService.js";

export function createBorderRouter(telemetryService: BorderTelemetryService): Router {
  const router = Router();

  router.get("/telemetry", (_req: Request, res: Response) => {
    const snapshot = telemetryService.getSnapshot();
    res.status(200).json(snapshot);
  });

  return router;
}
