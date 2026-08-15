// ============================================================================
// GET/POST /api/client/facilities
// GET/POST /api/client/commodities
// GET/PUT  /api/client/alert-preferences
// Now backed by real Postgres (schema.sql) instead of in-memory Maps —
// closes the persistence gap from the earlier round.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import type { AlertPreference, CommodityProfile, FacilityProfile } from "../types/facility.js";

const DEMO_ORG_ID = "org_meridian"; // stand-in for the authenticated session's orgId

function rowToFacility(row: Record<string, unknown>): FacilityProfile {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    role: row.role as FacilityProfile["role"],
    name: row.name as string,
    street: row.street as string,
    city: row.city as string,
    stateOrProvince: row.state_or_province as string,
    countryCode: row.country_code as string,
    postalCode: row.postal_code as string,
    contactPhoneE164: (row.contact_phone_e164 as string) ?? undefined,
    dockHeight: row.dock_height as boolean,
    driveInRamp: row.drive_in_ramp as boolean,
    liftgateRequired: row.liftgate_required as boolean,
    forkliftOnSite: row.forklift_on_site as boolean,
    maxTrailerLength: row.max_trailer_length as FacilityProfile["maxTrailerLength"],
    receivingHoursStart: row.receiving_hours_start as string,
    receivingHoursEnd: row.receiving_hours_end as string,
    lunchBreakClosure: (row.lunch_break_closure as string) ?? undefined,
    appointmentRequired: row.appointment_required as boolean,
    pickupLeadTimeHours: row.pickup_lead_time_hours as number,
    driverPPE: (row.driver_ppe as string[]) ?? [],
    twicCardRequired: row.twic_card_required as boolean,
    checkInInstructions: (row.check_in_instructions as string) ?? undefined,
    dockContactName: (row.dock_contact_name as string) ?? undefined,
    dockContactPhone: (row.dock_contact_phone as string) ?? undefined,
    receivingEmail: (row.receiving_email as string) ?? undefined,
    breakWindow: (row.break_window as string) ?? undefined,
    dockDoorCount: (row.dock_door_count as number) ?? undefined,
    isoContainerCapable: row.iso_container_capable as boolean,
    scaleOnSite: row.scale_on_site as boolean,
    hardHatRequired: row.hard_hat_required as boolean,
    steelToeRequired: row.steel_toe_required as boolean,
    driverStagingNotes: (row.driver_staging_notes as string) ?? undefined,
    stagingMapUrl: (row.staging_map_url as string) ?? undefined,
    freeTimeMinutes: row.free_time_minutes as number,
    detentionRateUsdPerHour: Number(row.detention_rate_usd_per_hour),
    capabilities: (row.capabilities as FacilityProfile["capabilities"]) ?? [],
    isArchived: row.is_archived as boolean,
    addedBy: row.added_by as FacilityProfile["addedBy"],
  };
}

function rowToCommodity(row: Record<string, unknown>): CommodityProfile {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    productName: row.product_name as string,
    description: (row.description as string) ?? undefined,
    htsCode: row.hts_code as string,
    countryOfOrigin: row.country_of_origin as string,
    usmcaEligible: row.usmca_eligible as boolean,
    isHazmat: row.is_hazmat as boolean,
    hazmat: row.is_hazmat
      ? {
          unNumber: (row.hazmat_un_number as string) ?? undefined,
          hazardClass: (row.hazmat_hazard_class as string) ?? undefined,
          packingGroup: (row.hazmat_packing_group as string) ?? undefined,
          sdsOnFile: row.hazmat_sds_on_file as boolean,
        }
      : undefined,
    preferredPoe: (row.preferred_poe as string) ?? undefined,
  };
}

