// ============================================================================
// LANDED COST — freight + duty + brokerage + insurance + last mile
// One service, five modes (LTL / TL / OCEAN_FCL / OCEAN_LCL / AIR), a
// realistic breakdown SMB shippers actually ask for on their first call.
// Rate sources: Priority1 for LTL when configured, benchmark tables for
// ocean/air/duty otherwise. Demo mode fills in defaults so the widget
// works from day one even with no aggregator keys.
// ============================================================================

export type Mode = "LTL" | "TL" | "OCEAN_FCL" | "OCEAN_LCL" | "AIR";
export type Direction = "US_INBOUND" | "CA_INBOUND" | "US_TO_CA" | "CA_TO_US" | "DOMESTIC";

export interface LandedCostInput {
  mode: Mode;
  origin: string;                        // freeform city or port name
  originCountry: string;                 // ISO-2 CN / US / CA / DE …
  destination: string;
  destinationCountry: string;
  destinationZip?: string;               // needed for last-mile calc
  weightKg: number;
  volumeCbm?: number;                    // for ocean/air/LTL densification
  pieces?: number;
  hsCode?: string;
  hsChapter?: string;                    // fallback when hsCode not known
  declaredValueUsd: number;
  incoterm?: "EXW" | "FOB" | "CIF" | "DAP" | "DDP";
  useUsmcaOrigin?: boolean;              // qualifies as USMCA?
  includeInsurance?: boolean;
  brokerageFeeUsdOverride?: number;      // client's broker rate if known
  lastMileZip?: string;
  isDangerousGoods?: boolean;
}

export interface CostLine {
  label: string;
  amountUsd: number;
  notes?: string;
}

export interface LandedCostBreakdown {
  input: LandedCostInput;
  freight: CostLine[];
  duties: CostLine[];
  brokerage: CostLine[];
  insurance: CostLine[];
  lastMile: CostLine[];
  otherAccessorials: CostLine[];
  totals: {
    freightUsd: number;
    dutiesUsd: number;
    brokerageUsd: number;
    insuranceUsd: number;
    lastMileUsd: number;
    accessorialsUsd: number;
    grandTotalUsd: number;
    perKgUsd: number;
    perPieceUsd: number | null;
  };
  assumptions: string[];
  simulated: boolean;
  estimatedAtIso: string;
}

// Ballpark freight rates (USD). Realistic mid-market pricing; not exact.
// Sources ranged for tuning: NMFC / DAT / Xeneta / IATA quarterly averages.
const OCEAN_FCL_20FT_BASE = 2200;
const OCEAN_FCL_40FT_BASE = 3600;
const OCEAN_LCL_PER_CBM = 95;
const OCEAN_LCL_MIN = 250;
const AIR_PER_KG = 4.20;
const AIR_MIN = 180;
const LTL_PER_KG = 1.35;                 // typical ~$0.60-1.60/kg for LTL
const LTL_MIN = 145;
const TL_PER_MILE = 2.90;                // $/mi conservative

