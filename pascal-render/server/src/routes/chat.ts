// ============================================================================
// POST /api/client/chat
// ============================================================================

import { Router, type Request, type Response } from "express";
import { askAgent5 } from "../services/agent5Chat.js";

export function createChatRouter(): Router {
  const router = Router();

  router.post("/chat", async (req: Request, res: Response) => {
    const { orgId, question } = req.body ?? {};
    if (!orgId || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "orgId and question are required." });
    }
    const result = await askAgent5(orgId, question);
    return res.status(200).json(result);
  });

  return router;
}
