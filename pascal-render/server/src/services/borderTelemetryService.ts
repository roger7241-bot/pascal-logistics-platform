// ============================================================================
// BorderTelemetryService
// HONEST LIMITATION: real wait times come from CBSA's and CBP's live border
// wait-time feeds — this environment has no credentialed access to those
// APIs. This simulates realistic direction/lane-aware readings on a fixed
// interval and broadcasts them over the `border_telemetry` WebSocket
// channel; swap `generateReading()`'s body for a real CBSA/CBP API call
// behind the same signature and every downstream consumer (the dashboard,
// the reroute trigger, the driver SMS) keeps working unchanged.
// ============================================================================

import { PORTS_OF_ENTRY, classifyCongestion } from "../types/borderTelemetry.js";
import type { BorderWaitReading, Direction, LaneType, PoeId } from "../types/borderTelemetry.js";
import { evaluateRerouteAdvisory, type BorderReading, type RerouteRecommendation } from "../agents/agent4Equipment.js";
import type { WsManager } from "../ws/wsManager.js";

const BASELINE_MINUTES: Record<LaneType, [number, number]> = {
  commercial: [8, 65],
  passenger_nexus: [2, 30],
};

function seededRandom(seed: string): number {
  // FNV-1a string hash -> [0,1) — genuinely deterministic per seed, so
  // repeated reads within the same call stack produce the same value
  // for a given POE/direction/lane combination.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function generateReading(poeId: PoeId, direction: Direction, laneType: LaneType): BorderWaitReading {
  const [min, max] = BASELINE_MINUTES[laneType];
  // 5-minute time bucket in the seed — readings vary between polls but
  // stay stable if called more than once within the same short window,
  // rather than jittering on every call.
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const waitMinutes = Math.round(min + seededRandom(`${poeId}:${direction}:${laneType}:${timeBucket}`) * (max - min));
  return {
    poeId,
    direction,
    laneType,
    waitMinutes,
    status: classifyCongestion(waitMinutes),
    observedAtIso: new Date().toISOString(),
  };
}

export function generateAllReadings(): BorderWaitReading[] {
  const readings: BorderWaitReading[] = [];
  const directions: Direction[] = ["northbound", "southbound"];

  for (const poe of Object.values(PORTS_OF_ENTRY)) {
    for (const direction of directions) {
      if (poe.hasCommercialLane) readings.push(generateReading(poe.id, direction, "commercial"));
      if (poe.hasPassengerLane) readings.push(generateReading(poe.id, direction, "passenger_nexus"));
    }
  }
  return readings;
}

function toAgent4Readings(readings: BorderWaitReading[], direction: Direction): BorderReading[] {
  return readings
    .filter((r) => r.direction === direction && r.laneType === "commercial")
    .map((r) => ({ poeId: r.poeId as "pacific_highway" | "aldergrove" | "sumas", waitMinutes: r.waitMinutes }));
}

const POLL_INTERVAL_MS = 60_000;

export class BorderTelemetryService {
  private timer: NodeJS.Timeout | undefined;
  private latestReadings: BorderWaitReading[] = [];
  private latestTriggers: { direction: Direction; recommendation: RerouteRecommendation }[] = [];

  constructor(private wsManager: WsManager) {}

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private poll(): void {
    this.latestReadings = generateAllReadings();

    const triggers: { direction: Direction; recommendation: RerouteRecommendation }[] = [];
    for (const direction of ["northbound", "southbound"] as Direction[]) {
      const agent4Readings = toAgent4Readings(this.latestReadings, direction);
      const recommendation = evaluateRerouteAdvisory(agent4Readings);
      if (recommendation) triggers.push({ direction, recommendation });
    }
    this.latestTriggers = triggers;

    for (const reading of this.latestReadings) {
      this.wsManager.broadcastBorderWaitUpdate({
        poeId: reading.poeId,
        direction: reading.direction,
        laneType: reading.laneType,
        waitMinutes: reading.waitMinutes,
      });
    }
  }

  getSnapshot(): { readings: BorderWaitReading[]; triggers: { direction: Direction; recommendation: RerouteRecommendation }[] } {
    return { readings: this.latestReadings, triggers: this.latestTriggers };
  }
}
