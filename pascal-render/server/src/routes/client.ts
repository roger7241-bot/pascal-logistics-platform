// ============================================================================
// GET   /api/client/shipments — org-scoped shipment summaries with live
//       border wait time enrichment and server-computed progress tracker.
// GET   /api/client/shipments/:id
// PATCH /api/client/shipments/:id/override-paps
// PATCH /api/client/shipments/:id/reroute
// POST  /api/client/shipments/:id/request-vault-upload
// POST  /api/client/shipments/:id/escalate
// POST  /api/client/shipments/batch-sms
//
// HONEST LIMITATION: shipment records below stand in for a real database
// query — wire this to the DATABASE_URL-provisioned store once it exists.
// In-memory means mutations don't survive a server restart, but within a
// running process every action below is genuinely real: it mutates real
// state, broadcasts a real WebSocket update, writes a real activity log
// row, and (for vault requests / batch SMS) calls the real
// AgentMail/Twilio modules already verified elsewhere in this platform.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { getTrackerState } from "../services/progressTracker.js";
import { logActivity } from "../services/activityLog.js";
import { sendOperationalEmail } from "../services/agentMailDispatch.js";
import { sendDriverSms } from "../services/twilioMessaging.js";
import { getPriority1LtlRates, type Priority1LineItem } from "../services/priority1.js";
import { getFxRates, convertFromUsd } from "../services/fxRates.js";
import { pool } from "../db/pool.js";
import type { ClientShipmentSummary } from "../types/shipment.js";
import type { WsManager } from "../ws/wsManager.js";
import type { BorderTelemetryService } from "../services/borderTelemetryService.js";

export interface ExtendedShipment extends ClientShipmentSummary {
  poeId?: string;
  orgId?: string; // real filter key — clientOrg above is just the display name
  clientOrg?: string;
  etaIso?: string;
  equipmentType?: string;
  carrierName?: string;
  commercialInvoiceValueUsd?: number;
  reeferSetpointF?: number;
  aiRationale?: string;
  /** Relative to Canada, matching Pascal's BC/WA corridor base — genuinely
   * set per shipment below, not inferred at runtime from the free-text
   * lane string (which would be a fragile heuristic). A real future
   * booking-driven pipeline would set this from the shipper/consignee
   * country codes captured at intake time. */
  direction?: "inbound" | "outbound";
  /** For manually looking a shipment up on the carrier's own tracking
   * page — no carrier accounts/API relationships exist yet (per Roger),
   * so this is what an agent actually needs to go plug into the
   * carrier's website themselves. */
  bolNumber?: string;
  proNumber?: string;
}

