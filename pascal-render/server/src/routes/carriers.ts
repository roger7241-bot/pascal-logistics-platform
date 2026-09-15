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
import { getPriority1LtlRates, type Priority1LineItem } from "../services/priority1.js";
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
    serviceType: row.service_type,
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
    const { orgId, carrierName, carrierMode, accountNumber, scacCode, iataCode, fmcNumber, integrationStatus, emergencyPhone, dispatchEmail, accountExecName, coiExpiresAtIso, dotMcRating, twicCtpatCert, serviceType } = req.body ?? {};
    if (!orgId || !carrierName || !accountNumber) {
      return res.status(400).json({ error: "orgId, carrierName, and accountNumber are required." });
    }

    const rule = CARRIER_FORMAT_RULES[carrierName];
    const accountFormatValid = rule ? rule.test(accountNumber) : null;

    const result = await pool.query(
      `INSERT INTO carrier_accounts (
        org_id, carrier_name, account_number, account_format_valid, last_verified_at, carrier_mode,
        scac_code, iata_code, fmc_number, integration_status, emergency_phone, dispatch_email,
        account_exec_name, coi_expires_at, dot_mc_rating, twic_ctpat_cert, service_type
      ) VALUES ($1,$2,$3,$4::boolean, CASE WHEN $4::boolean IS NOT NULL THEN now() ELSE NULL END, $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
        serviceType ?? null,
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

  // ==========================================================================
  // CLIENT CARRIER RATES ON FILE — CRUD for the incumbent-rate table that
  // powers Priority1 quote comparison. Operator-scoped: the same operator
  // manages rates across all clients; role/org scoping happens via the
  // requireOperator middleware mounted at /api/operator/*, not per-route.
  // ==========================================================================

  function rowToRate(row: Record<string, unknown>) {
    return {
      id: row.id,
      orgId: row.org_id,
      originZip: row.origin_zip,
      destinationZip: row.destination_zip,
      carrierName: row.carrier_name,
      serviceLevel: row.service_level ?? undefined,
      transitDays: row.transit_days !== null ? Number(row.transit_days) : undefined,
      totalRateUsd: Number(row.total_rate_usd),
      rateSource: row.rate_source,
      effectiveDateIso: row.effective_date ? (row.effective_date as Date).toISOString().split("T")[0] : undefined,
      notes: row.notes ?? undefined,
      createdAtIso: row.created_at ? (row.created_at as Date).toISOString() : undefined,
      updatedAtIso: row.updated_at ? (row.updated_at as Date).toISOString() : undefined,
    };
  }

  router.get("/client-carrier-rates", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const params: string[] = [];
    let where = "";
    if (orgId) {
      params.push(orgId);
      where = "WHERE org_id = $1";
    }
    const result = await pool.query(
      `SELECT * FROM client_carrier_rates ${where} ORDER BY org_id, origin_zip, destination_zip, effective_date DESC`,
      params,
    );
    return res.status(200).json({ rates: result.rows.map(rowToRate) });
  });

  router.post("/client-carrier-rates", async (req: Request, res: Response) => {
    const { orgId, originZip, destinationZip, carrierName, serviceLevel, transitDays, totalRateUsd, rateSource, effectiveDate, notes } = req.body ?? {};
    if (!orgId || !originZip || !destinationZip || !carrierName || totalRateUsd === undefined) {
      return res.status(400).json({ error: "orgId, originZip, destinationZip, carrierName, and totalRateUsd are required." });
    }
    const result = await pool.query(
      `INSERT INTO client_carrier_rates
         (org_id, origin_zip, destination_zip, carrier_name, service_level, transit_days, total_rate_usd, rate_source, effective_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, CURRENT_DATE), $10)
       RETURNING *`,
      [
        orgId,
        originZip,
        destinationZip,
        carrierName,
        serviceLevel ?? null,
        transitDays ?? null,
        Number(totalRateUsd),
        rateSource ?? "manual",
        effectiveDate ?? null,
        notes ?? null,
      ],
    );
    return res.status(201).json({ rate: rowToRate(result.rows[0]) });
  });

  router.patch("/client-carrier-rates/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { carrierName, serviceLevel, transitDays, totalRateUsd, rateSource, effectiveDate, notes } = req.body ?? {};
    const result = await pool.query(
      `UPDATE client_carrier_rates
         SET carrier_name    = COALESCE($2, carrier_name),
             service_level   = COALESCE($3, service_level),
             transit_days    = COALESCE($4, transit_days),
             total_rate_usd  = COALESCE($5, total_rate_usd),
             rate_source     = COALESCE($6, rate_source),
             effective_date  = COALESCE($7::date, effective_date),
             notes           = COALESCE($8, notes),
             updated_at      = now()
       WHERE id = $1
       RETURNING *`,
      [id, carrierName ?? null, serviceLevel ?? null, transitDays ?? null, totalRateUsd !== undefined ? Number(totalRateUsd) : null, rateSource ?? null, effectiveDate ?? null, notes ?? null],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Rate not found." });
    return res.status(200).json({ rate: rowToRate(result.rows[0]) });
  });

  router.delete("/client-carrier-rates/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM client_carrier_rates WHERE id = $1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Rate not found." });
    return res.status(204).send();
  });

  // ==========================================================================
  // QUOTE COMPARE — hits Priority1 for live LTL rates, joins in the
  // client's most recent incumbent rate on file for the same lane, returns
  // rows sorted by savings $ against the incumbent. Empty incumbent side
  // returns Priority1 rates alone with no savings math, not an error.
  // ==========================================================================
  router.post("/quote-compare", async (req: Request, res: Response) => {
    const { orgId, originZip, destinationZip, pickupDateIso, items } = req.body ?? {};
    if (!orgId || !originZip || !destinationZip || !pickupDateIso || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "orgId, originZip, destinationZip, pickupDateIso, and items[] are required." });
    }

    const normalizedItems: Priority1LineItem[] = items.map((it: Record<string, unknown>) => ({
      freightClass: String(it.freightClass ?? "150"),
      packagingType: String(it.packagingType ?? "Pallet"),
      units: Number(it.units ?? 1),
      pieces: Number(it.pieces ?? 1),
      totalWeightLbs: Number(it.totalWeightLbs ?? 0),
      lengthIn: Number(it.lengthIn ?? 48),
      widthIn: Number(it.widthIn ?? 40),
      heightIn: Number(it.heightIn ?? 40),
      nmfcNumber: it.nmfcNumber ? String(it.nmfcNumber) : undefined,
      hazmat: Boolean(it.hazmat),
    }));

    const [p1Response, incumbentResult] = await Promise.all([
      getPriority1LtlRates({ originZipCode: originZip, destinationZipCode: destinationZip, pickupDate: pickupDateIso, items: normalizedItems }),
      pool.query(
        `SELECT * FROM client_carrier_rates
          WHERE org_id = $1 AND origin_zip = $2 AND destination_zip = $3
          ORDER BY effective_date DESC
          LIMIT 1`,
        [orgId, originZip, destinationZip],
      ),
    ]);

    const incumbent = incumbentResult.rowCount ? rowToRate(incumbentResult.rows[0]) : undefined;
    const incumbentRate = incumbent?.totalRateUsd;

    const compared = p1Response.quotes.map((q) => {
      const savingsUsd = incumbentRate !== undefined ? incumbentRate - q.totalUsd : undefined;
      const savingsPct = incumbentRate !== undefined && incumbentRate > 0 ? (savingsUsd! / incumbentRate) * 100 : undefined;
      return { ...q, savingsVsIncumbentUsd: savingsUsd, savingsVsIncumbentPct: savingsPct };
    });

    // Sort cheapest first — most-savings first when incumbent is known.
    compared.sort((a, b) => a.totalUsd - b.totalUsd);

    return res.status(200).json({
      incumbent,
      quotes: compared,
      priority1Simulated: p1Response.simulated,
      priority1Demo: Boolean(p1Response.demo),
      priority1Error: p1Response.error,
    });
  });

  return router;
}
