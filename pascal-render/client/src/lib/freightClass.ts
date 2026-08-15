// ============================================================================
// Freight density → NMFC class mapping (standard industry table) and
// lbs/kg conversion. Pure functions, no side effects.
// ============================================================================

const NMFC_DENSITY_TABLE: { minPcf: number; freightClass: string }[] = [
  { minPcf: 50, freightClass: "50" },
  { minPcf: 35, freightClass: "55" },
  { minPcf: 30, freightClass: "60" },
  { minPcf: 22.5, freightClass: "65" },
  { minPcf: 15, freightClass: "70" },
  { minPcf: 13.5, freightClass: "77.5" },
  { minPcf: 12, freightClass: "85" },
  { minPcf: 10, freightClass: "92.5" },
  { minPcf: 8, freightClass: "100" },
  { minPcf: 6, freightClass: "125" },
  { minPcf: 4, freightClass: "150" },
  { minPcf: 2, freightClass: "175" },
  { minPcf: 1, freightClass: "250" },
  { minPcf: 0, freightClass: "500" },
];

export interface FreightClassResult {
  densityPcf: number;
  freightClass: string;
  volumeCuFt: number;
}

/** Volume = (L * W * H * pallets) / 1728 [in³ → ft³]; Density = weight / volume. */
export function calculateFreightClass(lengthIn: number, widthIn: number, heightIn: number, palletCount: number, grossWeightLbs: number): FreightClassResult | undefined {
  if (lengthIn <= 0 || widthIn <= 0 || heightIn <= 0 || palletCount <= 0 || grossWeightLbs <= 0) return undefined;
  const volumeCuFt = (lengthIn * widthIn * heightIn * palletCount) / 1728;
  const densityPcf = grossWeightLbs / volumeCuFt;
  const freightClass = NMFC_DENSITY_TABLE.find((row) => densityPcf >= row.minPcf)?.freightClass ?? "500";
  return { densityPcf: Math.round(densityPcf * 100) / 100, freightClass, volumeCuFt: Math.round(volumeCuFt * 100) / 100 };
}

const LBS_PER_KG = 2.20462;

export function lbsToKg(lbs: number): number {
  return Math.round((lbs / LBS_PER_KG) * 100) / 100;
}

export function kgToLbs(kg: number): number {
  return Math.round(kg * LBS_PER_KG * 100) / 100;
}