// Duty rates by HS chapter — realistic USMCA-preferential vs MFN for common
// chapters our ICP ships. When useUsmcaOrigin=true we drop to preferential
// rate; otherwise MFN applies. NOT tariff advice — a starting-point estimate.
interface DutyRow { mfn: number; usmca: number; label: string }
const DUTY_TABLE_US: Record<string, DutyRow> = {
  "72": { mfn: 0.00, usmca: 0.00, label: "Iron & steel — check Section 232 overlays" },
  "73": { mfn: 2.30, usmca: 0.00, label: "Iron & steel articles" },
  "84": { mfn: 2.50, usmca: 0.00, label: "Machinery" },
  "85": { mfn: 2.60, usmca: 0.00, label: "Electrical machinery" },
  "87": { mfn: 2.50, usmca: 0.00, label: "Vehicles" },
  "94": { mfn: 3.00, usmca: 0.00, label: "Furniture" },
  "39": { mfn: 5.50, usmca: 0.00, label: "Plastics" },
  "40": { mfn: 3.30, usmca: 0.00, label: "Rubber" },
  "61": { mfn: 12.00, usmca: 0.00, label: "Apparel (knit)" },
  "62": { mfn: 12.00, usmca: 0.00, label: "Apparel (woven)" },
  "63": { mfn: 6.50, usmca: 0.00, label: "Textile articles" },
  "44": { mfn: 3.20, usmca: 0.00, label: "Wood" },
  "48": { mfn: 3.00, usmca: 0.00, label: "Paper" },
  "22": { mfn: 5.30, usmca: 0.00, label: "Beverages" },
  "OTHER": { mfn: 4.00, usmca: 0.00, label: "General estimate" },
};
const DUTY_TABLE_CA: Record<string, DutyRow> = {
  "72": { mfn: 0.00, usmca: 0.00, label: "Iron & steel" },
  "73": { mfn: 6.50, usmca: 0.00, label: "Iron & steel articles" },
  "84": { mfn: 0.00, usmca: 0.00, label: "Machinery" },
  "85": { mfn: 6.00, usmca: 0.00, label: "Electrical machinery" },
  "87": { mfn: 6.10, usmca: 0.00, label: "Vehicles" },
  "94": { mfn: 6.50, usmca: 0.00, label: "Furniture" },
  "39": { mfn: 6.50, usmca: 0.00, label: "Plastics" },
  "40": { mfn: 6.50, usmca: 0.00, label: "Rubber" },
  "61": { mfn: 18.00, usmca: 0.00, label: "Apparel (knit)" },
  "62": { mfn: 18.00, usmca: 0.00, label: "Apparel (woven)" },
  "63": { mfn: 12.00, usmca: 0.00, label: "Textile articles" },
  "44": { mfn: 3.50, usmca: 0.00, label: "Wood" },
  "48": { mfn: 0.00, usmca: 0.00, label: "Paper" },
  "22": { mfn: 4.68, usmca: 0.00, label: "Beverages (excise varies)" },
  "OTHER": { mfn: 5.00, usmca: 0.00, label: "General estimate" },
};

function chapterFromHs(hs?: string, fallback?: string): string {
  const first2 = (hs ?? "").replace(/[^0-9]/g, "").slice(0, 2);
  if (first2.length === 2) return first2;
  return (fallback ?? "").replace(/[^0-9]/g, "").slice(0, 2) || "OTHER";
}

