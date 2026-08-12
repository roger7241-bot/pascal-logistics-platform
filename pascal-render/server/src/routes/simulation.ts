// ============================================================================
// POST /api/simulation/run — executes the End-to-End Demo Simulation.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { runEndToEndSimulation } from "../services/simulationEngine.js";
import type { WsManager } from "../ws/wsManager.js";

export function createSimulationRouter(wsManager: WsManager): Router {
  const router = Router();

  router.post("/run", async (_req: Request, res: Response) => {
    try {
      const trace = await runEndToEndSimulation(wsManager);
      res.status(200).json(trace);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Simulation failed to complete." });
    }
  });

  return router;
}
