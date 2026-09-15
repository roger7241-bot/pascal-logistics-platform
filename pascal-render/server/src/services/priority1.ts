// ============================================================================
// PRIORITY1 LTL RATE QUOTE CLIENT
// Real Priority1 API integration for live LTL rate quotes. Requires
// PRIORITY1_API_KEY env var — falls back to a console-logged simulation
// with no live carriers when the key isn't configured, so local
// development and sandbox environments don't hard-fail. The moment the
// key is provisioned in Render, the same call path returns real
// carrier/rate data with no code change.
//
// Base URL and auth scheme confirmed against the Priority1 spec at
// https://api.priority1.com/docs/v2/ — X-API-KEY header, no OAuth.
// ============================================================================

const PRIORITY1_API_KEY = process.env.PRIORITY1_API_KEY;
const PRIORITY1_BASE_URL = process.env.PRIORITY1_BASE_URL ?? "https://api.priority1.com";
const PRIORITY1_DEMO_MODE = (process.env.PRIORITY1_DEMO_MODE ?? "").toLowerCase() === "true";

// Demo carrier roster — real US LTL carrier names, per-carrier price
// multipliers around a computed lane base. Used only when
// PRIORITY1_DEMO_MODE is on AND PRIORITY1_API_KEY is missing, so a real
// key always beats demo mode (impossible to leave demo on by accident
// once you've wired a live vendor).
const DEMO_CARRIERS: Array<{ carrierName: string; serviceLevel: string; transitDays: number; multiplier: number }> = [
  { carrierName: "SAIA Motor Freight", serviceLevel: "Standard LTL", transitDays: 3, multiplier: 0.88 },
  { carrierName: "XPO Logistics", serviceLevel: "Standard LTL", transitDays: 3, multiplier: 0.92 },
  { carrierName: "Estes Express", serviceLevel: "Standard LTL", transitDays: 4, multiplier: 0.96 },
  { carrierName: "R+L Carriers", serviceLevel: "Standard LTL", transitDays: 3, multiplier: 1.02 },
  { carrierName: "Old Dominion", serviceLevel: "Guaranteed LTL", transitDays: 2, multiplier: 1.14 },
];

export interface Priority1LineItem {
  freightClass: string;
  packagingType: string;
  units: number;
  pieces: number;
  totalWeightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  nmfcNumber?: string;
  hazmat?: boolean;
}

export interface Priority1RateRequest {
  originZipCode: string;
  destinationZipCode: string;
  pickupDate: string;
  items: Priority1LineItem[];
}

export interface Priority1RateQuote {
  carrierName: string;
  serviceLevel?: string;
  transitDays?: number;
  totalUsd: number;
  baseCostUsd?: number;
  fuelSurchargeUsd?: number;
  accessorialsUsd?: number;
  expirationDateIso?: string;
  quoteReference?: string;
}

export interface Priority1RateResponse {
  quotes: Priority1RateQuote[];
  simulated: boolean;
  demo?: boolean;
  error?: string;
}

// Deterministic "distance" proxy from ZIP codes — first two digits of a
// US ZIP encode SCF sortation region, close enough to a cost-of-lane
// signal for demo purposes. Canadian postal codes (letter-number-letter)
// hash to a stable pseudo-region so the same lane returns the same
// rates across page refreshes.
function laneDistanceScore(originZip: string, destinationZip: string): number {
  function scfDigits(zip: string): number {
    const digits = zip.replace(/\D/g, "");
    if (digits.length >= 2) return Number(digits.slice(0, 2));
    // Canadian / non-numeric — hash to a 0-99 pseudo-region
    let h = 0;
    for (const c of zip.toUpperCase()) h = (h * 31 + c.charCodeAt(0)) % 99;
    return h;
  }
  return Math.abs(scfDigits(originZip) - scfDigits(destinationZip));
}