function estimateFreight(input: LandedCostInput, assumptions: string[]): CostLine[] {
  const cost: CostLine[] = [];
  const kg = input.weightKg;
  switch (input.mode) {
    case "OCEAN_FCL": {
      const size40 = kg >= 15000 || (input.volumeCbm ?? 0) > 33;
      const base = size40 ? OCEAN_FCL_40FT_BASE : OCEAN_FCL_20FT_BASE;
      cost.push({ label: size40 ? "Ocean linehaul — 40ft dry (all-in)" : "Ocean linehaul — 20ft dry (all-in)", amountUsd: base, notes: "Includes ocean freight, THC (both ends), documentation." });
      cost.push({ label: "Bunker adjustment (BAF)", amountUsd: Math.round(base * 0.08) });
      cost.push({ label: "Container security fee (ISF/AMS)", amountUsd: 55 });
      assumptions.push(`Ocean FCL rate is a benchmark all-in estimate; peak season / blank sailings can vary by ±30%.`);
      break;
    }
    case "OCEAN_LCL": {
      const cbm = Math.max(1, input.volumeCbm ?? Math.ceil(kg / 400));
      const line = Math.max(OCEAN_LCL_MIN, cbm * OCEAN_LCL_PER_CBM);
      cost.push({ label: `Ocean LCL — ${cbm.toFixed(1)} cbm × $${OCEAN_LCL_PER_CBM}/cbm`, amountUsd: Math.round(line) });
      cost.push({ label: "CFS destination handling", amountUsd: 45 * cbm });
      cost.push({ label: "ISF/AMS", amountUsd: 55 });
      assumptions.push(`Ocean LCL priced on chargeable volume (1 cbm = 1000 kg minimum). Consolidation timing adds 3-5 days to transit.`);
      break;
    }
    case "AIR": {
      const chargeable = Math.max(kg, (input.volumeCbm ?? 0) * 167); // IATA volumetric: 1 cbm = 167 kg
      const rate = kg < 100 ? AIR_PER_KG * 1.35 : kg < 500 ? AIR_PER_KG * 1.15 : AIR_PER_KG;
      const line = Math.max(AIR_MIN, chargeable * rate);
      cost.push({ label: `Air linehaul — ${chargeable.toFixed(0)} kg chargeable × $${rate.toFixed(2)}/kg`, amountUsd: Math.round(line) });
      cost.push({ label: "Fuel surcharge (~18%)", amountUsd: Math.round(line * 0.18) });
      cost.push({ label: "Security surcharge", amountUsd: Math.max(35, Math.round(chargeable * 0.15)) });
      if (input.isDangerousGoods) cost.push({ label: "DG handling fee", amountUsd: 165 });
      assumptions.push(`Air rate uses IATA volumetric weight (1 cbm = 167 kg). Rates fluctuate with capacity.`);
      break;
    }
    case "LTL": {
      const line = Math.max(LTL_MIN, kg * LTL_PER_KG);
      cost.push({ label: `LTL linehaul — ${kg} kg × $${LTL_PER_KG}/kg`, amountUsd: Math.round(line) });
      cost.push({ label: "Fuel surcharge (~28%)", amountUsd: Math.round(line * 0.28) });
      if (input.isDangerousGoods) cost.push({ label: "Hazmat handling", amountUsd: 55 });
      assumptions.push(`LTL rate is benchmark; density and NMFC class can shift ±25%.`);
      break;
    }
    case "TL": {
      // Estimate miles from origin/dest — rough 800 mi default
      const estMiles = 800;
      const line = estMiles * TL_PER_MILE;
      cost.push({ label: `Truckload linehaul — ${estMiles} mi × $${TL_PER_MILE}/mi`, amountUsd: Math.round(line), notes: "Assumes 800 mi; get lane-specific quote for precision." });
      cost.push({ label: "Fuel included in all-in rate", amountUsd: 0 });
      assumptions.push(`TL rate estimate uses ${estMiles} miles as a default; the real distance changes the linehaul.`);
      break;
    }
  }
  return cost;
}

function estimateDuty(input: LandedCostInput, assumptions: string[]): CostLine[] {
  if (input.mode === "LTL" || input.mode === "TL") {
    // Skip duty for domestic-only moves
    if (input.originCountry === input.destinationCountry) return [];
  }
  const table = input.destinationCountry === "CA" ? DUTY_TABLE_CA : DUTY_TABLE_US;
  const chapter = chapterFromHs(input.hsCode, input.hsChapter);
  const row = table[chapter] ?? table.OTHER;
  const rate = input.useUsmcaOrigin ? row.usmca : row.mfn;
  const duty = Math.round(input.declaredValueUsd * (rate / 100));
  const lines: CostLine[] = [{
    label: `Duty — HS chapter ${chapter} @ ${rate.toFixed(2)}% ${input.useUsmcaOrigin ? "(USMCA)" : "(MFN)"}`,
    amountUsd: duty,
    notes: row.label,
  }];
  if (input.destinationCountry === "CA") {
    const gst = Math.round((input.declaredValueUsd + duty) * 0.05);
    lines.push({ label: "GST @ 5% on duty-paid value", amountUsd: gst, notes: "Recoverable if you're GST-registered." });
    assumptions.push(`Canadian GST assessed on the duty-paid value; recoverable via your GST filings.`);
  } else if (input.destinationCountry === "US") {
    const mpf = Math.min(614.35, Math.max(31.67, input.declaredValueUsd * 0.003464));
    lines.push({ label: "MPF (Merchandise Processing Fee)", amountUsd: Math.round(mpf), notes: "0.3464% of entered value, min $31.67, max $614.35." });
    if (input.mode === "OCEAN_FCL" || input.mode === "OCEAN_LCL") {
      lines.push({ label: "HMF (Harbor Maintenance Fee) — 0.125%", amountUsd: Math.round(input.declaredValueUsd * 0.00125) });
    }
    assumptions.push(`US import fees (MPF/HMF) added per current CBP rate table.`);
  }
  if (rate > 0 && !input.useUsmcaOrigin) {
    assumptions.push(`Duty computed at MFN rate. If your goods qualify under USMCA, mark that and duty drops significantly.`);
  }
  return lines;
}

