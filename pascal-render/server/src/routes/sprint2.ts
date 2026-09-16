// ============================================================================
// SPRINT 2 ROUTES — client onboarding + document upload + notification prefs
// + per-client branding. Mounted on both operator and client scopes with
// appropriate role gates. Operators write; clients read + upload their own.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { generateVaultUploadUrl, generateVaultDownloadUrl } from "../services/s3SignedUrls.js";

const DEFAULT_ONBOARDING_STEPS: { step_key: string; step_label: string; ordered_position: number }[] = [
  { step_key: "poa_us",             step_label: "POA on file with your US customs broker",     ordered_position: 10 },
  { step_key: "poa_ca",             step_label: "POA on file with your Canadian customs broker", ordered_position: 20 },
  { step_key: "w9",                 step_label: "W9 / equivalent for our billing",             ordered_position: 30 },
  { step_key: "stripe",             step_label: "Stripe subscription active for retainer",     ordered_position: 40 },
  { step_key: "kickoff",            step_label: "Kickoff call with Roger",                     ordered_position: 50 },
  { step_key: "portal_walkthrough", step_label: "Portal walkthrough — magic upload + tracking", ordered_position: 60 },
  { step_key: "brokers_confirmed",  step_label: "Both brokers of record confirmed with us",    ordered_position: 70 },
  { step_key: "first_shipment",     step_label: "First shipment moving through Pascal",        ordered_position: 80 },
];

function resolveOrgId(req: Request, allowQueryOverride: boolean): string | undefined {
  if (allowQueryOverride && req.authUser?.role === "operator") {
    const q = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    return q ?? req.authUser?.orgId ?? undefined;
  }
  return req.authUser?.orgId ?? undefined;
}

// Ensure a client has the default checklist. Idempotent — inserts what's
// missing, leaves existing rows untouched.
async function seedOnboardingSteps(orgId: string) {
  for (const s of DEFAULT_ONBOARDING_STEPS) {
    await pool.query(
      `INSERT INTO client_onboarding_steps (org_id, step_key, step_label, ordered_position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, step_key) DO NOTHING`,
      [orgId, s.step_key, s.step_label, s.ordered_position],
    );
  }
}