export const SAMPLE_SHIPMENTS: ExtendedShipment[] = [
  {
    id: "SHIP-2026-8801",
    transportMode: "road",
    currentMilestone: "poe_inspection",
    statusChip: "customs_hold_flagged",
    lane: "Surrey, BC -> Blaine, WA",
    direction: "outbound",
    bolNumber: "BOL-88014471",
    proNumber: "0774125869",
    updatedAtIso: new Date(Date.now() - 12 * 60_000).toISOString(),
    driverName: "Mike Tran",
    driverPhone: "+16045551234",
    htsCode: "3808.91.5010",
    poeId: "pacific_highway",
    orgId: "org_meridian",
    clientOrg: "Meridian Cold Chain",
    etaIso: new Date(Date.now() + 90 * 60_000).toISOString(),
    equipmentType: "Reefer 53ft",
    carrierName: "ODFL",
    commercialInvoiceValueUsd: 20000,
    reeferSetpointF: 34,
    aiRationale: "EPA PGA hold — UN 3082 hazmat verification required before PAPS release.",
    linkedDocuments: [
      { filename: "commercial_invoice.pdf", category: "Commercial Invoice" },
      { filename: "SDS_downhole_tool.pdf", category: "Safety Data Sheet" },
    ],
  },
  {
    id: "SHIP-2026-0774",
    transportMode: "road",
    currentMilestone: "paps_pars_release",
    statusChip: "paps_pars_released",
    lane: "Abbotsford, BC -> Everett, WA",
    direction: "outbound",
    bolNumber: "BOL-07740219",
    proNumber: "5521098734",
    updatedAtIso: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    driverName: "Sarah Kim",
    driverPhone: "+14255559876",
    poeId: "sumas",
    orgId: "org_meridian",
    clientOrg: "Meridian Cold Chain",
    etaIso: new Date(Date.now() + 30 * 60_000).toISOString(),
    equipmentType: "Dry Van 53ft",
    carrierName: "FedEx Freight",
    commercialInvoiceValueUsd: 8400,
    linkedDocuments: [{ filename: "bol_0774.pdf", category: "Bill of Lading" }],
  },
  {
    id: "SHIP-2026-4402",
    transportMode: "road",
    currentMilestone: "export_manifest",
    statusChip: "in_transit",
    lane: "Langley, BC -> Lynden, WA",
    direction: "outbound",
    bolNumber: "BOL-44025587",
    proNumber: "3390871245",
    updatedAtIso: new Date(Date.now() - 25 * 60_000).toISOString(),
    driverName: "Devon Clarke",
    driverPhone: "+16045557788",
    htsCode: "8471.30.0100",
    poeId: "aldergrove",
    orgId: "org_firetech",
    clientOrg: "Firetech Manufacturing",
    etaIso: new Date(Date.now() + 55 * 60_000).toISOString(),
    equipmentType: "Dry Van 48ft",
    carrierName: "Maersk",
    commercialInvoiceValueUsd: 14250,
    linkedDocuments: [{ filename: "commercial_invoice_4402.pdf", category: "Commercial Invoice" }],
  },
  {
    id: "SHIP-2026-OCE-014",
    transportMode: "ocean",
    currentMilestone: "vessel_departure",
    statusChip: "vessel_en_route",
    lane: "Shanghai -> Vancouver",
    direction: "inbound",
    orgId: "org_meridian",
    clientOrg: "Meridian Cold Chain",
    bolNumber: "MSCUBN4471902",
    updatedAtIso: new Date(Date.now() - 6 * 3_600_000).toISOString(),
    vesselName: "MSC Aurora",
    equipmentType: "FCL 40ft HC",
    carrierName: "Maersk",
    commercialInvoiceValueUsd: 62000,
    linkedDocuments: [
      { filename: "commercial_invoice_oce014.pdf", category: "Commercial Invoice" },
      { filename: "usmca_certificate_oce014.pdf", category: "USMCA Certificate" },
    ],
  },
  {
    id: "SHIP-2026-AIR-002",
    transportMode: "air",
    currentMilestone: "flight_departure",
    statusChip: "flight_departed",
    lane: "YVR -> LHR",
    direction: "outbound",
    orgId: "org_firetech",
    clientOrg: "Firetech Manufacturing",
    bolNumber: "014-88750219",
    updatedAtIso: new Date(Date.now() - 45 * 60_000).toISOString(),
    flightNumber: "AC854",
    equipmentType: "Standard Air",
    commercialInvoiceValueUsd: 31500,
    linkedDocuments: [{ filename: "air_waybill_002.pdf", category: "Air Waybill" }],
  },
];

// The unified 5-stage dispatch bar this Operations Queue overhaul asks
// for (Booked -> Dispatch -> Border/POE -> Clearance -> Delivered) maps
// 1:1 onto the existing road milestone sequence rather than duplicating a
// second tracker system — same real computation, relabeled for this view.
const DISPATCH_STAGE_LABELS = ["Booked", "Dispatch", "Border/POE", "Clearance", "Delivered"];

function findShipment(id: string) {
  return SAMPLE_SHIPMENTS.find((s) => s.id === id);
}

