// ============================================================================
// GET /api/v1/track/:shipmentId — PUBLIC, no auth, deliberately minimal.
// Mirrors the vault magic-upload router's mount pattern (outside
// /api/client and /api/operator entirely) since this is meant to be
// reachable by anyone with a tracking link — no driver phone, no carrier
// account numbers, no client org name, no internal notes.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { SAMPLE_SHIPMENTS } from "./client.js";
import type { RoadMilestone, OceanMilestone, AirMilestone, TransportMode } from "../types/shipment.js";
import type { PublicTrackingPayload } from "../types/cx.js";

// Real order from the type declarations in types/shipment.ts — not invented.
const MILESTONE_SEQUENCE: Record<TransportMode, string[]> = {
  road: ["pickup", "export_manifest", "poe_inspection", "paps_pars_release", "delivery"] satisfies RoadMilestone[],
  ocean: ["container_loaded", "port_origin_gate_in", "vessel_departure", "transshipment", "port_destination_arrival", "customs_clearance", "drayage_delivery"] satisfies OceanMilestone[],
  air: ["acceptance_at_terminal", "customs_export_release", "flight_departure", "import_airport_arrival", "pga_customs_clearance", "final_mile_delivery"] satisfies AirMilestone[],
};

const STATUS_LABEL: Record<string, string> = {
  paps_pars_released: "Cleared for Border Crossing",
  customs_hold_flagged: "Held at Customs",
  vessel_en_route: "Vessel En Route",
  flight_departed: "Flight Departed",
  in_transit: "In Transit",
  delivered: "Delivered",
};

export function createPublicTrackingRouter(): Router {
  const router = Router();

  router.get("/:shipmentId", (req: Request, res: Response) => {
    const shipment = SAMPLE_SHIPMENTS.find((s) => s.id === req.params.shipmentId);
    if (!shipment) return res.status(404).json({ error: "No shipment found for that tracking number." });

    const payload: PublicTrackingPayload = {
      shipmentId: shipment.id,
      lane: shipment.lane,
      currentMilestone: shipment.currentMilestone,
      milestoneSequence: MILESTONE_SEQUENCE[shipment.transportMode],
      statusLabel: STATUS_LABEL[shipment.statusChip] ?? shipment.statusChip,
      etaIso: shipment.etaIso,
      carrierName: shipment.carrierName,
      lastUpdatedIso: shipment.updatedAtIso,
    };

    return res.status(200).json(payload);
  });

  return router;
}
