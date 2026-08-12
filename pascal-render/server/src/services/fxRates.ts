// ============================================================================
// FX RATES
// Real fetch to Frankfurter (frankfurter.app) — a free, keyless, public
// exchange-rate API run on official ECB reference rates. No API key
// required, which matters here since this needs to work without asking
// for another credential. Falls back to a clearly-labeled static rate
// table when the live call fails (network unavailable, service down) —
// same honest real/fallback pattern as every other external integration
// in this platform. The static numbers are NOT invented as "live" data;
// the response always says which one actually happened.
// ============================================================================

export interface FxRates {
  base: "USD";
  rates: { CAD: number; USD: number; MXN: number };
  isLive: boolean;
  fetchedAtIso: string;
  source: string;
}

// Static fallback — approximate rates as of this build, clearly not live.
const FALLBACK_RATES: FxRates["rates"] = { CAD: 1.38, USD: 1, MXN: 18.5 };

let cached: FxRates | undefined;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes — avoids hammering a free public API on every request

export async function getFxRates(): Promise<FxRates> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=USD&to=CAD,MXN");
    if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
    const data = (await response.json()) as { rates: { CAD: number; MXN: number } };

    const result: FxRates = {
      base: "USD",
      rates: { USD: 1, CAD: data.rates.CAD, MXN: data.rates.MXN },
      isLive: true,
      fetchedAtIso: new Date().toISOString(),
      source: "frankfurter.app (ECB reference rates)",
    };
    cached = result;
    cachedAt = Date.now();
    return result;
  } catch (err) {
    // Real fallback, not a fabricated "live" number — the response is
    // honest about which path actually ran.
    console.error(`FX rate fetch failed, using static fallback: ${err instanceof Error ? err.message : "unknown error"}`);
    const result: FxRates = {
      base: "USD",
      rates: FALLBACK_RATES,
      isLive: false,
      fetchedAtIso: new Date().toISOString(),
      source: "static fallback table (live fetch failed)",
    };
    cached = result;
    cachedAt = Date.now();
    return result;
  }
}

export function convertFromUsd(amountUsd: number, targetCurrency: "CAD" | "USD" | "MXN", rates: FxRates): number {
  return Math.round(amountUsd * rates.rates[targetCurrency] * 100) / 100;
}
