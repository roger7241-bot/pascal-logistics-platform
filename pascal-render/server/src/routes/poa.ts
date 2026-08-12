// ============================================================================
// GET  /api/client/poa
// POST /api/client/poa/upload
// POST /api/client/poa/activate — broker action
// POST /api/client/poa/bounce-back — broker action
// ============================================================================

import { Router, type Request, type Response } from "express";
import { getOrCreatePoaRecord, uploadPoa, brokerActivate, brokerBounceBack, InvalidPoaTransitionError } from "../services/poaLifecycle.js";

const DEMO_ORG_ID = "org_meridian";

export function createPoaRouter(): Router {
  const router = Router();

  router.get("/poa", async (_req: Request, res: Response) => {
    const record = await getOrCreatePoaRecord(DEMO_ORG_ID);
    res.status(200).json(record);
  });

  router.post("/poa/upload", async (req: Request, res: Response) => {
    const { documentId, brokerEmail, brokerName } = req.body ?? {};
    if (!documentId || !brokerEmail || !brokerName) {
      return res.status(400).json({ error: "documentId, brokerEmail, and brokerName are required." });
    }
    try {
      const record = await uploadPoa(DEMO_ORG_ID, documentId, brokerEmail, brokerName);
      return res.status(200).json(record);
    } catch (err) {
      if (err instanceof InvalidPoaTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  router.post("/poa/activate", async (_req: Request, res: Response) => {
    try {
      const record = await brokerActivate(DEMO_ORG_ID);
      return res.status(200).json(record);
    } catch (err) {
      if (err instanceof InvalidPoaTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  router.post("/poa/bounce-back", async (_req: Request, res: Response) => {
    try {
      const record = await brokerBounceBack(DEMO_ORG_ID);
      return res.status(200).json(record);
    } catch (err) {
      if (err instanceof InvalidPoaTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
