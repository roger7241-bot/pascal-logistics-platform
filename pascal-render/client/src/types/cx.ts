// ============================================================================
// Client-side mirror of server/src/types/cx.ts (public tracker subset only)
// ============================================================================

export interface PublicTrackingPayload {
  shipmentId: string;
  lane: string;
  currentMilestone: string;
  milestoneSequence: string[];
  statusLabel: string;
  etaIso?: string;
  carrierName?: string;
  lastUpdatedIso: string;
}
