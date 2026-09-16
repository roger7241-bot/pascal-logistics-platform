// ============================================================================
// TRACKING ADAPTER — common types
// One TypeScript surface every tracking provider implements (Terminal49 for
// ocean, CargoAi for air, plus a demo adapter that ships from day 1). Lets
// Booking & Dispatch (Agent 6) + Customer Service (Agent 8) reason about
// container / MAWB milestones identically regardless of the client's mode.
// ============================================================================

export type TrackingMode = "ocean" | "air";
export type TrackingProvider = "terminal49" | "cargoai" | "demo";

export type MilestoneEventType =
  | "booking_confirmed"
  | "gate_in"                 // container gated in at origin terminal / cargo tendered at origin
  | "loaded"                  // loaded onto vessel / loaded onto aircraft
  | "sailed"                  // vessel departed origin port / flight departed
  | "in_transit"              // mid-passage sighting / mid-flight
  | "arrived"                 // vessel arrived destination / flight arrived
  | "discharged"              // container discharged from vessel / cargo unloaded from aircraft
  | "customs_hold"
  | "customs_released"
  | "gated_out"               // container picked up at destination terminal / cargo picked up
  | "delivered"
  | "exception"               // late, damaged, rolled, missing document
  | "hold"                    // generic hold (weather / labor / ops)
  | "rolled"                  // rolled to next vessel / flight
  | "released";

export interface TrackingMilestone {
  eventType: MilestoneEventType;
  eventCode?: string;         // carrier's raw code
  location?: string;
  latitude?: number;
  longitude?: number;
  occurredAtIso: string;
  isException: boolean;
  details?: Record<string, unknown>;
}

export interface SubscribeRequest {
  trackingNumber: string;
  carrierScacOrIata?: string;
  billOfLading?: string;
  bookingNumber?: string;
  reference?: string;
  origin?: string;
  destination?: string;
}

export interface SubscribeResult {
  provider: TrackingProvider;
  demoMode: boolean;
  externalRef?: string;       // provider's internal id
  message: string;
}

export interface TrackingAdapter {
  provider: TrackingProvider;
  mode: TrackingMode;
  demoMode: boolean;

  subscribe(req: SubscribeRequest): Promise<SubscribeResult>;
  fetchMilestones(req: SubscribeRequest): Promise<TrackingMilestone[]>;
}
