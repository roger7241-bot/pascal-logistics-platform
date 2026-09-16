// ============================================================================
// CargoAi adapter (air waybills)
// Ships in demo mode. Live mode wires CargoAi's REST API for AWB tracking
// once the client provides API credentials. CargoAi covers ~30 major air
// carriers including LH Cargo, EK SkyCargo, Cathay, KL/AF, ANA, SIA, QR, EY.
// ============================================================================

import type { TrackingAdapter, SubscribeRequest, SubscribeResult, TrackingMilestone } from "./types.js";
import { generateAirMilestones } from "./demoData.js";

export class CargoAiAdapter implements TrackingAdapter {
  provider = "cargoai" as const;
  mode = "air" as const;

  constructor(public demoMode: boolean, private apiKey?: string) {}

  async subscribe(req: SubscribeRequest): Promise<SubscribeResult> {
    if (this.demoMode || !this.apiKey) {
      return {
        provider: "cargoai",
        demoMode: true,
        externalRef: `demo_${req.trackingNumber}`,
        message: "Demo mode — deterministic milestone timeline generated. Add CARGOAI_API_KEY to switch live.",
      };
    }
    throw new Error("Live CargoAi subscribe not wired yet.");
  }

  async fetchMilestones(req: SubscribeRequest): Promise<TrackingMilestone[]> {
    if (this.demoMode || !this.apiKey) {
      return generateAirMilestones(req.trackingNumber, req.origin, req.destination);
    }
    throw new Error("Live CargoAi fetch not wired yet.");
  }
}