export function createClientRouter(wsManager: WsManager, telemetryService: BorderTelemetryService): Router {
  const router = Router();

  // Track by BOL# or PRO# — no carrier accounts/API relationships exist
  // yet, so this is what an agent actually needs on hand to go plug into
  // the carrier's own website manually. Matches either field, partial and
  // case-insensitive so an agent doesn't need the exact "BOL-" prefix.
  // `type` scopes the search to a specific number field — "pro" | "bol" |
  // omitted (searches both). Structured as a discrete field-type param
  // rather than a single free-text search so adding more number types
  // later (ocean B/L is currently stored in the same bolNumber field, but
  // a real air AWB or container # would just be another case here) is a
  // dropdown addition, not a schema rework.
  router.get("/shipments/search", (req: Request, res: Response) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim().toLowerCase() : "";
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    if (!query) return res.status(200).json({ results: [] });

    const results = SAMPLE_SHIPMENTS.filter((s) => {
      const bolMatch = s.bolNumber?.toLowerCase().includes(query);
      const proMatch = s.proNumber?.toLowerCase().includes(query);
      if (type === "bol") return Boolean(bolMatch);
      if (type === "pro") return Boolean(proMatch);
      return Boolean(bolMatch || proMatch);
    }).map((s) => ({
      id: s.id,
      clientOrg: s.clientOrg,
      lane: s.lane,
      carrierName: s.carrierName,
      bolNumber: s.bolNumber,
      proNumber: s.proNumber,
      statusChip: s.statusChip,
    }));
    return res.status(200).json({ results });
  });

  router.get("/shipments", (req: Request, res: Response) => {
    const snapshot = telemetryService.getSnapshot();
    // Operators see every org's shipments (that's their job); a client
    // user only ever sees their own org's — derived from the verified
    // session, never trusted from a query param.
    const visibleShipments = req.authUser?.role === "client" ? SAMPLE_SHIPMENTS.filter((s) => s.orgId === req.authUser!.orgId) : SAMPLE_SHIPMENTS;
    const withTracker = visibleShipments.map((shipment) => {
      const tracker = getTrackerState(shipment.transportMode, shipment.currentMilestone);
      const liveWaitMinutes =
        shipment.transportMode === "road" && shipment.poeId
          ? snapshot.readings.find((r) => r.poeId === shipment.poeId && r.laneType === "commercial")?.waitMinutes
          : undefined;
      const dispatchStage = shipment.transportMode === "road" ? DISPATCH_STAGE_LABELS[tracker.currentIndex] : undefined;
      return { ...shipment, tracker, liveWaitMinutes, dispatchStage, dispatchStageLabels: shipment.transportMode === "road" ? DISPATCH_STAGE_LABELS : undefined };
    });
    res.status(200).json({ shipments: withTracker });
  });

  router.get("/shipments/:id", (req: Request, res: Response) => {
    const shipment = findShipment(req.params.id);
    if (!shipment) return res.status(404).json({ error: `No shipment on file with id ${req.params.id}.` });
    // A client user can't fetch another org's shipment by guessing/typing
    // an ID — 404 rather than 403, so the response doesn't even confirm
    // whether a given shipment ID exists for a different org.
    if (req.authUser?.role === "client" && shipment.orgId !== req.authUser.orgId) {
      return res.status(404).json({ error: `No shipment on file with id ${req.params.id}.` });
    }
    return res.status(200).json({ ...shipment, tracker: getTrackerState(shipment.transportMode, shipment.currentMilestone) });
  });

  // HONEST LIMITATION: removes the entry from the same in-memory
  // SAMPLE_SHIPMENTS array everything else in this file reads from — real
  // within this running process (the shipment genuinely disappears from
  // every other endpoint immediately), but doesn't survive a server
  // restart, same as every other mutation in this file.
  router.delete("/shipments/:id", async (req: Request, res: Response) => {
    const index = SAMPLE_SHIPMENTS.findIndex((s) => s.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: `No shipment on file with id ${req.params.id}.` });
    const [removed] = SAMPLE_SHIPMENTS.splice(index, 1);
    await logActivity("shipment_voided", `${removed.id} deleted/voided from Client Portal.`, removed.id);
    return res.status(200).json({ deleted: true, id: removed.id });
  });

  router.patch("/shipments/:id/override-paps", async (req: Request, res: Response) => {
    const shipment = findShipment(req.params.id);
    if (!shipment) return res.status(404).json({ error: `No shipment on file with id ${req.params.id}.` });

    shipment.statusChip = "paps_pars_released";
    shipment.currentMilestone = "paps_pars_release";
    shipment.updatedAtIso = new Date().toISOString();

    wsManager.broadcastShipmentStatusChange({ shipmentId: shipment.id, statusChip: shipment.statusChip, currentMilestone: shipment.currentMilestone, poeId: shipment.poeId });
    await logActivity("paps_released", `${shipment.id} PAPS manually overridden and re-filed by operator at ${shipment.poeId ?? "POE"}.`, shipment.id);

    return res.status(200).json({ ...shipment, tracker: getTrackerState(shipment.transportMode, shipment.currentMilestone) });
  });

  router.patch("/shipments/:id/reroute", async (req: Request, res: Response) => {
    const shipment = findShipment(req.params.id);
    if (!shipment) return res.status(404).json({ error: `No shipment on file with id ${req.params.id}.` });
    const { newPoeId } = req.body ?? {};
    if (!["pacific_highway", "sumas", "aldergrove"].includes(newPoeId)) {
      return res.status(400).json({ error: "newPoeId must be one of: pacific_highway, sumas, aldergrove." });
    }

    const fromPoeId = shipment.poeId;
    shipment.poeId = newPoeId;
    shipment.updatedAtIso = new Date().toISOString();

    wsManager.broadcastShipmentStatusChange({ shipmentId: shipment.id, statusChip: shipment.statusChip, currentMilestone: shipment.currentMilestone, poeId: shipment.poeId });
    await logActivity("reroute_triggered", `${shipment.id} manually re-routed from ${fromPoeId ?? "unknown"} to ${newPoeId} by operator.`, shipment.id);

    return res.status(200).json({ ...shipment, tracker: getTrackerState(shipment.transportMode, shipment.currentMilestone) });
  });

  router.post("/shipments/:id/request-vault-upload", async (req: Request, res: Response) => {
    const shipment = findShipment(req.params.id);
    if (!shipment) return res.status(404).json({ error: `No shipment on file with id ${req.params.id}.` });

    const clientEmail = typeof req.body?.clientEmail === "string" ? req.body.clientEmail : undefined;
    let emailResult = null;
    if (clientEmail) {
      emailResult = await sendOperationalEmail(
        clientEmail,
        `Document needed — ${shipment.id}`,
        `We need an updated document uploaded to the vault to proceed with ${shipment.id}. Please log in to the Client Portal to upload at your earliest convenience.\n\nPascal Logistics Operations`,
      );
    }
    await logActivity("shipment_ingested", `Vault upload requested from client for ${shipment.id}.`, shipment.id);
    return res.status(200).json({ requested: true, emailResult });
  });

  router.post("/shipments/:id/escalate", async (req: Request, res: Response) => {
    const shipment = findShipment(req.params.id);
    if (!shipment) return res.status(404).json({ error: `No shipment on file with id ${req.params.id}.` });

    const result = await pool.query(
      `INSERT INTO executive_drafts (shipment_id, draft_type, subject, body, rationale, status)
       VALUES ($1, 'shipment_approval', $2, $3, $4, 'pending') RETURNING *`,
      [shipment.id, `Operator escalation — ${shipment.id}`, `Escalated from Operations Queue for executive review.`, shipment.aiRationale ?? "Escalated by operator — no automated rationale on file."],
    );
    await logActivity("executive_decision", `${shipment.id} escalated to Agent 9 / Executive Review by operator.`, shipment.id);
    return res.status(201).json({ escalated: true, draftId: result.rows[0].id });
  });

  router.post("/shipments/batch-sms", async (req: Request, res: Response) => {
    const { shipmentIds, message } = req.body ?? {};
    if (!Array.isArray(shipmentIds) || shipmentIds.length === 0 || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "shipmentIds (non-empty array) and message are required." });
    }

    const results = [];
    for (const id of shipmentIds) {
      const shipment = findShipment(id);
      if (!shipment?.driverPhone) {
        results.push({ shipmentId: id, sent: false, reason: "No driver phone on file." });
        continue;
      }
      const smsResult = await sendDriverSms(shipment.driverPhone, message);
      results.push({ shipmentId: id, sent: smsResult.success, simulated: smsResult.simulated });
    }
    await logActivity("shipment_ingested", `Batch SMS sent to ${results.filter((r) => r.sent).length}/${shipmentIds.length} driver(s): "${message}"`);
    return res.status(200).json({ results });
  });

  // ==========================================================================
  // POST /api/client/quote-compare
  // Client-facing self-serve spot rate lookup — same backend as the operator
  // version, but scoped automatically to the authenticated client's orgId
  // (never trusts a body-supplied orgId). Operators calling this endpoint
  // get their own operator scope; only clients get org-locked. Logs every
  // comparison to activity_log so the operator side can see when a client
  // is shopping a lane.
  // ==========================================================================
  router.post("/quote-compare", async (req: Request, res: Response) => {
    const { originZip, destinationZip, pickupDateIso, items, mode, trailerType, displayCurrency } = req.body ?? {};
    const authOrgId = req.authUser?.orgId;
    const normalizedMode: "LTL" | "FTL" = mode === "FTL" ? "FTL" : "LTL";
    const normalizedCurrency: "USD" | "CAD" | "MXN" = displayCurrency === "CAD" || displayCurrency === "MXN" ? displayCurrency : "USD";

    if (!authOrgId) {
      return res.status(400).json({ error: "This account has no org on file — contact your Pascal Logistics operator." });
    }
    if (!originZip || !destinationZip || !pickupDateIso || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "originZip, destinationZip, pickupDateIso, and items[] are required." });
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
      getPriority1LtlRates({ originZipCode: originZip, destinationZipCode: destinationZip, pickupDate: pickupDateIso, items: normalizedItems, mode: normalizedMode, trailerType: typeof trailerType === "string" ? trailerType : undefined }),
      pool.query(
        `SELECT * FROM client_carrier_rates
          WHERE org_id = $1 AND origin_zip = $2 AND destination_zip = $3
          ORDER BY effective_date DESC
          LIMIT 1`,
        [authOrgId, originZip, destinationZip],
      ),
    ]);

    const incumbentRow = incumbentResult.rowCount ? incumbentResult.rows[0] : undefined;
    const incumbent = incumbentRow ? {
      id: incumbentRow.id as string,
      carrierName: incumbentRow.carrier_name as string,
      serviceLevel: (incumbentRow.service_level as string) ?? undefined,
      transitDays: incumbentRow.transit_days !== null ? Number(incumbentRow.transit_days) : undefined,
      totalRateUsd: Number(incumbentRow.total_rate_usd),
      effectiveDateIso: incumbentRow.effective_date ? (incumbentRow.effective_date as Date).toISOString().split("T")[0] : undefined,
      rateSource: incumbentRow.rate_source as string,
    } : undefined;
    const incumbentRate = incumbent?.totalRateUsd;

    const compared = p1Response.quotes.map((q) => {
      const savingsUsd = incumbentRate !== undefined ? incumbentRate - q.totalUsd : undefined;
      const savingsPct = incumbentRate !== undefined && incumbentRate > 0 ? (savingsUsd! / incumbentRate) * 100 : undefined;
      return { ...q, savingsVsIncumbentUsd: savingsUsd, savingsVsIncumbentPct: savingsPct };
    });
    compared.sort((a, b) => a.totalUsd - b.totalUsd);

    // FX conversion for non-USD displays. USD stays authoritative in
    // `*Usd` fields for internal math; display values are separate.
    let fxRate = 1;
    if (normalizedCurrency !== "USD") {
      const fx = await getFxRates();
      fxRate = fx.rates[normalizedCurrency];
    }
    const displayQuotes = compared.map((q) => ({
      ...q,
      totalDisplay: Math.round(q.totalUsd * fxRate * 100) / 100,
      savingsVsIncumbentDisplay: q.savingsVsIncumbentUsd !== undefined ? Math.round(q.savingsVsIncumbentUsd * fxRate * 100) / 100 : undefined,
    }));
    const displayIncumbent = incumbent ? { ...incumbent, totalRateDisplay: Math.round(incumbent.totalRateUsd * fxRate * 100) / 100 } : undefined;

    // Signal to the operator side: this client just shopped a lane.
    const bestSavings = compared.length && incumbentRate !== undefined
      ? Math.max(0, ...compared.map((q) => q.savingsVsIncumbentUsd ?? 0))
      : undefined;
    await logActivity(
      "spot_quote_viewed",
      `${req.authUser?.email ?? "client"} ran a spot quote: ${originZip} → ${destinationZip}${bestSavings !== undefined ? ` · best save $${bestSavings.toFixed(0)}` : " · no incumbent on file"}`,
      undefined,
      { orgId: authOrgId, originZip, destinationZip, quoteCount: compared.length, demo: Boolean(p1Response.demo) },
    );

    return res.status(200).json({
      incumbent: displayIncumbent,
      quotes: displayQuotes,
      mode: normalizedMode,
      displayCurrency: normalizedCurrency,
      fxRate,
      priority1Simulated: p1Response.simulated,
      priority1Demo: Boolean(p1Response.demo),
      priority1Error: p1Response.error,
    });
  });

  // ==========================================================================
  // BOOKING REQUESTS — client clicks "Request booking" on a comparison row.
  // Doesn't book anything; it queues a request for the operator to confirm
  // capacity, PARS/PAPS, DG, etc. Auto-scoped to the caller's orgId.
  // ==========================================================================
  router.post("/booking-requests", async (req: Request, res: Response) => {
    const { carrierName, serviceLevel, mode, originZip, destinationZip, pickupDateIso, totalUsd, transitDays, metadata } = req.body ?? {};
    const authOrgId = req.authUser?.orgId;
    if (!authOrgId) return res.status(400).json({ error: "This account has no org on file — contact your Pascal Logistics operator." });
    if (!carrierName || !originZip || !destinationZip || !pickupDateIso || totalUsd === undefined) {
      return res.status(400).json({ error: "carrierName, originZip, destinationZip, pickupDateIso, totalUsd are required." });
    }
    const normalizedMode = mode === "FTL" ? "FTL" : "LTL";
    const result = await pool.query(
      `INSERT INTO booking_requests
        (org_id, requested_by_email, carrier_name, service_level, mode, origin_zip, destination_zip, pickup_date_iso, total_usd, transit_days, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        authOrgId,
        req.authUser?.email ?? null,
        String(carrierName),
        serviceLevel ?? null,
        normalizedMode,
        String(originZip),
        String(destinationZip),
        pickupDateIso,
        Number(totalUsd),
        transitDays ?? null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    await logActivity(
      "shipment_ingested",
      `Booking request from ${req.authUser?.email ?? "client"}: ${carrierName} · ${originZip} → ${destinationZip} · $${Number(totalUsd).toFixed(0)} — awaiting operator confirmation`,
      undefined,
      { orgId: authOrgId, bookingRequestId: result.rows[0].id },
    );
    return res.status(201).json({ bookingRequest: result.rows[0] });
  });

  // ==========================================================================
  // CLIENT PROFILE — returns the account + shipping-profile capabilities
  // for the authenticated client. Used by the Client Portal to gate which
  // widgets render (cross-border only, etc.).
  // ==========================================================================
  router.get("/profile", async (req: Request, res: Response) => {
    const authOrgId = req.authUser?.orgId;
    if (!authOrgId) return res.status(400).json({ error: "This account has no org on file." });
    const result = await pool.query(
      "SELECT id, org_id, company_name, retainer_tier, client_capabilities, billing_currency FROM accounts WHERE org_id = $1",
      [authOrgId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Account not found for this org." });
    const row = result.rows[0];
    return res.status(200).json({
      profile: {
        id: row.id,
        orgId: row.org_id,
        companyName: row.company_name,
        retainerTier: row.retainer_tier,
        billingCurrency: row.billing_currency,
        clientCapabilities: row.client_capabilities ?? {},
      },
    });
  });

  // ==========================================================================
  // TARIFF UPDATES — filtered to the client's tracked HS codes when their
  // capabilities have any, otherwise returns the most recent regardless.
  // Feeds the client-facing Tariff Watch widget. Cross-border only —
  // callers should already have gated on client_capabilities.
  // ==========================================================================
  router.get("/tariff-updates", async (req: Request, res: Response) => {
    const authOrgId = req.authUser?.orgId;
    if (!authOrgId) return res.status(400).json({ error: "This account has no org on file." });

    const capResult = await pool.query("SELECT client_capabilities FROM accounts WHERE org_id = $1", [authOrgId]);
    const caps = capResult.rowCount ? (capResult.rows[0].client_capabilities ?? {}) : {};
    const tracked: string[] = Array.isArray(caps.trackedHsCodes) ? caps.trackedHsCodes : [];
    const limit = Math.min(Number(req.query.limit) || 12, 50);

    // Filter by tracked codes when the client set them; otherwise return
    // the freshest updates so a newly-onboarded client still sees the
    // Tariff Watch widget populated. Match at the chapter level (first 4
    // digits) so "8703" matches "8703.23" too.
    const params: unknown[] = [limit];
    let where = "";
    if (tracked.length > 0) {
      const chapters = tracked.map((c) => c.replace(/[^0-9.]/g, "").slice(0, 4)).filter(Boolean);
      if (chapters.length > 0) {
        params.push(chapters.map((c) => `${c}%`));
        where = `WHERE hs_code LIKE ANY($2::text[])`;
      }
    }
    const result = await pool.query(
      `SELECT id, hs_code, hs_description, direction, mechanism, headline, summary, old_rate, new_rate, rate_delta_pct, effective_date, source_url, severity, published_at
       FROM tariff_updates ${where} ORDER BY published_at DESC LIMIT $1`,
      params,
    );
    return res.status(200).json({ tariffUpdates: result.rows, trackedHsCodes: tracked });
  });

  // ==========================================================================
  // PORTAL SUMMARY — aggregated widget payload for the client dashboard:
  // ops brief cadence, POA/USMCA documents current, carrier scorecard.
  // Everything scoped to req.authUser.orgId; no orgId ever accepted from
  // the request.
  // ==========================================================================
  router.get("/portal-summary", async (req: Request, res: Response) => {
    const authOrgId = req.authUser?.orgId;
    if (!authOrgId) return res.status(400).json({ error: "This account has no org on file." });

    const [poaResult, usmcaResult, expiringDocs, carrierResult] = await Promise.all([
      pool.query("SELECT status, updated_at FROM poa_records WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1", [authOrgId]),
      pool.query("SELECT COUNT(*) AS count, MAX(expires_at) AS next_expiry FROM vault_documents WHERE org_id = $1 AND category = 'usmca_certificate'", [authOrgId]),
      pool.query("SELECT COUNT(*) AS count FROM vault_documents WHERE org_id = $1 AND expires_at IS NOT NULL AND expires_at < now() + INTERVAL '30 days'", [authOrgId]),
      pool.query(
        `SELECT carrier_name, integration_status, on_time_pct, claims_rate_pct
         FROM carrier_accounts WHERE org_id = $1
         ORDER BY on_time_pct DESC NULLS LAST LIMIT 5`,
        [authOrgId],
      ),
    ]);

    // Compute next scheduled ops brief — Monday 07:00 in America/Los_Angeles.
    const now = new Date();
    const nextMonday = new Date(now);
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(7, 0, 0, 0);

    return res.status(200).json({
      opsBrief: {
        cadence: "weekly",
        deliveryTime: "07:00 PT Monday",
        nextIso: nextMonday.toISOString(),
      },
      documentsCurrent: {
        poaStatus: poaResult.rows[0]?.status ?? "pending_upload",
        poaRefreshedAt: poaResult.rows[0]?.updated_at ?? null,
        usmcaCertCount: Number(usmcaResult.rows[0]?.count ?? 0),
        usmcaNextExpiry: usmcaResult.rows[0]?.next_expiry ?? null,
        expiringSoonCount: Number(expiringDocs.rows[0]?.count ?? 0),
      },
      carrierScorecard: carrierResult.rows.map((r) => ({
        carrierName: r.carrier_name,
        integrationStatus: r.integration_status,
        onTimePct: r.on_time_pct !== null ? Number(r.on_time_pct) : undefined,
        claimsRatePct: r.claims_rate_pct !== null ? Number(r.claims_rate_pct) : undefined,
      })),
    });
  });

  return router;
}
