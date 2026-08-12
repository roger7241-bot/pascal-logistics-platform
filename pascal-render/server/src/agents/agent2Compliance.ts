// ============================================================================
// AGENT 2 — CUSTOMS & REGULATORY COMPLIANCE AUDIT
// HTS classification depth check, USMCA/CUSMA qualification, PGA flag
// validation, and hazmat completeness. Deterministic rule engine.
// ============================================================================

import type { CustomsDetails, CargoDetails } from "../types/shipment.js";

const USMCA_COUNTRIES = new Set(["US", "CA", "MX"]);

export interface ComplianceAuditResult {
  htsDigitDepth: number;
  htsValid: boolean;
  usmcaQualifies: boolean;
  usmcaReasoning: string;
  hazmatComplete: boolean;
  flags: string[];
}

function htsDigitDepth(htsCode: string | undefined): number {
  if (!htsCode) return 0;
  return htsCode.replace(/\D/g, "").length;
}

export function auditCompliance(customs: CustomsDetails, cargo: CargoDetails): ComplianceAuditResult {
  const flags: string[] = [];
  const digitDepth = htsDigitDepth(customs.htsCode);
  const htsValid = digitDepth >= 6 && digitDepth <= 10;

  if (!htsValid && customs.htsCode) {
    flags.push(`HTS code "${customs.htsCode}" does not resolve to a valid 6-10 digit classification`);
  }

  const originIsUsmca = customs.countryOfOrigin ? USMCA_COUNTRIES.has(customs.countryOfOrigin.toUpperCase()) : false;
  const usmcaQualifies = originIsUsmca && digitDepth >= 8;
  const usmcaReasoning = !originIsUsmca
    ? "Origin country is not a USMCA/CUSMA party — does not qualify."
    : digitDepth < 8
    ? `HTS classification only reached ${digitDepth} digits — need at least 8-digit depth to support a rule-of-origin determination.`
    : "Origin confirmed USMCA/CUSMA party and HTS classified to sufficient depth — eligible for certificate generation.";

  // PGA flag validation: if cargo composition suggests a PGA-regulated
  // category but no flag was set, surface it as a compliance gap rather
  // than silently letting it through.
  if (cargo.isHazmat && !customs.pgaFlags.includes("DOT")) {
    flags.push("Hazmat shipment declared but DOT PGA flag not set — verify placarding/routing requirements.");
  }

  const hazmatComplete = !cargo.isHazmat
    ? true
    : Boolean(cargo.hazmat?.unNumber && cargo.hazmat?.hazardClass && cargo.hazmat?.emergencyPhone && cargo.hazmat?.sdsAttached);

  if (cargo.isHazmat && !hazmatComplete) {
    flags.push("Hazmat declared but one or more required fields (UN number, hazard class, emergency phone, SDS) are missing");
  }

  return {
    htsDigitDepth: digitDepth,
    htsValid,
    usmcaQualifies,
    usmcaReasoning,
    hazmatComplete,
    flags,
  };
}
