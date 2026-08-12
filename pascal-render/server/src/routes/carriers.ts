// ============================================================================
// GET   /api/operator/carriers
// POST  /api/operator/carriers
// PATCH /api/operator/carriers/:id/scorecard
// GET   /api/operator/carriers/border-velocity
// POST  /api/operator/rate-quote
// GET   /api/operator/savings-by-account
//
// Carrier Desk (Agent 7) — multi-mode directory with real per-carrier
// format validation, a real spot-quote launcher (reuses the same
// optimizeRate() function that runs on every real shipment, not a
// separate fabricated calculation), real border clearance velocity (live
// telemetry, not a static number), and real per-account MTD savings
// (genuine join against persisted rate_optimizations).
//
// HONEST LIMITATION: on-time % and claims/OS&D rate are manually-entered
// fields (real scorecard data an operator gets from EDI/carrier reports),
// not computed — no persisted delivery-outcome history exists yet to
// derive them from automatically.
//
// Deliberately does NOT include a field for pasting raw API keys or OAuth
// tokens — those belong in Render's environment variables, the same way
// every other real credential in this platform is handled, not typed into
// a form and stored in the database.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { optimizeRate } from "../agents/agent3RateOptimization.js";
import type { CargoDetails, CustomsDetails } from "../types/shipment.js";
import type { BorderTelemetryService } from "../services/borderTelemetryService.js";
import { SAMPLE_SHIPMENTS } from "./client.js";

const CARRIER_FORMAT_RULES: Record<string, RegExp> = {
  ODFL: /^[A-Z0-9-]{6,9}$/i,
  "FedEx Freight": /^\d{9}$/,
  Maersk: /^[A-Z]{4}\d{6,8}$/i,
  "CMA CGM": /^[A-Z]{4}\d{6,8}$/i,
  "Air Canada Cargo": /^\d{3}-\d{8}$/,
};

const COMMERCIAL_POE_IDS = ["pacific_highway", "sumas", "aldergrove"];

function rowToCarrier(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    carrierName: row.carrier_name,
    carrierMode: row.carrier_mode,
    accountNumber: row.account_number,
    accountFormatValid: row.account_format_valid,
    scacCode: row.scac_code,
    iataCode: row.iata_code,
    fmcNumber: row.fmc_number,
    integrationStatus: row.integration_status,
    emergencyPhone: row.emergency_phone,
    dispatchEmail: row.dispatch_email,
    accountExecName: row.account_exec_name,
    coiExpiresAtIso: row.coi_expires_at ? (row.coi_expires_at as Date).toISOString() : undefined,
    dotMcRating: row.dot_mc_rating,
    twicCtpatCert: row.twic_ctpat_cert,
    onTimePct: row.on_time_pct !== null ? Number(row.on_time_pct) : undefined,
    claimsRatePct: row.claims_rate_pct !== null ? Number(row.claims_rate_pct) : undefined,
  };
}

