// ============================================================================
// GET    /api/operator/facilities                — full directory, all orgs
// POST   /api/operator/facilities                 — direct operator entry
// PATCH  /api/operator/facilities/:id              — edit
// PATCH  /api/operator/facilities/:id/archive       — soft-archive
// GET    /api/operator/facilities/:id/bound-shipments
// POST   /api/operator/facilities/:id/send-staging-sms
//
// Real Postgres-backed CRUD for the Facility Management & Warehouse Rules
// Hub — operators can add/edit/archive SOPs directly from the Control
// Tower without waiting on Client Portal onboarding (the original
// /api/client/facilities router stays as-is for that client-side flow).
//
// HONEST LIMITATION: "bound shipments" match by comparing the facility's
// city against the destination city parsed out of each shipment's `lane`
// string (e.g. "Surrey, BC -> Blaine, WA"). Shipments don't carry a
// facilityId foreign key today (see routes/client.ts's own in-memory
// limitation note) — this is a genuine text-match against real sample
// data, not a fabricated placeholder, but it's a heuristic, not a
// relational join.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { sendDriverSms } from "../services/twilioMessaging.js";
import { SAMPLE_SHIPMENTS } from "./client.js";
import type { BoundShipmentSummary, FacilityCapability, FacilityProfile, FacilityUpsertPayload } from "../types/facility.js";

const ALLOWED_CAPABILITIES: FacilityCapability[] = ["cold_storage", "cross_dock", "hazmat_approved", "overhead_crane"];

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
    capabilities: (row.capabilities as FacilityCapability[]) ?? [],
    isArchived: row.is_archived as boolean,
    addedBy: row.added_by as FacilityProfile["addedBy"],
    createdAtIso: row.created_at ? new Date(row.created_at as string).toISOString() : undefined,
  };
}

function sanitizeCapabilities(input: unknown): FacilityCapability[] {
  if (!Array.isArray(input)) return [];
  return input.filter((c): c is FacilityCapability => ALLOWED_CAPABILITIES.includes(c as FacilityCapability));
}

/** Pulls the destination city out of a "City, ST -> City, ST" lane string. */
function destinationCity(lane: string): string | undefined {
  const parts = lane.split("->");
  const dest = parts[1] ?? parts[0];
  return dest?.split(",")[0]?.trim().toLowerCase();
}

