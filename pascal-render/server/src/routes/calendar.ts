// ============================================================================
// GET   /api/calendar/events                     — org-scoped or full list
// POST  /api/calendar/events                      — schedule a new event
// GET   /api/calendar/events/:id/shipment          — direct shipment/driver lookup by event
// PATCH /api/calendar/events/:id/reschedule        — move start/end time
// PATCH /api/calendar/events/:id/cancel             — cancel (soft, keeps history)
// POST  /api/calendar/events/:id/send-sms-alert     — real Twilio-backed driver alert
//
// Shared Logistics/Scheduling Hub — backs both the Operator desk #9 view
// and the Client Portal's calendar tab. One dataset, two UIs with
// different permissions (client is read-only + their own org; operator
// sees all and can reschedule/cancel/alert).
//
// HONEST LIMITATION: /events/:id/shipment and /send-sms-alert both resolve
// the driver by looking the event's shipmentId up directly against
// SAMPLE_SHIPMENTS (routes/client.ts) — a real, explicit ID match, but
// still against that in-memory sample set, not a persisted shipments
// table. Reminder thresholds/channels (15m/1h/24h, email/sms) are
// captured and persisted on the event but nothing currently fires them —
// there's no cron job wired up yet (see cronPoll.ts for the existing
// pattern this would follow once shipments are persisted).
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { sendDriverSms } from "../services/twilioMessaging.js";
import { SAMPLE_SHIPMENTS } from "./client.js";
import type { CalendarEvent, CalendarEventUpsertPayload } from "../types/calendar.js";

const VALID_CATEGORIES = ["dock_appointment", "ocean_demurrage", "border_clearance", "discovery_call", "other"];
const VALID_TIMEZONES = ["America/Los_Angeles", "America/New_York", "UTC"];
const VALID_REMINDER_THRESHOLDS = ["15m", "1h", "24h"];
const VALID_REMINDER_CHANNELS = ["email", "sms"];

function rowToEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    title: row.title as string,
    eventType: row.event_type as CalendarEvent["eventType"],
    startsAtIso: (row.starts_at as Date).toISOString(),
    endsAtIso: row.ends_at ? (row.ends_at as Date).toISOString() : undefined,
    shipmentId: (row.shipment_id as string) ?? undefined,
    poeId: (row.poe_id as CalendarEvent["poeId"]) ?? undefined,
    facilityId: (row.facility_id as string) ?? undefined,
    timezone: row.timezone as CalendarEvent["timezone"],
    reminderThresholds: (row.reminder_thresholds as CalendarEvent["reminderThresholds"]) ?? [],
    reminderChannels: (row.reminder_channels as CalendarEvent["reminderChannels"]) ?? [],
    status: row.status as CalendarEvent["status"],
    notes: (row.notes as string) ?? undefined,
    createdAtIso: row.created_at ? new Date(row.created_at as string).toISOString() : undefined,
  };
}

