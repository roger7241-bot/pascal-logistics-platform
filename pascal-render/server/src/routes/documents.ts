// ============================================================================
// POST /api/documents/extract
// ============================================================================

import { Router, type Request, type Response } from "express";
import { extractShipmentFieldsFromText } from "../services/documentExtraction.js";

export function createDocumentsRouter(): Router {
  const router = Router();

  router.post("/extract", async (req: Request, res: Response) => {
    const { documentText } = req.body ?? {};
    if (typeof documentText !== "string" || !documentText.trim()) {
      return res.status(400).json({ error: "documentText (string) is required." });
    }

    const result = await extractShipmentFieldsFromText(documentText);
    return res.status(result.success ? 200 : 502).json(result);
  });

  return router;
}
