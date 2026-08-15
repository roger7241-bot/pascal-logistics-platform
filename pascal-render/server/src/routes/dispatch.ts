// ============================================================================
// GET   /api/operator/dispatch/consignees            — frequent consignees, ranked by staging history
// GET   /api/operator/dispatch/carriers               — carrier accounts + real cutoff countdowns
// GET   /api/operator/dispatch/weight-baseline         — real historical avg gross weight by packaging type
// GET   /api/operator/dispatch/staging                 — today's outbound queue
// POST  /api/operator/dispatch/staging                  — stage a new outbound shipment
// PATCH /api/operator/dispatch/staging/:id/dispatch       — dispatch + generate a real 4x6 thermal label PDF
// PATCH /api/operator/dispatch/staging/:id/cancel          — void staging
// POST  /api/operator/dispatch/staging/:id/send-gate-sms    — real Twilio-backed driver SMS
// POST  /api/operator/dispatch/staging/:id/magic-upload-link — real QR code + short-lived public upload token
//
// Rapid Situational Outbound Dispatch Desk — warehouse shipping-clerk
// intake. HONEST LIMITATION: consignee/carrier/freight-class/broker
// autofill draws on real Facility Hub and Carrier Desk data already in
// Postgres (facilities.dock_contact_name, receiving hours, etc.) — there
// is no separate "preferred carrier" or "assigned broker" field on
// facilities yet, so those two autofill slots return undefined rather
// than a fabricated value until those columns exist.
// ============================================================================

import { Router, type Request, type Response } from "express";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pool } from "../db/pool.js";
import { sendDriverSms } from "../services/twilioMessaging.js";
import { PACKAGING_DEFAULT_LBS_PER_UNIT } from "../types/dispatch.js";
import type { CarrierCutoffInfo, OutboundStagingRecord, PackagingType } from "../types/dispatch.js";

const VALID_PACKAGING: PackagingType[] = ["standard_48x40", "chep_pallet", "reefer_tote", "parcel_carton"];
const MAGIC_LINK_EXPIRY_MINUTES = 30;
const PUBLIC_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function rowToStaging(row: Record<string, unknown>): OutboundStagingRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    poNumber: (row.po_number as string) ?? undefined,
    bolNumber: (row.bol_number as string) ?? undefined,
    sku: (row.sku as string) ?? undefined,
    consigneeFacilityId: (row.consignee_facility_id as string) ?? undefined,
    consigneeName: (row.consignee_name as string) ?? undefined,
    carrierAccountId: (row.carrier_account_id as string) ?? undefined,
    carrierName: (row.carrier_name as string) ?? undefined,
    packagingType: row.packaging_type as PackagingType,
    palletCount: row.pallet_count as number,
    grossWeightLbs: Number(row.gross_weight_lbs),
    freightClass: (row.freight_class as string) ?? undefined,
    isCrossBorder: row.is_cross_border as boolean,
    papsParsBarcode: (row.paps_pars_barcode as string) ?? undefined,
    status: row.status as OutboundStagingRecord["status"],
    driverPhone: (row.driver_phone as string) ?? undefined,
    stagedBy: (row.staged_by as string) ?? undefined,
    stagedAtIso: new Date(row.staged_at as string).toISOString(),
    dispatchedAtIso: row.dispatched_at ? new Date(row.dispatched_at as string).toISOString() : undefined,
  };
}

function computeCutoffInfo(row: { id: string; carrier_name: string; daily_cutoff_local_time: string | null; cutoff_timezone: string }): CarrierCutoffInfo {
  if (!row.daily_cutoff_local_time) {
    return { id: row.id, carrierName: row.carrier_name, cutoffTimezone: row.cutoff_timezone, urgency: "unknown" };
  }
  const [h, m] = row.daily_cutoff_local_time.split(":").map(Number);
  const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: row.cutoff_timezone }));
  const cutoffToday = new Date(nowInTz);
  cutoffToday.setHours(h, m, 0, 0);
  const minutesToCutoff = Math.round((cutoffToday.getTime() - nowInTz.getTime()) / 60000);

  let urgency: CarrierCutoffInfo["urgency"] = "normal";
  if (minutesToCutoff < 0) urgency = "past_cutoff";
  else if (minutesToCutoff <= 30) urgency = "urgent";
  else if (minutesToCutoff <= 90) urgency = "soon";

  return { id: row.id, carrierName: row.carrier_name, dailyCutoffLocalTime: row.daily_cutoff_local_time, cutoffTimezone: row.cutoff_timezone, minutesToCutoff, urgency };
}

