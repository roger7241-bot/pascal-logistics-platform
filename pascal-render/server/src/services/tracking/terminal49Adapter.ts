// ============================================================================
// Terminal49 adapter (ocean containers)
// Ships in demo mode. Live mode wires the Terminal49 REST API + webhook
// receiver once the client provides an API key. Terminal49 covers ~100
// ocean carriers and every US/CA terminal via Bearer-token auth.
// ============================================================================

import type { TrackingAdapter, SubscribeRequest, SubscribeResult, TrackingMilestone } from "./types.js";
import { generateOceanMilestones } from "./demoData.js";

export class Terminal49Adapter implements TrackingAdapter {
  provider = "terminal49" as const;
  mode = "ocean" as const;

  constructor(public demoMode: boolean, private apiKey?: string) {}

  async subscribe(req: SubscribeRequest): Promise<SubscribeResult> {
    if (this.demoMode || !this.apiKey) {
      return {
        provider: "terminal49",
        demoMode: true,
        externalRef: `demo_${req.trackingNumber}`,
        message: "Demo mode — deterministic milestone timeline generated. Add TERMINAL49_API_KEY to switch live.",
      };
    }
    // Live implementation would POST /shipments to Terminal49 here.
    throw new Error("Live Terminal49 subscribe not wired yet.");
  }

  async fetchMilestones(req: SubscribeRequest): Promise<TrackingMilestone[]> {
    if (this.demoMode || !this.apiKey) {
      return generateOceanMilestones(req.trackingNumber, req.origin, req.destination);
    }
    throw new Error("Live Terminal49 fetch not wired yet.");
  }
}
