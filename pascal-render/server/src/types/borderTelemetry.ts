// ============================================================================
// BORDER TELEMETRY TYPES
// Full Lower Mainland corridor — bidirectional (Northbound into BC via CBSA,
// Southbound into WA via CBP), split by lane type (Commercial vs.
// Passenger/NEXUS).
// ============================================================================

export type PoeId = "peace_arch" | "pacific_highway" | "aldergrove" | "sumas" | "point_roberts";
export type Direction = "northbound" | "southbound";
export type LaneType = "commercial" | "passenger_nexus";
export type CongestionStatus = "green" | "amber" | "red";

export interface PortOfEntry {
  id: PoeId;
  label: string;
  usSide: string;
  caSide: string;
  hasCommercialLane: boolean;
  hasPassengerLane: boolean;
  /** Approx one-way drive minutes from Pacific Highway — used by the reroute economics. */
  driveMinutesFromPacificHighway: number;
}

export const PORTS_OF_ENTRY: Record<PoeId, PortOfEntry> = {
  peace_arch: {
    id: "peace_arch",
    label: "Peace Arch",
    usSide: "Blaine, WA",
    caSide: "Surrey, BC",
    hasCommercialLane: false, // Peace Arch does not permit commercial trucks
    hasPassengerLane: true,
    driveMinutesFromPacificHighway: 8,
  },
  pacific_highway: {
    id: "pacific_highway",
    label: "Pacific Highway",
    usSide: "Blaine, WA",
    caSide: "Surrey, BC",
    hasCommercialLane: true,
    hasPassengerLane: true,
    driveMinutesFromPacificHighway: 0,
  },
  aldergrove: {
    id: "aldergrove",
    label: "Aldergrove",
    usSide: "Lynden, WA",
    caSide: "Langley, BC",
    hasCommercialLane: true,
    hasPassengerLane: true,
    driveMinutesFromPacificHighway: 30,
  },
  sumas: {
    id: "sumas",
    label: "Sumas",
    usSide: "Sumas, WA",
    caSide: "Abbotsford, BC",
    hasCommercialLane: true,
    hasPassengerLane: true,
    driveMinutesFromPacificHighway: 35,
  },
  point_roberts: {
    id: "point_roberts",
    label: "Point Roberts",
    usSide: "Point Roberts, WA",
    caSide: "Tsawwassen, BC",
    hasCommercialLane: true,
    hasPassengerLane: true,
    driveMinutesFromPacificHighway: 25,
  },
};

export const CONGESTION_THRESHOLDS = { amberMinMinutes: 15, redMinMinutes: 45 };

export function classifyCongestion(waitMinutes: number): CongestionStatus {
  if (waitMinutes >= CONGESTION_THRESHOLDS.redMinMinutes) return "red";
  if (waitMinutes >= CONGESTION_THRESHOLDS.amberMinMinutes) return "amber";
  return "green";
}

export interface BorderWaitReading {
  poeId: PoeId;
  direction: Direction;
  laneType: LaneType;
  waitMinutes: number;
  status: CongestionStatus;
  observedAtIso: string;
}
