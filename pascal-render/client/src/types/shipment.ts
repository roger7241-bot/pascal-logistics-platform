export type TransportMode = "road" | "rail" | "ocean" | "air";

export type StatusChip = "paps_pars_released" | "customs_hold_flagged" | "vessel_en_route" | "flight_departed" | "in_transit" | "delivered";

export interface TrackerStep {
  milestone: string;
  label: string;
}

export interface TrackerState {
  steps: TrackerStep[];
  currentIndex: number;
  percentComplete: number;
}

export interface LinkedDocument {
  filename: string;
  category: string;
  url?: string;
}

export interface ClientShipmentSummary {
  id: string;
  transportMode: TransportMode;
  currentMilestone: string;
  statusChip: StatusChip;
  lane: string;
  updatedAtIso: string;
  driverName?: string;
  driverPhone?: string;
  vesselName?: string;
  flightNumber?: string;
  htsCode?: string;
  linkedDocuments: LinkedDocument[];
  tracker: TrackerState;
}
