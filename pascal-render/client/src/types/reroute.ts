// ============================================================================
// Client-side mirror of server/src/types/reroute.ts (client build doesn't
// reach across into server/, same pattern as types/facility.ts, types/calendar.ts).
// ============================================================================

export type PoeId = "peace_arch" | "pacific_highway" | "aldergrove" | "sumas" | "point_roberts";

export type RerouteAdvisoryStatus =
  | "pending_client_signoff"
  | "client_approved"
  | "client_declined"
  | "pending_broker_confirmation"
  | "broker_confirmed"
  | "dispatch_released";

export interface RerouteAdvisory {
  id: string;
  shipmentId: string;
  fromPoeId: PoeId;
  toPoeId: PoeId;
  fromWaitMinutes: number;
  toWaitMinutes: number;
  deltaMinutes: number;
  netTimeSavedMinutes: number;
  netValueUsd: number;
  status: RerouteAdvisoryStatus;
  clientSignoffName?: string;
  clientSignoffAtIso?: string;
  brokerEmail?: string;
  originalPortCode?: string;
  amendedPortCode?: string;
  brokerConfirmedAtIso?: string;
  dispatchReleasedAtIso?: string;
  createdAtIso: string;
}
