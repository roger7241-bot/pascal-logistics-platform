// ============================================================================
// CONSULTATIVE REROUTE & BROKER NOTIFICATION TYPES (Prompts 36 & 39)
// Non-unilateral by design: an advisory is only a recommendation until a
// named Client Logistics Manager signs off. Approval drafts a real ACE/ACI
// port-amendment package and emails the broker of record; driver dispatch
// stays held (PENDING_BROKER_CONFIRMATION) until the broker confirms back.
// ============================================================================

import type { PoeId } from "./borderTelemetry.js";

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
  deltaMinutes: number; // fromWaitMinutes - toWaitMinutes; only created when > 30
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

export interface AceAciAmendmentPackage {
  shipmentId: string;
  fromPortCode: string;
  toPortCode: string;
  emailSubject: string;
  emailBody: string;
}
