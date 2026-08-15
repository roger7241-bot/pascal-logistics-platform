// ============================================================================
// CLIENT EXPERIENCE SUITE — types/cx.ts
// ============================================================================

export interface ExecutiveMorningBrief {
  orgId: string;
  generatedAtIso: string;
  shipmentsInTransit: number;
  shipmentsWithExceptions: number;
  criticalRerouteAdvisoriesPending: number;
  agent3SavingsCapturedUsd: number;
  todaysCalendarEventCount: number;
  narrative: string; // the rendered digest text
}

export interface PublicTrackingPayload {
  shipmentId: string;
  lane: string;
  currentMilestone: string;
  milestoneSequence: string[]; // ordered list for the progress bar; currentMilestone's index = progress
  statusLabel: string;
  etaIso?: string;
  carrierName?: string;
  lastUpdatedIso: string;
}

export type WebhookPlatform = "slack" | "teams";
export type WebhookSeverity = "info" | "warning" | "critical";

export interface WebhookAlertPayload {
  orgId: string;
  platform: WebhookPlatform;
  webhookUrl: string;
  severity: WebhookSeverity;
  title: string;
  message: string;
  shipmentId?: string;
  linkUrl?: string;
}
