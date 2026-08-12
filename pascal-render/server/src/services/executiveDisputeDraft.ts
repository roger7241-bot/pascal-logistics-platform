// ============================================================================
// EXECUTIVE DISPUTE DRAFT
// Generates the dispute letter for the executive_dispute rebooking option,
// carrying the same mandatory approval-gate contract as every other
// executive-facing draft in this platform: it is structurally impossible
// for a dispute letter to be marked auto-sent.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { ExceptionRecord } from "../types/exception.js";

export interface ExecutiveDisputeDraft {
  id: string;
  exceptionId: string;
  shipmentId: string;
  subject: string;
  body: string;
  citedEvidence: string[];
  // Mandatory literal-type gate — a dispute letter can never be created
  // pre-approved, enforced by the type system as well as at runtime.
  approvalStatus: "PENDING_ROGER_APPROVAL";
  autoActionExecuted: false;
  createdAtIso: string;
}

export function generateExecutiveDisputeDraft(exception: ExceptionRecord, carrierName: string): ExecutiveDisputeDraft {
  if (exception.faultClassification !== "carrier_fault") {
    throw new Error(
      `Refusing to generate a dispute draft for exception ${exception.id} — fault classification is "${exception.faultClassification}", not carrier_fault. A dispute letter only makes sense when the carrier itself caused the miss.`,
    );
  }

  const citedEvidence = [
    `Facility check-in log — no vehicle arrival recorded ${exception.minutesPastWindow} minutes past the scheduled window`,
    `Exception classification: ${exception.faultClassification} — ${exception.faultReasoning}`,
    "GPS/telematics trail (attach from carrier tracking integration when available)",
  ];

  return {
    id: randomUUID(),
    exceptionId: exception.id,
    shipmentId: exception.shipmentId,
    subject: `Dispute — ${exception.type === "missed_pickup" ? "missed pickup" : "missed delivery"} fee, ${exception.shipmentId}`,
    body:
      `To ${carrierName} Claims Department,\n\n` +
      `We're disputing any dry-run or detention charge associated with ${exception.shipmentId}. ` +
      `Our facility logs show the scheduled window was ${exception.type === "missed_pickup" ? "pickup" : "delivery"} readiness confirmed on our end, ` +
      `with no vehicle arrival recorded ${exception.minutesPastWindow} minutes past the window close. ` +
      `Please review the attached evidence and confirm no charge will be applied, or provide GPS/dispatch records supporting a contrary timeline.\n\n` +
      `Roger Jervis\nPascal Logistics`,
    citedEvidence,
    approvalStatus: "PENDING_ROGER_APPROVAL",
    autoActionExecuted: false,
    createdAtIso: new Date().toISOString(),
  };
}