export function createCalendarRouter(): Router {
  const router = Router();

  router.get("/events", async (req: Request, res: Response) => {
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const result = orgId
      ? await pool.query("SELECT * FROM calendar_events WHERE org_id = $1 ORDER BY starts_at ASC", [orgId])
      : await pool.query("SELECT * FROM calendar_events ORDER BY starts_at ASC");
    res.status(200).json({ events: result.rows.map(rowToEvent) });
  });

  router.post("/events", async (req: Request, res: Response) => {
    const body = req.body as Partial<CalendarEventUpsertPayload>;
    if (!body.orgId || !body.title || !body.eventType || !VALID_CATEGORIES.includes(body.eventType) || !body.startsAtIso) {
      return res.status(400).json({ error: `orgId, title, startsAtIso, and a valid eventType (${VALID_CATEGORIES.join(", ")}) are required.` });
    }
    if (body.timezone && !VALID_TIMEZONES.includes(body.timezone)) {
      return res.status(400).json({ error: `timezone must be one of ${VALID_TIMEZONES.join(", ")}.` });
    }
    const reminderThresholds = (body.reminderThresholds ?? []).filter((t) => VALID_REMINDER_THRESHOLDS.includes(t));
    const reminderChannels = (body.reminderChannels ?? []).filter((c) => VALID_REMINDER_CHANNELS.includes(c));

    const result = await pool.query(
      `INSERT INTO calendar_events (org_id, title, event_type, starts_at, ends_at, shipment_id, poe_id, facility_id, timezone, reminder_thresholds, reminder_channels, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        body.orgId,
        body.title,
        body.eventType,
        body.startsAtIso,
        body.endsAtIso ?? null,
        body.shipmentId ?? null,
        body.poeId ?? null,
        body.facilityId ?? null,
        body.timezone ?? "America/Los_Angeles",
        reminderThresholds,
        reminderChannels,
        body.notes ?? null,
      ],
    );
    return res.status(201).json(rowToEvent(result.rows[0]));
  });

  router.patch("/events/:id/reschedule", async (req: Request, res: Response) => {
    const { startsAtIso, endsAtIso } = req.body as { startsAtIso?: string; endsAtIso?: string };
    if (!startsAtIso) return res.status(400).json({ error: "startsAtIso is required." });

    const result = await pool.query(
      `UPDATE calendar_events SET starts_at = $1, ends_at = $2, status = 'rescheduled' WHERE id = $3 RETURNING *`,
      [startsAtIso, endsAtIso ?? null, req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Event not found." });
    return res.status(200).json(rowToEvent(result.rows[0]));
  });

  router.patch("/events/:id/cancel", async (req: Request, res: Response) => {
    const result = await pool.query(`UPDATE calendar_events SET status = 'cancelled' WHERE id = $1 RETURNING *`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Event not found." });
    return res.status(200).json(rowToEvent(result.rows[0]));
  });

  router.get("/events/:id/shipment", async (req: Request, res: Response) => {
    const eventResult = await pool.query("SELECT shipment_id FROM calendar_events WHERE id = $1", [req.params.id]);
    if (eventResult.rowCount === 0) return res.status(404).json({ error: "Event not found." });
    const shipmentId = eventResult.rows[0].shipment_id as string | null;
    if (!shipmentId) return res.status(200).json({ shipment: null });

    const shipment = SAMPLE_SHIPMENTS.find((s) => s.id === shipmentId);
    if (!shipment) return res.status(200).json({ shipment: null });

    return res.status(200).json({
      shipment: {
        id: shipment.id,
        lane: shipment.lane,
        statusChip: shipment.statusChip,
        driverName: shipment.driverName,
        driverPhone: shipment.driverPhone,
        carrierName: shipment.carrierName,
      },
    });
  });

  router.post("/events/:id/send-sms-alert", async (req: Request, res: Response) => {
    const eventResult = await pool.query("SELECT * FROM calendar_events WHERE id = $1", [req.params.id]);
    if (eventResult.rowCount === 0) return res.status(404).json({ error: "Event not found." });
    const event = rowToEvent(eventResult.rows[0]);

    const shipment = event.shipmentId ? SAMPLE_SHIPMENTS.find((s) => s.id === event.shipmentId) : undefined;
    const driverPhone = (req.body as { driverPhone?: string })?.driverPhone ?? shipment?.driverPhone;
    if (!driverPhone) {
      return res.status(400).json({ error: "No driver phone on file for this event's shipment, and none was provided in the request body." });
    }

    const localTime = new Date(event.startsAtIso).toLocaleString("en-US", { timeZone: event.timezone, hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
    const body = `${event.title} — ${localTime} (${event.timezone}). ${event.notes ?? ""}`.trim();

    const dispatch = await sendDriverSms(driverPhone, body);
    return res.status(dispatch.success ? 200 : 502).json({ ...dispatch, sentTo: driverPhone, eventId: event.id, message: body });
  });

  return router;
}
