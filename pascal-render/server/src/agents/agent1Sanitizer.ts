// ============================================================================
// AGENT 1 — DATA SANITIZATION & NORMALIZATION
// Normalizes phone numbers to E.164, validates postal/ZIP format by country,
// and flags missing party fields. Deterministic, auditable — no LLM call.
// ============================================================================

import type { PartyDetails } from "../types/shipment.js";

export function normalizePhoneE164(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined; // couldn't confidently normalize — leave unset rather than guess wrong
}

export function isValidPostalCode(postalCode: string | undefined, countryCode: string | undefined): boolean {
  if (!postalCode) return false;
  if (countryCode === "CA") return /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(postalCode);
  if (countryCode === "US") return /^\d{5}(-\d{4})?$/.test(postalCode);
  return postalCode.trim().length >= 3; // unknown country — accept anything non-trivial
}

export interface SanitizedParty extends PartyDetails {
  addressComplete: boolean;
  contactComplete: boolean;
}

export function sanitizeParty(party: PartyDetails): SanitizedParty {
  const phoneE164 = normalizePhoneE164(party.phoneE164);
  const addressComplete = Boolean(party.street && party.city && party.countryCode && isValidPostalCode(party.postalCode, party.countryCode));
  const contactComplete = Boolean(party.facilityName && phoneE164);

  return {
    ...party,
    phoneE164,
    addressComplete,
    contactComplete,
  };
}
