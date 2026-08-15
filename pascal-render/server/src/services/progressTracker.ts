// ============================================================================
// PROGRESS TRACKER
// Each transport mode has a genuinely different milestone sequence — not
// one generic tracker reused three times. Given a mode and current
// milestone, returns the ordered steps with the current position marked.
// ============================================================================

import type { AirMilestone, OceanMilestone, RailMilestone, RoadMilestone, ShipmentMilestone, TransportMode } from "../types/shipment.js";

export interface TrackerStep {
  milestone: ShipmentMilestone;
  label: string;
}

const ROAD_STEPS: { milestone: RoadMilestone; label: string }[] = [
  { milestone: "pickup", label: "Pickup" },
  { milestone: "export_manifest", label: "Export Manifest" },
  { milestone: "poe_inspection", label: "POE Inspection" },
  { milestone: "paps_pars_release", label: "PAPS/PARS Release" },
  { milestone: "delivery", label: "Delivery" },
];

const RAIL_STEPS: { milestone: RailMilestone; label: string }[] = [
  { milestone: "pickup", label: "Pickup" },
  { milestone: "rail_ramp_origin_gate_in", label: "Rail Ramp Origin Gate-In" },
  { milestone: "rail_transit", label: "Rail Transit" },
  { milestone: "rail_ramp_destination_arrival", label: "Rail Ramp Destination Arrival" },
  { milestone: "drayage_delivery", label: "Drayage Delivery" },
];

const OCEAN_STEPS: { milestone: OceanMilestone; label: string }[] = [
  { milestone: "container_loaded", label: "Container Loaded" },
  { milestone: "port_origin_gate_in", label: "Port Origin Gate-In" },
  { milestone: "vessel_departure", label: "Vessel Departure" },
  { milestone: "transshipment", label: "Transshipment" },
  { milestone: "port_destination_arrival", label: "Port Destination Arrival" },
  { milestone: "customs_clearance", label: "Customs Clearance" },
  { milestone: "drayage_delivery", label: "Drayage Delivery" },
];

const AIR_STEPS: { milestone: AirMilestone; label: string }[] = [
  { milestone: "acceptance_at_terminal", label: "Acceptance at Cargo Terminal" },
  { milestone: "customs_export_release", label: "Customs Export Release" },
  { milestone: "flight_departure", label: "Flight Departure" },
  { milestone: "import_airport_arrival", label: "Import Airport Arrival" },
  { milestone: "pga_customs_clearance", label: "PGA/Customs Clearance" },
  { milestone: "final_mile_delivery", label: "Final Mile Delivery" },
];

const STEPS_BY_MODE: Record<TransportMode, TrackerStep[]> = {
  road: ROAD_STEPS,
  rail: RAIL_STEPS,
  ocean: OCEAN_STEPS,
  air: AIR_STEPS,
};

export interface TrackerState {
  steps: TrackerStep[];
  currentIndex: number;
  percentComplete: number;
}

export function getTrackerState(mode: TransportMode, currentMilestone: ShipmentMilestone): TrackerState {
  const steps = STEPS_BY_MODE[mode];
  const currentIndex = steps.findIndex((s) => s.milestone === currentMilestone);

  if (currentIndex === -1) {
    throw new Error(`Milestone "${currentMilestone}" is not valid for transport mode "${mode}".`);
  }

  return {
    steps,
    currentIndex,
    percentComplete: Math.round((currentIndex / (steps.length - 1)) * 100),
  };
}
