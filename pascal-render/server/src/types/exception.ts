// ============================================================================
// EXCEPTION & REBOOKING TYPES
// ============================================================================

export type ExceptionType = "missed_pickup" | "missed_delivery";
export type FaultClassification = "carrier_fault" | "facility_fault" | "force_majeure";

export interface FacilityCheckIn {
  shipmentId: string;
  type: ExceptionType;
  scheduledWindowStartIso: string;
  scheduledWindowEndIso: string;
  actualCheckInIso?: string; // absent = vehicle never arrived
  cargoReadyAtFacility?: boolean; // relevant for missed pickups — was the freight actually staged?
  dockClosedAtWindow?: boolean;
  knownBorderDelayMinutes?: number; // if a live border reading correlates with the miss
  weatherAdvisoryActive?: boolean;
}

export interface ExceptionRecord {
  id: string;
  shipmentId: string;
  type: ExceptionType;
  minutesPastWindow: number;
  faultClassification: FaultClassification;
  faultReasoning: string;
  detectedAtIso: string;
}

export type RebookingOptionType = "same_carrier_reschedule" | "hot_shot_recovery" | "executive_dispute";

export interface RebookingOption {
  type: RebookingOptionType;
  label: string;
  description: string;
  recommended: boolean;
}