export function createOperatorFacilitiesRouter(): Router {
  const router = Router();

  router.get("/facilities", async (req: Request, res: Response) => {
    const includeArchived = req.query.includeArchived === "true";
    const result = await pool.query(
      includeArchived ? "SELECT * FROM facilities ORDER BY created_at DESC" : "SELECT * FROM facilities WHERE is_archived = false ORDER BY created_at DESC",
    );
    res.status(200).json({ facilities: result.rows.map(rowToFacility) });
  });

  router.post("/facilities", async (req: Request, res: Response) => {
    const body = req.body as Partial<FacilityUpsertPayload>;
    if (!body.orgId || !body.name || !body.street || !body.city || !body.countryCode) {
      return res.status(400).json({ error: "orgId, name, street, city, and countryCode are required." });
    }

    const result = await pool.query(
      `INSERT INTO facilities (
        org_id, role, name, street, city, state_or_province, country_code, postal_code,
        dock_contact_name, dock_contact_phone, receiving_email,
        liftgate_required, max_trailer_length, iso_container_capable, dock_door_count, scale_on_site,
        receiving_hours_start, receiving_hours_end, break_window,
        hard_hat_required, steel_toe_required, twic_card_required,
        driver_staging_notes, staging_map_url,
        free_time_minutes, detention_rate_usd_per_hour, capabilities, added_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'operator')
      RETURNING *`,
      [
        body.orgId,
        body.role ?? "both",
        body.name,
        body.street,
        body.city,
        body.stateOrProvince ?? "",
        body.countryCode,
        body.postalCode ?? "",
        body.dockContactName ?? null,
        body.dockContactPhone ?? null,
        body.receivingEmail ?? null,
        body.liftgateRequired ?? false,
        body.maxTrailerLength ?? "53ft",
        body.isoContainerCapable ?? false,
        body.dockDoorCount ?? null,
        body.scaleOnSite ?? false,
        body.receivingHoursStart ?? "08:00",
        body.receivingHoursEnd ?? "16:00",
        body.breakWindow ?? null,
        body.hardHatRequired ?? false,
        body.steelToeRequired ?? false,
        body.twicCardRequired ?? false,
        body.driverStagingNotes ?? null,
        body.stagingMapUrl ?? null,
        body.freeTimeMinutes ?? 120,
        body.detentionRateUsdPerHour ?? 75.0,
        sanitizeCapabilities(body.capabilities),
      ],
    );

    return res.status(201).json(rowToFacility(result.rows[0]));
  });

  router.patch("/facilities/:id", async (req: Request, res: Response) => {
    const body = req.body as Partial<FacilityUpsertPayload>;
    const existing = await pool.query("SELECT * FROM facilities WHERE id = $1", [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Facility not found." });
    const current = rowToFacility(existing.rows[0]);

    const result = await pool.query(
      `UPDATE facilities SET
        name = $1, street = $2, city = $3, state_or_province = $4, country_code = $5, postal_code = $6,
        dock_contact_name = $7, dock_contact_phone = $8, receiving_email = $9,
        liftgate_required = $10, max_trailer_length = $11, iso_container_capable = $12, dock_door_count = $13, scale_on_site = $14,
        receiving_hours_start = $15, receiving_hours_end = $16, break_window = $17,
        hard_hat_required = $18, steel_toe_required = $19, twic_card_required = $20,
        driver_staging_notes = $21, staging_map_url = $22,
        free_time_minutes = $23, detention_rate_usd_per_hour = $24, capabilities = $25
      WHERE id = $26
      RETURNING *`,
      [
        body.name ?? current.name,
        body.street ?? current.street,
        body.city ?? current.city,
        body.stateOrProvince ?? current.stateOrProvince,
        body.countryCode ?? current.countryCode,
        body.postalCode ?? current.postalCode,
        body.dockContactName ?? current.dockContactName ?? null,
        body.dockContactPhone ?? current.dockContactPhone ?? null,
        body.receivingEmail ?? current.receivingEmail ?? null,
        body.liftgateRequired ?? current.liftgateRequired,
        body.maxTrailerLength ?? current.maxTrailerLength,
        body.isoContainerCapable ?? current.isoContainerCapable,
        body.dockDoorCount ?? current.dockDoorCount ?? null,
        body.scaleOnSite ?? current.scaleOnSite,
        body.receivingHoursStart ?? current.receivingHoursStart,
        body.receivingHoursEnd ?? current.receivingHoursEnd,
        body.breakWindow ?? current.breakWindow ?? null,
        body.hardHatRequired ?? current.hardHatRequired,
        body.steelToeRequired ?? current.steelToeRequired,
        body.twicCardRequired ?? current.twicCardRequired,
        body.driverStagingNotes ?? current.driverStagingNotes ?? null,
        body.stagingMapUrl ?? current.stagingMapUrl ?? null,
        body.freeTimeMinutes ?? current.freeTimeMinutes,
        body.detentionRateUsdPerHour ?? current.detentionRateUsdPerHour,
        body.capabilities ? sanitizeCapabilities(body.capabilities) : current.capabilities,
        req.params.id,
      ],
    );

    return res.status(200).json(rowToFacility(result.rows[0]));
  });

  router.patch("/facilities/:id/archive", async (req: Request, res: Response) => {
    const archived = req.body?.archived !== false; // default true
    const result = await pool.query("UPDATE facilities SET is_archived = $1 WHERE id = $2 RETURNING *", [archived, req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Facility not found." });
    return res.status(200).json(rowToFacility(result.rows[0]));
  });

  router.get("/facilities/:id/bound-shipments", async (req: Request, res: Response) => {
    const facilityResult = await pool.query("SELECT city FROM facilities WHERE id = $1", [req.params.id]);
    if (facilityResult.rowCount === 0) return res.status(404).json({ error: "Facility not found." });
    const facilityCity = (facilityResult.rows[0].city as string).toLowerCase();

    const boundShipments: BoundShipmentSummary[] = SAMPLE_SHIPMENTS.filter((s) => destinationCity(s.lane) === facilityCity).map((s) => ({
      id: s.id,
      lane: s.lane,
      statusChip: s.statusChip,
      driverName: s.driverName,
      driverPhone: s.driverPhone,
      etaIso: s.etaIso,
      carrierName: s.carrierName,
    }));

    return res.status(200).json({ boundShipments, matchMethod: "lane_city_text_match" });
  });

  router.post("/facilities/:id/send-staging-sms", async (req: Request, res: Response) => {
    const { driverPhone, driverName, shipmentId } = req.body as { driverPhone?: string; driverName?: string; shipmentId?: string };
    if (!driverPhone) return res.status(400).json({ error: "driverPhone is required." });

    const facilityResult = await pool.query("SELECT * FROM facilities WHERE id = $1", [req.params.id]);
    if (facilityResult.rowCount === 0) return res.status(404).json({ error: "Facility not found." });
    const facility = rowToFacility(facilityResult.rows[0]);

    const messageParts = [
      `Staging instructions — ${facility.name}, ${facility.city}:`,
      facility.driverStagingNotes || `Check in at reception, dock hours ${facility.receivingHoursStart}-${facility.receivingHoursEnd}.`,
      facility.stagingMapUrl ? `Map: ${facility.stagingMapUrl}` : undefined,
    ].filter(Boolean);
    const body = messageParts.join(" ");

    const dispatch = await sendDriverSms(driverPhone, body);
    return res.status(dispatch.success ? 200 : 502).json({ ...dispatch, sentTo: driverPhone, driverName, shipmentId, message: body });
  });

  return router;
}
