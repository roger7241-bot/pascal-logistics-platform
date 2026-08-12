// ============================================================================
// AGENT 4 — LOGISTICS OPERATIONS & EQUIPMENT MATCHING
// Recommends equipment type from cargo characteristics, and evaluates the
// Pacific Highway -> Aldergrove/Sumas automated reroute trigger using the
// same fuel/mileage/time economics established for the Regional Border
// Telemetry Service.
// ============================================================================

import type { CargoDetails } from "../types/shipment.js";

export interface EquipmentRecommendation {
  recommended: string;
  reasoning: string;
}

export function recommendEquipment(cargo: CargoDetails): EquipmentRecommendation {
  if (cargo.equipmentType) {
    return { recommended: cargo.equipmentType, reasoning: "Equipment type explicitly specified in payload." };
  }
  if (cargo.isHazmat) {
    return { recommended: "dry_van_53", reasoning: "Hazmat cargo defaults to placarded 53ft dry van pending SDS-driven overrides." };
  }
  if (cargo.reeferTempF !== undefined) {
    return { recommended: "reefer_53", reasoning: `Temperature control requested (${cargo.reeferTempF}°F) — reefer required.` };
  }
  const totalUnits = cargo.handlingUnits.reduce((sum, u) => sum + u.quantity, 0);
  if (totalUnits > 0 && totalUnits <= 6) {
    return { recommended: "ltl_pallet", reasoning: `${totalUnits} handling unit(s) — LTL pallet rate is more cost-effective than a full trailer.` };
  }
  return { recommended: "dry_van_53", reasoning: "Default full-truckload equipment for undifferentiated general freight." };
}

// --- Border reroute trigger (mirrors RegionalBorderTelemetryService) -------

export interface BorderReading {
  poeId: "pacific_highway" | "aldergrove" | "sumas";
  waitMinutes: number;
}

export interface RerouteRecommendation {
  fromPoeId: string;
  toPoeId: string;
  fromWaitMinutes: number;
  toWaitMinutes: number;
  additionalDriveMinutes: number;
  additionalDriveMiles: number;
  additionalFuelCostUsd: number;
  netTimeSavedMinutes: number;
  netValueUsd: number;
  recommended: boolean;
}

const TRUCK_MPG = 6.5;
const DIESEL_PRICE_PER_GALLON_USD = 4.15;
const DRIVER_ASSET_COST_PER_MINUTE_USD = 1.1;
const AVG_ROAD_SPEED_MPH = 40;
const DRIVE_MINUTES_FROM_PACIFIC_HIGHWAY: Record<string, number> = { aldergrove: 30, sumas: 35 };

/**
 * The automated trigger: Pacific Highway commercial wait > 45 min AND an
 * alternate (Aldergrove or Sumas) commercial wait < 15 min. Returns the
 * best qualifying recommendation, or undefined if the trigger isn't met.
 */
export function evaluateRerouteTrigger(readings: BorderReading[]): RerouteRecommendation | undefined {
  const primary = readings.find((r) => r.poeId === "pacific_highway");
  if (!primary || primary.waitMinutes <= 45) return undefined;

  const candidates = readings.filter((r) => r.poeId !== "pacific_highway" && r.waitMinutes < 15);
  if (candidates.length === 0) return undefined;

  const scored = candidates.map((alt) => {
    const additionalDriveMinutes = DRIVE_MINUTES_FROM_PACIFIC_HIGHWAY[alt.poeId] ?? 30;
    const additionalDriveMiles = Math.round((additionalDriveMinutes / 60) * AVG_ROAD_SPEED_MPH * 10) / 10;
    const additionalFuelCostUsd = Math.round((additionalDriveMiles / TRUCK_MPG) * DIESEL_PRICE_PER_GALLON_USD * 100) / 100;
    const waitMinutesSaved = primary.waitMinutes - alt.waitMinutes;
    const netTimeSavedMinutes = waitMinutesSaved - additionalDriveMinutes;
    const netValueUsd = Math.round((netTimeSavedMinutes * DRIVER_ASSET_COST_PER_MINUTE_USD - additionalFuelCostUsd) * 100) / 100;

    return {
      fromPoeId: primary.poeId,
      toPoeId: alt.poeId,
      fromWaitMinutes: primary.waitMinutes,
      toWaitMinutes: alt.waitMinutes,
      additionalDriveMinutes,
      additionalDriveMiles,
      additionalFuelCostUsd,
      netTimeSavedMinutes,
      netValueUsd,
      recommended: netValueUsd > 0 && netTimeSavedMinutes > 10,
    };
  });

  scored.sort((a, b) => b.netValueUsd - a.netValueUsd);
  return scored.find((r) => r.recommended);
}
