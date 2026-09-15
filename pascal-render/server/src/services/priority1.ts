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
  error?: string;
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