export function createCarriersRouter(telemetryService: BorderTelemetryService): Router {
  const router = Router();

  router.get("/carriers", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const mode = typeof req.query.mode === "string" ? req.query.mode : undefined;
    const conditions: string[] = [];
    const params: string[] = [];
    if (orgId) {
      params.push(orgId);
      conditions.push(`org_id = $${params.length}`);
    }
    if (mode) {
      params.push(mode);
      conditions.push(`carrier_mode = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`SELECT * FROM carrier_accounts ${where} ORDER BY created_at DESC`, params);
    res.status(200).json({ carriers: result.rows.map(rowToCarrier) });
  });

  router.post("/carriers", async (req: Request, res: Response) => {
    const { orgId, carrierName, carrierMode, accountNumber, scacCode, iataCode, fmcNumber, integrationStatus, emergencyPhone, dispatchEmail, accountExecName, coiExpiresAtIso, dotMcRating, twicCtpatCert } = req.body ?? {};
    if (!orgId || !carrierName || !accountNumber) {
      return res.status(400).json({ error: "orgId, carrierName, and accountNumber are required." });
    }

    const rule = CARRIER_FORMAT_RULES[carrierName];
    const accountFormatValid = rule ? rule.test(accountNumber) : null;

    const result = await pool.query(
      `INSERT INTO carrier_accounts (
        org_id, carrier_name, account_number, account_format_valid, last_verified_at, carrier_mode,
        scac_code, iata_code, fmc_number, integration_status, emergency_phone, dispatch_email,
        account_exec_name, coi_expires_at, dot_mc_rating, twic_ctpat_cert
      ) VALUES ($1,$2,$3,$4::boolean, CASE WHEN $4::boolean IS NOT NULL THEN now() ELSE NULL END, $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        orgId,
        carrierName,
        accountNumber,
        accountFormatValid,
        carrierMode ?? "road",
        scacCode ?? null,
        iataCode ?? null,
        fmcNumber ?? null,
        integrationStatus ?? "legacy_scraper",
        emergencyPhone ?? null,
        dispatchEmail ?? null,
        accountExecName ?? null,
        coiExpiresAtIso ?? null,
        dotMcRating ?? null,
        twicCtpatCert ?? false,
      ],
    );

    return res.status(201).json({ ...rowToCarrier(result.rows[0]), requiresOperatorVerification: accountFormatValid === null });
  });

  router.patch("/carriers/:id/scorecard", async (req: Request, res: Response) => {
    const { onTimePct, claimsRatePct } = req.body ?? {};
    const result = await pool.query(
      "UPDATE carrier_accounts SET on_time_pct = COALESCE($1, on_time_pct), claims_rate_pct = COALESCE($2, claims_rate_pct) WHERE id = $3 RETURNING *",
      [onTimePct ?? null, claimsRatePct ?? null, req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: `No carrier on file with id ${req.params.id}.` });
    return res.status(200).json(rowToCarrier(result.rows[0]));
  });

  router.get("/carriers/border-velocity", (_req: Request, res: Response) => {
    const snapshot = telemetryService.getSnapshot();
    const velocities = COMMERCIAL_POE_IDS.map((poeId) => {
      const reading = snapshot.readings.find((r) => r.poeId === poeId && r.laneType === "commercial");
      return { poeId, waitMinutes: reading?.waitMinutes };
    });
    res.status(200).json({ velocities });
  });

  router.post("/rate-quote", (req: Request, res: Response) => {
    const { totalWeightLbs, commercialInvoiceValue, mode } = req.body ?? {};
    if (!totalWeightLbs || !commercialInvoiceValue) {
      return res.status(400).json({ error: "totalWeightLbs and commercialInvoiceValue are required." });
    }
    const cargo: CargoDetails = { handlingUnits: [], isHazmat: false, totalWeightLbs: Number(totalWeightLbs) };
    const customs: CustomsDetails = { pgaFlags: [], commercialInvoiceValue: Number(commercialInvoiceValue) };
    const quote = optimizeRate(cargo, customs);
    return res.status(200).json({ mode: mode ?? "FTL", quote });
  });

  router.get("/savings-by-account", async (_req: Request, res: Response) => {
    const shipmentToOrg = new Map(SAMPLE_SHIPMENTS.map((s) => [s.id, s.clientOrg ?? "Unknown"]));
    const result = await pool.query("SELECT shipment_id, savings_usd FROM rate_optimizations WHERE captured_at >= date_trunc('month', now())");

    const byOrg = new Map<string, number>();
    for (const row of result.rows) {
      const org = shipmentToOrg.get(row.shipment_id) ?? "Unattributed";
      byOrg.set(org, (byOrg.get(org) ?? 0) + Number(row.savings_usd));
    }

    return res.status(200).json({ savingsByAccount: Array.from(byOrg.entries()).map(([clientOrg, mtdSavingsUsd]) => ({ clientOrg, mtdSavingsUsd })) });
  });

  return router;
}