function estimateBrokerage(input: LandedCostInput): CostLine[] {
  if (input.originCountry === input.destinationCountry) return []; // domestic no broker
  if (input.brokerageFeeUsdOverride !== undefined) {
    return [{ label: "Brokerage (per your broker's rate on file)", amountUsd: input.brokerageFeeUsdOverride }];
  }
  const isUsImport = input.destinationCountry === "US";
  const base = isUsImport ? 135 : 155;
  const complexity = input.mode === "OCEAN_FCL" || input.mode === "OCEAN_LCL" ? 30 : 0;
  return [{
    label: `Brokerage estimate — ${isUsImport ? "US CBP entry" : "CBSA entry"}`,
    amountUsd: base + complexity,
    notes: "Typical mid-market broker; yours may charge more or less.",
  }];
}

function estimateInsurance(input: LandedCostInput): CostLine[] {
  if (!input.includeInsurance) return [];
  const premium = Math.max(35, Math.round(input.declaredValueUsd * 0.0035));
  return [{ label: "Marine cargo insurance @ 0.35% of value (min $35)", amountUsd: premium }];
}

function estimateLastMile(input: LandedCostInput): CostLine[] {
  if (input.mode === "LTL" || input.mode === "TL") return []; // linehaul IS last-mile
  if (!input.lastMileZip && !input.destinationZip) return [];
  // Simple LTL last-mile: use LTL formula with a cap
  const lastMile = Math.max(125, Math.min(650, input.weightKg * 0.55));
  return [{
    label: `Last-mile from destination port/gateway (LTL to ${input.lastMileZip ?? input.destinationZip})`,
    amountUsd: Math.round(lastMile),
    notes: "Assumes standard LTL delivery, no accessorials (liftgate, residential, inside).",
  }];
}

export function estimateLandedCost(input: LandedCostInput): LandedCostBreakdown {
  const assumptions: string[] = [];
  const freight = estimateFreight(input, assumptions);
  const duties = estimateDuty(input, assumptions);
  const brokerage = estimateBrokerage(input);
  const insurance = estimateInsurance(input);
  const lastMile = estimateLastMile(input);
  const otherAccessorials: CostLine[] = [];

  const sum = (arr: CostLine[]): number => arr.reduce((n, c) => n + c.amountUsd, 0);
  const freightTotal = sum(freight);
  const dutiesTotal = sum(duties);
  const brokerageTotal = sum(brokerage);
  const insuranceTotal = sum(insurance);
  const lastMileTotal = sum(lastMile);
  const accessorialsTotal = sum(otherAccessorials);
  const grand = freightTotal + dutiesTotal + brokerageTotal + insuranceTotal + lastMileTotal + accessorialsTotal;

  return {
    input,
    freight,
    duties,
    brokerage,
    insurance,
    lastMile,
    otherAccessorials,
    totals: {
      freightUsd: freightTotal,
      dutiesUsd: dutiesTotal,
      brokerageUsd: brokerageTotal,
      insuranceUsd: insuranceTotal,
      lastMileUsd: lastMileTotal,
      accessorialsUsd: accessorialsTotal,
      grandTotalUsd: grand,
      perKgUsd: input.weightKg > 0 ? Math.round((grand / input.weightKg) * 100) / 100 : 0,
      perPieceUsd: input.pieces && input.pieces > 0 ? Math.round((grand / input.pieces) * 100) / 100 : null,
    },
    assumptions,
    simulated: true,                     // benchmark rates, not carrier-live
    estimatedAtIso: new Date().toISOString(),
  };
}