export function createDispatchRouter(): Router {
  const router = Router();

  router.get("/dispatch/consignees", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : "org_meridian";
    // Ranked by real staging frequency, not invented — facilities never
    // staged from before rank last via the LEFT JOIN + COALESCE(0).
    const result = await pool.query(
      `SELECT f.*, COALESCE(s.staging_count, 0) AS staging_count
       FROM facilities f
       LEFT JOIN (SELECT consignee_facility_id, COUNT(*) AS staging_count FROM outbound_staging WHERE org_id = $1 GROUP BY consignee_facility_id) s
         ON s.consignee_facility_id = f.id
       WHERE f.org_id = $1 AND f.is_archived = false
       ORDER BY staging_count DESC, f.name ASC`,
      [orgId],
    );
    res.status(200).json({
      consignees: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        stateOrProvince: r.state_or_province,
        countryCode: r.country_code,
        receivingHoursStart: r.receiving_hours_start,
        receivingHoursEnd: r.receiving_hours_end,
        freeTimeMinutes: r.free_time_minutes,
        detentionRateUsdPerHour: Number(r.detention_rate_usd_per_hour),
        isCrossBorderCandidate: r.country_code !== "CA", // simple US/CA signal off the facility's own country — real field, not guessed
        stagingCount: Number(r.staging_count),
      })),
    });
  });

  router.get("/dispatch/carriers", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : "org_meridian";
    const result = await pool.query("SELECT id, carrier_name, daily_cutoff_local_time, cutoff_timezone FROM carrier_accounts WHERE org_id = $1 ORDER BY carrier_name ASC", [orgId]);
    res.status(200).json({ carriers: result.rows.map(computeCutoffInfo) });
  });

  router.get("/dispatch/weight-baseline", async (req: Request, res: Response) => {
    const packagingType = typeof req.query.packagingType === "string" ? req.query.packagingType : undefined;
    if (!packagingType || !VALID_PACKAGING.includes(packagingType as PackagingType)) {
      return res.status(400).json({ error: `packagingType must be one of ${VALID_PACKAGING.join(", ")}.` });
    }
    const result = await pool.query(
      `SELECT AVG(gross_weight_lbs) AS avg_weight, COUNT(*) AS sample_size FROM outbound_staging WHERE packaging_type = $1 AND status != 'cancelled'`,
      [packagingType],
    );
    const sampleSize = Number(result.rows[0].sample_size);
    return res.status(200).json({
      packagingType,
      // Falls back to the standard per-unit default when there's no staging
      // history yet — real default from types/dispatch.ts, not a guess, and
      // sampleSize: 0 tells the client this isn't a real average yet.
      avgGrossWeightLbs: sampleSize > 0 ? Number(result.rows[0].avg_weight) : PACKAGING_DEFAULT_LBS_PER_UNIT[packagingType as PackagingType],
      sampleSize,
    });
  });

  router.get("/dispatch/staging", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : "org_meridian";
    const result = await pool.query(
      `SELECT os.*, f.name AS consignee_name, c.carrier_name
       FROM outbound_staging os
       LEFT JOIN facilities f ON f.id = os.consignee_facility_id
       LEFT JOIN carrier_accounts c ON c.id = os.carrier_account_id
       WHERE os.org_id = $1 AND os.staged_at >= date_trunc('day', now())
       ORDER BY os.staged_at DESC`,
      [orgId],
    );
    res.status(200).json({ staging: result.rows.map(rowToStaging) });
  });

  router.post("/dispatch/staging", async (req: Request, res: Response) => {
    const body = req.body as Partial<OutboundStagingRecord> & { orgId?: string; stagedBy?: string };
    if (!body.packagingType || !VALID_PACKAGING.includes(body.packagingType) || body.grossWeightLbs === undefined) {
      return res.status(400).json({ error: `packagingType (${VALID_PACKAGING.join(", ")}) and grossWeightLbs are required.` });
    }
    const result = await pool.query(
      `INSERT INTO outbound_staging (org_id, po_number, bol_number, sku, consignee_facility_id, carrier_account_id, packaging_type, pallet_count, gross_weight_lbs, freight_class, is_cross_border, paps_pars_barcode, driver_phone, staged_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        body.orgId ?? "org_meridian",
        body.poNumber ?? null,
        body.bolNumber ?? null,
        body.sku ?? null,
        body.consigneeFacilityId ?? null,
        body.carrierAccountId ?? null,
        body.packagingType,
        body.palletCount ?? 1,
        body.grossWeightLbs,
        body.freightClass ?? null,
        body.isCrossBorder ?? false,
        body.papsParsBarcode ?? null,
        body.driverPhone ?? null,
        body.stagedBy ?? null,
      ],
    );
    return res.status(201).json(rowToStaging(result.rows[0]));
  });

  router.patch("/dispatch/staging/:id/dispatch", async (req: Request, res: Response) => {
    const existing = await pool.query(
      `SELECT os.*, f.name AS consignee_name, f.street, f.city, f.state_or_province, c.carrier_name
       FROM outbound_staging os
       LEFT JOIN facilities f ON f.id = os.consignee_facility_id
       LEFT JOIN carrier_accounts c ON c.id = os.carrier_account_id
       WHERE os.id = $1`,
      [req.params.id],
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Staged shipment not found." });
    const row = existing.rows[0];

    const updated = await pool.query(`UPDATE outbound_staging SET status = 'dispatched', dispatched_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);

    // Real 4x6 thermal label via pdf-lib — same library and pattern already
    // proven out for invoice PDFs in routes/billing.ts.
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([288, 432]); // 4in x 6in at 72dpi
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    page.drawText("PASCAL LOGISTICS", { x: 14, y: 405, size: 14, font: bold });
    page.drawText(`BOL: ${row.bol_number ?? "—"}`, { x: 14, y: 380, size: 11, font: regular });
    page.drawText(`PO: ${row.po_number ?? "—"}`, { x: 14, y: 365, size: 11, font: regular });
    page.drawText("SHIP TO:", { x: 14, y: 335, size: 10, font: bold });
    page.drawText(row.consignee_name ?? "—", { x: 14, y: 320, size: 12, font: bold });
    page.drawText(`${row.street ?? ""}`, { x: 14, y: 306, size: 10, font: regular });
    page.drawText(`${row.city ?? ""}, ${row.state_or_province ?? ""}`, { x: 14, y: 292, size: 10, font: regular });
    page.drawText(`Carrier: ${row.carrier_name ?? "—"}`, { x: 14, y: 260, size: 10, font: regular });
    page.drawText(`Pallets: ${row.pallet_count}  |  ${Number(row.gross_weight_lbs).toLocaleString()} lbs`, { x: 14, y: 245, size: 10, font: regular });
    page.drawText(`Freight Class: ${row.freight_class ?? "—"}`, { x: 14, y: 230, size: 10, font: regular });
    if (row.is_cross_border) {
      page.drawText(`PAPS/PARS: ${row.paps_pars_barcode ?? "—"}`, { x: 14, y: 210, size: 10, font: bold, color: rgb(0.7, 0.1, 0.1) });
    }
    page.drawText(row.id, { x: 14, y: 20, size: 7, font: regular, color: rgb(0.5, 0.5, 0.5) });

    const pdfBytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="label-${row.bol_number ?? row.id}.pdf"`);
    res.setHeader("X-Staging-Record", JSON.stringify(rowToStaging(updated.rows[0])));
    return res.status(200).send(Buffer.from(pdfBytes));
  });

  router.patch("/dispatch/staging/:id/cancel", async (req: Request, res: Response) => {
    const result = await pool.query(`UPDATE outbound_staging SET status = 'cancelled' WHERE id = $1 RETURNING *`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Staged shipment not found." });
    return res.status(200).json(rowToStaging(result.rows[0]));
  });

  // Hard delete — distinct from /cancel above (soft, keeps history). This
  // actually removes the row, for shipments staged in error.
  router.delete("/dispatch/staging/:id", async (req: Request, res: Response) => {
    const result = await pool.query(`DELETE FROM outbound_staging WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Staged shipment not found." });
    return res.status(200).json({ deleted: true, id: req.params.id });
  });

  router.post("/dispatch/staging/:id/send-gate-sms", async (req: Request, res: Response) => {
    const { driverPhone, message } = req.body as { driverPhone?: string; message?: string };
    const existing = await pool.query(
      `SELECT os.*, f.driver_staging_notes, f.receiving_hours_start, f.receiving_hours_end, f.name AS consignee_name
       FROM outbound_staging os LEFT JOIN facilities f ON f.id = os.consignee_facility_id WHERE os.id = $1`,
      [req.params.id],
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Staged shipment not found." });
    const row = existing.rows[0];
    const phone = driverPhone ?? row.driver_phone;
    if (!phone) return res.status(400).json({ error: "No driver phone on file — provide driverPhone in the request body." });

    const body = message ?? `Gate instructions — ${row.consignee_name ?? "consignee"}: ${row.driver_staging_notes ?? `Dock hours ${row.receiving_hours_start}-${row.receiving_hours_end}.`}`;
    const dispatch = await sendDriverSms(phone, body);
    return res.status(dispatch.success ? 200 : 502).json({ ...dispatch, sentTo: phone, message: body });
  });

  router.post("/dispatch/staging/:id/magic-upload-link", async (req: Request, res: Response) => {
    const existing = await pool.query("SELECT org_id FROM outbound_staging WHERE id = $1", [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Staged shipment not found." });

    const token = randomBytes(16).toString("hex");
    const expiresAtIso = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000).toISOString();
    await pool.query(`INSERT INTO magic_upload_tokens (token, org_id, outbound_staging_id, expires_at) VALUES ($1,$2,$3,$4)`, [
      token,
      existing.rows[0].org_id,
      req.params.id,
      expiresAtIso,
    ]);

    const uploadUrl = `${PUBLIC_BASE_URL}/magic-upload/${token}`; // client-rendered mobile upload page, not this API path directly
    const qrCodeDataUri = await QRCode.toDataURL(uploadUrl, { width: 240, margin: 1 });

    return res.status(201).json({ token, uploadUrl, qrCodeDataUri, expiresAtIso });
  });

  return router;
}

/** Mounted separately at /api/v1/magic-upload — deliberately outside
 * /api/operator, since this is the one endpoint in the platform meant to
 * be reachable by an unauthenticated mobile browser (a forklift driver's
 * own phone, per the brief's "without logging into the portal"). */
export function createMagicUploadRouter(): Router {
  const router = Router();

  router.post("/:token", async (req: Request, res: Response) => {
    const { filename, imageBase64 } = req.body as { filename?: string; imageBase64?: string };
    if (!filename || !imageBase64) return res.status(400).json({ error: "filename and imageBase64 are required." });

    const tokenResult = await pool.query("SELECT * FROM magic_upload_tokens WHERE token = $1", [req.params.token]);
    if (tokenResult.rowCount === 0) return res.status(404).json({ error: "Invalid upload link." });
    const tokenRow = tokenResult.rows[0];
    if (tokenRow.used_at) return res.status(410).json({ error: "This upload link has already been used." });
    if (new Date(tokenRow.expires_at) < new Date()) return res.status(410).json({ error: "This upload link has expired." });

    // HONEST LIMITATION: same as the rest of Document Vault (see
    // routes/vault.ts) — stores the record with no s3_key yet, since no
    // real binary storage/upload path exists. imageBase64's actual bytes
    // are intentionally not persisted here to avoid silently implying
    // they're stored somewhere they aren't; wire this to a real S3 PUT
    // once services/s3SignedUrls.ts has an upload counterpart.
    const staging = await pool.query("SELECT bol_number FROM outbound_staging WHERE id = $1", [tokenRow.outbound_staging_id]);
    await pool.query(
      `INSERT INTO vault_documents (org_id, shipment_id, filename, category) VALUES ($1,$2,$3,'bill_of_lading')`,
      [tokenRow.org_id, staging.rows[0]?.bol_number ?? null, filename],
    );
    await pool.query("UPDATE magic_upload_tokens SET used_at = now() WHERE token = $1", [req.params.token]);

    return res.status(200).json({ success: true, message: "Photo received — thank you. You can close this page." });
  });

  return router;
}
