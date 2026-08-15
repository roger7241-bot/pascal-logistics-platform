// ============================================================================
// GET  /api/operator/vault
// POST /api/operator/vault
// Document Vault & OCR Intake (Operator desk #8) — stores document records
// and, when raw text is provided, runs it through the real
// documentExtraction.ts module already built and verified for the intake
// wizard, rather than duplicating that logic.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { extractShipmentFieldsFromText } from "../services/documentExtraction.js";
import { generateVaultDownloadUrl } from "../services/s3SignedUrls.js";
import { logSecurityAudit } from "../services/securityAuditLogger.js";

const VALID_CATEGORIES = ["commercial_invoice", "poa", "bill_of_lading", "sds", "usmca_certificate", "other"];
const AUDITED_CATEGORIES = new Set(["poa"]); // POA documents specifically named in the security brief; extend here if other categories need the same trail

function rowToDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    shipmentId: row.shipment_id,
    filename: row.filename,
    category: row.category,
    extractedFields: row.extracted_fields,
    expiresAtIso: row.expires_at ? (row.expires_at as Date).toISOString() : undefined,
    uploadedAt: row.uploaded_at,
    hasStoredFile: Boolean(row.s3_key),
  };
}

export function createVaultRouter(): Router {
  const router = Router();

  router.get("/vault", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const result = orgId
      ? await pool.query("SELECT * FROM vault_documents WHERE org_id = $1 ORDER BY uploaded_at DESC", [orgId])
      : await pool.query("SELECT * FROM vault_documents ORDER BY uploaded_at DESC");
    res.status(200).json({ documents: result.rows.map(rowToDocument) });
  });

  router.get("/vault/:id/download", async (req: Request, res: Response) => {
    const operatorName = req.header("x-operator-name") ?? "unknown";
    const result = await pool.query("SELECT * FROM vault_documents WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Document not found." });
    const doc = result.rows[0];

    if (!doc.s3_key) {
      return res.status(409).json({ error: "This document has no stored file — it was uploaded as OCR text only, not a binary file. No file exists to sign a URL for." });
    }

    const signed = await generateVaultDownloadUrl(doc.s3_key as string);

    if (doc.category === "poa" || AUDITED_CATEGORIES.has(doc.category as string)) {
      await logSecurityAudit({ orgId: doc.org_id as string, operatorName, resourceType: "poa_document", resourceId: doc.id as string, action: "download", ipAddress: req.ip });
    } else {
      await logSecurityAudit({ orgId: doc.org_id as string, operatorName, resourceType: "vault_document", resourceId: doc.id as string, action: "download", ipAddress: req.ip });
    }

    return res.status(200).json(signed);
  });

  router.post("/vault", async (req: Request, res: Response) => {
    const { orgId, shipmentId, filename, category, documentText, expiresAtIso } = req.body ?? {};
    if (!orgId || !filename || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `orgId, filename, and a valid category (${VALID_CATEGORIES.join(", ")}) are required.` });
    }

    // Real OCR/extraction pass when text is provided — same module and same
    // honest fallback behavior as the intake wizard's document parser.
    let extractedFields: unknown = null;
    if (typeof documentText === "string" && documentText.trim()) {
      const extraction = await extractShipmentFieldsFromText(documentText);
      extractedFields = extraction.fields ?? null;
    }

    const result = await pool.query(
      `INSERT INTO vault_documents (org_id, shipment_id, filename, category, extracted_fields, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [orgId, shipmentId ?? null, filename, category, extractedFields ? JSON.stringify(extractedFields) : null, expiresAtIso ?? null],
    );
    res.status(201).json(rowToDocument(result.rows[0]));
    return;
  });

  return router;
}