export function createSprint2Router(scope: "operator" | "client"): Router {
  const router = Router();
  const allowQueryOverride = scope === "operator";

  // ============ Onboarding =====================================================
  router.get("/onboarding-status", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    await seedOnboardingSteps(orgId);
    const result = await pool.query(
      `SELECT step_key, step_label, status, notes, completed_at, ordered_position
       FROM client_onboarding_steps WHERE org_id = $1 ORDER BY ordered_position ASC`,
      [orgId],
    );
    const done = result.rows.filter((r) => r.status === "completed").length;
    return res.status(200).json({
      orgId,
      steps: result.rows,
      completedCount: done,
      totalCount: result.rowCount,
      progressPct: result.rowCount ? Math.round((done / (result.rowCount ?? 1)) * 100) : 0,
    });
  });

  // Only operators can mark steps — clients see read-only.
  if (scope === "operator") {
    router.put("/accounts/:orgId/onboarding-step/:stepKey", async (req: Request, res: Response) => {
      const { status, notes } = req.body ?? {};
      const valid = ["pending", "in_progress", "completed", "blocked", "not_applicable"];
      if (!valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(", ")}` });
      await seedOnboardingSteps(req.params.orgId);
      const result = await pool.query(
        `UPDATE client_onboarding_steps
           SET status = $1,
               notes = COALESCE($2, notes),
               completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
               updated_at = now()
         WHERE org_id = $3 AND step_key = $4
         RETURNING *`,
        [status, notes ?? null, req.params.orgId, req.params.stepKey],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Step not found." });
      return res.status(200).json({ step: result.rows[0] });
    });
  }

  // ============ Document Upload ================================================
  // Client asks for a presigned PUT URL, uploads directly to S3, then confirms.
  router.post("/documents/upload-url", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const { filename, category, contentType } = req.body ?? {};
    const validCategories = ["commercial_invoice", "poa", "bill_of_lading", "sds", "usmca_certificate", "other"];
    if (!filename || typeof filename !== "string") return res.status(400).json({ error: "filename required." });
    if (!validCategories.includes(category)) return res.status(400).json({ error: `category must be one of: ${validCategories.join(", ")}` });
    if (!contentType || typeof contentType !== "string") return res.status(400).json({ error: "contentType required." });

    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    const objectKey = `client-uploads/${orgId}/${Date.now()}_${safeName}`;
    const signed = await generateVaultUploadUrl(objectKey, contentType);
    return res.status(200).json({ uploadUrl: signed.url, objectKey, simulated: signed.simulated, expiresInSeconds: signed.expiresInSeconds });
  });

  // After the browser PUTs to S3, confirm the file — inserts the vault row.
  router.post("/documents/confirm", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const { objectKey, filename, category, shipmentId } = req.body ?? {};
    const validCategories = ["commercial_invoice", "poa", "bill_of_lading", "sds", "usmca_certificate", "other"];
    if (!objectKey || !filename || !validCategories.includes(category)) {
      return res.status(400).json({ error: "objectKey, filename, category required." });
    }
    const result = await pool.query(
      `INSERT INTO vault_documents (org_id, shipment_id, filename, category, s3_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, filename, category, uploaded_at`,
      [orgId, shipmentId ?? null, filename, category, objectKey],
    );
    return res.status(201).json({ document: result.rows[0] });
  });

  // List client's documents.
  router.get("/documents", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const result = await pool.query(
      `SELECT id, filename, category, uploaded_at, s3_key
       FROM vault_documents WHERE org_id = $1 ORDER BY uploaded_at DESC LIMIT 200`,
      [orgId],
    );
    return res.status(200).json({ documents: result.rows });
  });

  router.get("/documents/:id/download-url", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const result = await pool.query(
      `SELECT s3_key FROM vault_documents WHERE id = $1 AND org_id = $2`,
      [req.params.id, orgId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Document not found." });
    const key = result.rows[0].s3_key as string | null;
    if (!key) return res.status(400).json({ error: "No S3 key on file for this document." });
    const signed = await generateVaultDownloadUrl(key);
    return res.status(200).json({ downloadUrl: signed.url, simulated: signed.simulated, expiresInSeconds: signed.expiresInSeconds });
  });

  // ============ Notification prefs ============================================
  router.get("/notification-preferences", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const result = await pool.query(
      `SELECT notification_preferences, brand_color, logo_url, company_name FROM accounts WHERE org_id = $1`,
      [orgId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Account not found." });
    return res.status(200).json({
      preferences: result.rows[0].notification_preferences ?? {},
      branding: {
        companyName: result.rows[0].company_name,
        brandColor: result.rows[0].brand_color,
        logoUrl: result.rows[0].logo_url,
      },
    });
  });

  router.put("/notification-preferences", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const prefs = req.body?.preferences;
    if (!prefs || typeof prefs !== "object") return res.status(400).json({ error: "preferences object required." });
    // Validated shape (all boolean, all optional).
    const allowed = ["dailyBriefEmail", "weeklyPackEmail", "exceptionAlertsEmail", "tariffAlertsEmail", "onboardingRemindersEmail"];
    const filtered: Record<string, boolean> = {};
    for (const k of allowed) if (typeof prefs[k] === "boolean") filtered[k] = prefs[k];
    const result = await pool.query(
      `UPDATE accounts SET notification_preferences = $1::jsonb, updated_at = now() WHERE org_id = $2
       RETURNING notification_preferences`,
      [JSON.stringify(filtered), orgId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Account not found." });
    return res.status(200).json({ preferences: result.rows[0].notification_preferences });
  });

  // ============ Branding (operator-only) =====================================
  if (scope === "operator") {
    router.put("/accounts/:orgId/branding", async (req: Request, res: Response) => {
      const { brandColor, logoUrl } = req.body ?? {};
      // Very light validation — hex color OR css color name, http(s) URL.
      if (brandColor && (typeof brandColor !== "string" || brandColor.length > 40)) return res.status(400).json({ error: "brandColor invalid." });
      if (logoUrl && (typeof logoUrl !== "string" || !/^https?:\/\//i.test(logoUrl))) return res.status(400).json({ error: "logoUrl must be http(s)." });
      const result = await pool.query(
        `UPDATE accounts
           SET brand_color = COALESCE($1, brand_color),
               logo_url    = COALESCE($2, logo_url),
               updated_at  = now()
         WHERE org_id = $3
         RETURNING org_id, company_name, brand_color, logo_url`,
        [brandColor ?? null, logoUrl ?? null, req.params.orgId],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: "Account not found." });
      return res.status(200).json({ account: result.rows[0] });
    });
  }

  return router;
}
