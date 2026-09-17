// ============================================================================
// MacroPoint adapter (LTL / TL / rail intermodal)
// The industry-standard aggregator for land-freight visibility. Covers ~200
// TL carriers via ELD API, most large LTL carriers directly, and BNSF/UP
// intermodal via rail feeds. Demo mode ships today with realistic
// mode-specific milestone timelines; live mode wires the MacroPoint REST
// API once a MACROPOINT_API_KEY is provisioned.
// ============================================================================

import type { TrackingAdapter, SubscribeRequest, SubscribeResult, TrackingMilestone, TrackingMode } from "./types.js";
import { generateLtlMilestones, generateTlMilestones, generateRailMilestones } from "./demoData.js";

export class MacroPointAdapter implements TrackingAdapter {
  provider = "macropoint" as const;

  constructor(public demoMode: boolean, public mode: TrackingMode, private apiKey?: string) {}

  async subscribe(req: SubscribeRequest): Promise<SubscribeResult> {
    if (this.demoMode || !this.apiKey) {
      return {
        provider: "macropoint",
        demoMode: true,
        externalRef: `demo_${req.trackingNumber}`,
        message: `Demo mode — deterministic ${this.mode.toUpperCase()} milestone timeline generated. Add MACROPOINT_API_KEY to switch live.`,
      };
    }
    throw new Error("Live MacroPoint subscribe not wired yet.");
  }

  async fetchMilestones(req: SubscribeRequest): Promise<TrackingMilestone[]> {
    if (this.demoMode || !this.apiKey) {
      switch (this.mode) {
        case "ltl":  return generateLtlMilestones(req.trackingNumber, req.origin, req.destination);
        case "tl":   return generateTlMilestones(req.trackingNumber, req.origin, req.destination);
        case "rail": return generateRailMilestones(req.trackingNumber, req.origin, req.destination);
        default: throw new Error(`MacroPoint does not handle mode ${this.mode}`);
      }
    }
    throw new Error("Live MacroPoint fetch not wired yet.");
  }
}