function buildDemoQuotes(request: Priority1RateRequest): Priority1RateQuote[] {
  const totalWeight = request.items.reduce((sum, it) => sum + it.totalWeightLbs, 0) || 100;
  const avgClass = request.items.reduce((sum, it) => sum + (Number(it.freightClass) || 100), 0) / request.items.length;
  const distanceScore = laneDistanceScore(request.originZipCode, request.destinationZipCode);

  // Base = fixed floor + weight component + distance component + class component.
  // Numbers tuned to land in a realistic $500-$2500 range for typical LTL loads.
  const base = 220 + (totalWeight * 0.85) + (distanceScore * 12) + (avgClass * 1.4);
  const pickup = new Date(request.pickupDate);
  const expiration = new Date(pickup.getTime());
  expiration.setDate(expiration.getDate() + 14);

  return DEMO_CARRIERS.map((c) => {
    const total = Math.round(base * c.multiplier * 100) / 100;
    const fuelSurcharge = Math.round(total * 0.18 * 100) / 100;
    return {
      carrierName: c.carrierName,
      serviceLevel: c.serviceLevel,
      transitDays: c.transitDays,
      totalUsd: total,
      baseCostUsd: Math.round((total - fuelSurcharge) * 100) / 100,
      fuelSurchargeUsd: fuelSurcharge,
      accessorialsUsd: 0,
      expirationDateIso: expiration.toISOString(),
      quoteReference: `DEMO-${c.carrierName.split(" ")[0].toUpperCase()}-${Date.now().toString(36).slice(-6)}`,
    };
  });
}

interface RawRateQuoteDetail {
  total?: number;
  baseCost?: number;
  fuelSurcharge?: number;
  accessorials?: number;
  itemizedCharges?: Array<{ description?: string; amount?: number }>;
}

interface RawRateQuote {
  carrierName?: string;
  serviceLevel?: string;
  transitDays?: number;
  expirationDate?: string;
  quoteReference?: string;
  rateQuoteDetail?: RawRateQuoteDetail;
}

interface RawRateResponse {
  rateQuotes?: RawRateQuote[];
  error?: string;
  message?: string;
}

function normalizeQuote(raw: RawRateQuote): Priority1RateQuote {
  const detail = raw.rateQuoteDetail ?? {};
  return {
    carrierName: raw.carrierName ?? "Unknown Carrier",
    serviceLevel: raw.serviceLevel,
    transitDays: raw.transitDays,
    totalUsd: Number(detail.total ?? 0),
    baseCostUsd: detail.baseCost !== undefined ? Number(detail.baseCost) : undefined,
    fuelSurchargeUsd: detail.fuelSurcharge !== undefined ? Number(detail.fuelSurcharge) : undefined,
    accessorialsUsd: detail.accessorials !== undefined ? Number(detail.accessorials) : undefined,
    expirationDateIso: raw.expirationDate,
    quoteReference: raw.quoteReference,
  };
}

export async function getPriority1LtlRates(request: Priority1RateRequest): Promise<Priority1RateResponse> {
  if (!PRIORITY1_API_KEY && PRIORITY1_DEMO_MODE) {
    console.log(`[DEMO Priority1 — PRIORITY1_DEMO_MODE=true, no live key] LTL rate request ${request.originZipCode} -> ${request.destinationZipCode}`);
    return { quotes: buildDemoQuotes(request), simulated: true, demo: true };
  }

  if (!PRIORITY1_API_KEY) {
    console.log(`[SIMULATED Priority1 — no PRIORITY1_API_KEY configured] LTL rate request ${request.originZipCode} -> ${request.destinationZipCode}`);
    return { quotes: [], simulated: true };
  }

  const payload = {
    originZipCode: request.originZipCode,
    destinationZipCode: request.destinationZipCode,
    pickupDate: request.pickupDate,
    items: request.items.map((item) => ({
      freightClass: item.freightClass,
      packagingType: item.packagingType,
      units: item.units,
      pieces: item.pieces,
      totalWeight: item.totalWeightLbs,
      length: item.lengthIn,
      width: item.widthIn,
      height: item.heightIn,
      nmfcNumber: item.nmfcNumber,
      hazmat: item.hazmat ?? false,
    })),
  };

  try {
    const response = await fetch(`${PRIORITY1_BASE_URL}/v2/ltl/quotes/rates`, {
      method: "POST",
      headers: {
        "X-API-KEY": PRIORITY1_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "message" in body ? String((body as RawRateResponse).message) : `Priority1 ${response.status}`;
      console.error(`Priority1 rate request failed: ${message}`);
      return { quotes: [], simulated: false, error: message };
    }

    const parsed = body as RawRateResponse;
    const rawQuotes = Array.isArray(parsed.rateQuotes) ? parsed.rateQuotes : [];
    return { quotes: rawQuotes.map(normalizeQuote), simulated: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Priority1 error";
    console.error(`Priority1 rate request threw: ${message}`);
    return { quotes: [], simulated: false, error: message };
  }
}
