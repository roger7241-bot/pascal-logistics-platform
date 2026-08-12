// ============================================================================
// EXCEPTION & REBOOKING ENGINE
// Detects missed pickup/delivery exceptions against facility check-in data,
// classifies fault (carrier / facility / force majeure) to protect clients
// from wrongly-assessed detention or dry-run fees, and generates the three
// rebooking options from the spec. Deterministic rule engine — every
// classification is explainable, not a black-box call.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { ExceptionRecord, FacilityCheckIn, FaultClassification, RebookingOption } from "../types/exception.js";

const GRACE_PERIOD_MINUTES = 30;
const SIGNIFICANT_BORDER_DELAY_MINUTES = 30;

/**
 * Returns an exception record if the vehicle is more than GRACE_PERIOD_MINUTES
 * past the scheduled window with no check-in recorded, or undefined if the
 * shipment is still within tolerance.
 */
export function detectException(checkIn: FacilityCheckIn, now: Date = new Date()): ExceptionRecord | undefined {
  if (checkIn.actualCheckInIso) return undefined; // vehicle arrived — no exception

  const windowEnd = new Date(checkIn.scheduledWindowEndIso);
  const minutesPastWindow = Math.round((now.getTime() - windowEnd.getTime()) / 60_000);
  if (minutesPastWindow < GRACE_PERIOD_MINUTES) return undefined; // still within grace period

  const { classification, reasoning } = classifyFault(checkIn);

  return {
    id: randomUUID(),
    shipmentId: checkIn.shipmentId,
    type: checkIn.type,
    minutesPastWindow,
    faultClassification: classification,
    faultReasoning: reasoning,
    detectedAtIso: now.toISOString(),
  };
}

function classifyFault(checkIn: FacilityCheckIn): { classification: FaultClassification; reasoning: string } {
  // Force majeure checked first — an external cause exculpates both parties
  // regardless of what else is true about the booking.
  if (checkIn.weatherAdvisoryActive) {
    return { classification: "force_majeure", reasoning: "Active weather advisory on file for the scheduled window." };
  }
  if (checkIn.knownBorderDelayMinutes !== undefined && checkIn.knownBorderDelayMinutes >= SIGNIFICANT_BORDER_DELAY_MINUTES) {
    return { classification: "force_majeure", reasoning: `Live border telemetry showed a ${checkIn.knownBorderDelayMinutes}-minute delay at the crossing during the scheduled window.` };
  }

  // Facility-caused conditions next — protects the carrier from being
  // penalized for a miss the client's own site caused.
  if (checkIn.type === "missed_pickup" && checkIn.cargoReadyAtFacility === false) {
    return { classification: "facility_fault", reasoning: "Cargo was not staged and ready at the facility at the scheduled pickup time." };
  }
  if (checkIn.dockClosedAtWindow) {
    return { classification: "facility_fault", reasoning: "Facility dock was closed during the scheduled window." };
  }

  // No exculpatory condition identified — default to carrier fault, since
  // the carrier bears responsibility for on-time performance absent an
  // external or facility-caused explanation.
  return { classification: "carrier_fault", reasoning: "No facility or force-majeure cause identified — carrier failed to meet the scheduled window." };
}

/**
 * Generates the three rebooking paths from the spec, with per-option
 * recommendation flags driven by the fault classification — e.g. a dispute
 * letter is only recommended when the carrier itself was at fault, since
 * that's the scenario where an improperly-assessed dry-run fee is possible.
 */
export function generateRebookingOptions(exception: ExceptionRecord): RebookingOption[] {
  const options: RebookingOption[] = [];

  options.push({
    type: "same_carrier_reschedule",
    label: "Reschedule with same carrier",
    description: "Query the carrier for the next available dock window and issue an updated BOL / appointment confirmation.",
    recommended: exception.faultClassification !== "carrier_fault",
  });

  options.push({
    type: "hot_shot_recovery",
    label: "Hot-shot / recovery carrier",
    description: "Run an instant spot-market search for backup capacity and present a 1-click carrier re-assignment.",
    recommended: exception.faultClassification === "carrier_fault" || exception.minutesPastWindow > 120,
  });

  options.push({
    type: "executive_dispute",
    label: "Executive dispute gate",
    description: "Generate an executive dispute letter citing GPS and facility logs, routed to Roger for approval before sending.",
    recommended: exception.faultClassification === "carrier_fault",
  });

  return options;
}
