// ============================================================================
// ADDRESS AUTOCOMPLETE — TomTom Search API (Fuzzy Search with typeahead)
// for the Book a Shipment wizard's manual-entry address fields. Requires
// TOMTOM_API_KEY (provisioned as sync:false in render.yaml). No credit
// card required for TomTom's free tier, unlike Google Places.
// Falls back to an honest empty-results response when no API key is
// configured, same pattern as Twilio/AgentMail/S3 elsewhere in this
// platform — never fabricates address suggestions.
// ============================================================================

const apiKey = process.env.TOMTOM_API_KEY;

export interface AddressSuggestion {
  freeformAddress: string;
  streetNumber?: string;
  streetName?: string;
  municipality?: string; // city
  countrySubdivisionCode?: string; // state/province, e.g. "BC", "WA"
  postalCode?: string;
  countryCode?: string; // "CA" | "US" | ...
}

export interface AddressAutocompleteResult {
  suggestions: AddressSuggestion[];
  simulated: boolean;
}

/** countrySet restricts results to specific countries (comma-separated
 * ISO codes) — used to bias toward CA/US given Pascal's corridor, without
 * hard-blocking other countries entirely. */
export async function searchAddresses(query: string, countrySet = "CA,US,MX"): Promise<AddressAutocompleteResult> {
  if (!apiKey) {
    console.log(`[SIMULATED ADDRESS AUTOCOMPLETE — no TOMTOM_API_KEY configured] Query: "${query}"`);
    return { suggestions: [], simulated: true };
  }
  if (query.trim().length < 3) return { suggestions: [], simulated: false };

  try {
    const url = new URL(`https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("typeahead", "true");
    url.searchParams.set("countrySet", countrySet);
    url.searchParams.set("limit", "5");
    url.searchParams.set("idxSet", "Addr"); // addresses only — excludes POIs/businesses

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`TomTom API returned ${response.status}`);
    const data = (await response.json()) as { results?: Array<{ address?: Record<string, string> }> };

    const suggestions: AddressSuggestion[] = (data.results ?? [])
      .map((r) => r.address)
      .filter((a): a is Record<string, string> => Boolean(a))
      .map((a) => ({
        freeformAddress: a.freeformAddress,
        streetNumber: a.streetNumber,
        streetName: a.streetName,
        municipality: a.municipality,
        countrySubdivisionCode: a.countrySubdivisionCode,
        postalCode: a.postalCode,
        countryCode: a.countryCode,
      }));

    return { suggestions, simulated: false };
  } catch (err) {
    console.error(`Address autocomplete failed: ${err instanceof Error ? err.message : "unknown error"}`);
    return { suggestions: [], simulated: false };
  }
}