export function createFacilitiesRouter(): Router {
  const router = Router();

  router.get("/facilities", async (_req: Request, res: Response) => {
    const result = await pool.query("SELECT * FROM facilities WHERE org_id = $1 ORDER BY created_at DESC", [DEMO_ORG_ID]);
    res.status(200).json({ facilities: result.rows.map(rowToFacility) });
  });

  router.post("/facilities", async (req: Request, res: Response) => {
    const body = req.body as Partial<FacilityProfile>;
    if (!body.name || !body.street || !body.city || !body.countryCode) {
      return res.status(400).json({ error: "name, street, city, and countryCode are required." });
    }

    const result = await pool.query(
      `INSERT INTO facilities (
        org_id, role, name, street, city, state_or_province, country_code, postal_code, contact_phone_e164,
        dock_height, drive_in_ramp, liftgate_required, forklift_on_site, max_trailer_length,
        receiving_hours_start, receiving_hours_end, lunch_break_closure, appointment_required,
        pickup_lead_time_hours, driver_ppe, twic_card_required, check_in_instructions
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *`,
      [
        DEMO_ORG_ID,
        body.role ?? "both",
        body.name,
        body.street,
        body.city,
        body.stateOrProvince ?? "",
        body.countryCode,
        body.postalCode ?? "",
        body.contactPhoneE164 ?? null,
        body.dockHeight ?? false,
        body.driveInRamp ?? false,
        body.liftgateRequired ?? false,
        body.forkliftOnSite ?? false,
        body.maxTrailerLength ?? "53ft",
        body.receivingHoursStart ?? "08:00",
        body.receivingHoursEnd ?? "16:00",
        body.lunchBreakClosure ?? null,
        body.appointmentRequired ?? false,
        body.pickupLeadTimeHours ?? 24,
        body.driverPPE ?? [],
        body.twicCardRequired ?? false,
        body.checkInInstructions ?? null,
      ],
    );

    return res.status(201).json(rowToFacility(result.rows[0]));
  });

  router.get("/commodities", async (_req: Request, res: Response) => {
    const result = await pool.query("SELECT * FROM commodities WHERE org_id = $1 ORDER BY created_at DESC", [DEMO_ORG_ID]);
    res.status(200).json({ commodities: result.rows.map(rowToCommodity) });
  });

  router.post("/commodities", async (req: Request, res: Response) => {
    const body = req.body as Partial<CommodityProfile>;
    if (!body.productName || !body.htsCode || !body.countryOfOrigin) {
      return res.status(400).json({ error: "productName, htsCode, and countryOfOrigin are required." });
    }

    const digitDepth = body.htsCode.replace(/\D/g, "").length;
    if (digitDepth < 6 || digitDepth > 10) {
      return res.status(422).json({ error: `HTS code "${body.htsCode}" must resolve to 6-10 digits (got ${digitDepth}).` });
    }

    const usmcaCountries = new Set(["US", "CA", "MX"]);
    const countryOfOrigin = body.countryOfOrigin.toUpperCase();
    const usmcaEligible = usmcaCountries.has(countryOfOrigin) && digitDepth >= 8;

    const result = await pool.query(
      `INSERT INTO commodities (
        org_id, product_name, description, hts_code, country_of_origin, usmca_eligible,
        is_hazmat, hazmat_un_number, hazmat_hazard_class, hazmat_packing_group, hazmat_sds_on_file, preferred_poe
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        DEMO_ORG_ID,
        body.productName,
        body.description ?? null,
        body.htsCode,
        countryOfOrigin,
        usmcaEligible,
        body.isHazmat ?? false,
        body.hazmat?.unNumber ?? null,
        body.hazmat?.hazardClass ?? null,
        body.hazmat?.packingGroup ?? null,
        body.hazmat?.sdsOnFile ?? false,
        body.preferredPoe ?? null,
      ],
    );

    return res.status(201).json(rowToCommodity(result.rows[0]));
  });

  router.get("/alert-preferences", async (_req: Request, res: Response) => {
    const result = await pool.query("SELECT role, channels FROM alert_preferences WHERE org_id = $1", [DEMO_ORG_ID]);
    const alertPreferences: AlertPreference[] = result.rows.map((r) => ({ role: r.role, channels: r.channels }));
    res.status(200).json({ alertPreferences });
  });

  router.put("/alert-preferences", async (req: Request, res: Response) => {
    const body = req.body as { alertPreferences?: AlertPreference[] };
    if (!Array.isArray(body.alertPreferences)) {
      return res.status(400).json({ error: "alertPreferences must be an array." });
    }

    await pool.query("DELETE FROM alert_preferences WHERE org_id = $1", [DEMO_ORG_ID]);
    for (const pref of body.alertPreferences) {
      await pool.query("INSERT INTO alert_preferences (org_id, role, channels) VALUES ($1, $2, $3)", [DEMO_ORG_ID, pref.role, pref.channels]);
    }

    return res.status(200).json({ alertPreferences: body.alertPreferences });
  });

  return router;
}
