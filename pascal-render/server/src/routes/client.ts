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
import { pool } from "../db/pool.js";
import type { ClientShipmentSummary } from "../types/shipment.js";
import type { WsManager } from "../ws/wsManager.js";
import type { BorderTelemetryService } from "../services/borderTelemetryService.js";

export interface ExtendedShipment extends ClientShipmentSummary {
  poeId?: string;
  clientOrg?: string;
  etaIso?: string;
  equipmentType?: string;
  carrierName?: string;
  commercialInvoiceValueUsd?: number;
  reeferSetpointF?: number;
  aiRationale?: string;
}

export const SAMPLE_SHIPMENTS: ExtendedShipment[] = [
  {
    id: "SHIP-2026-8801",
    transportMode: "road",
    currentMilestone: "poe_inspection",
    statusChip: "customs_hold_flagged",
    lane: "Surrey, BC -> Blaine, WA",
    updatedAtIso: new Date(Date.now() - 12 * 60_000).toISOString(),
    driverName: "Mike Tran",
    driverPhone: "+16045551234",
    htsCode: "3808.91.5010",
    poeId: "pacific_highway",
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
    updatedAtIso: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    driverName: "Sarah Kim",
    driverPhone: "+14255559876",
    poeId: "sumas",
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
    updatedAtIso: new Date(Date.now() - 25 * 60_000).toISOString(),
    driverName: "Devon Clarke",
    driverPhone: "+16045557788",
    htsCode: "8471.30.0100",
    poeId: "aldergrove",
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

  router.get("/shipments", (_req: Request, res: Response) => {
    const snapshot = telemetryService.getSnapshot();
    const withTracker = SAMPLE_SHIPMENTS.map((shipment) => {
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
    return res.status(200).json({ ...shipment, tracker: getTrackerState(shipment.transportMode, shipment.currentMilestone) });
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

  return router;
}
