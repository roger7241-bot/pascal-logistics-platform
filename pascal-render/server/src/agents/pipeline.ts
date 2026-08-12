// ============================================================================
// PIPELINE ORCHESTRATOR
// Runs Agents 1-4 in sequence against an inbound NewShipmentPayload,
// computes a weighted confidence score, and decides the approval routing —
// AUTO_DISPATCHED at >= 0.90, otherwise PENDING_ROGER_APPROVAL for the
// Executive Review Drawer.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { NewShipmentPayload, PipelineResult } from "../types/shipment.js";
import { sanitizeParty } from "./agent1Sanitizer.js";
import { auditCompliance } from "./agent2Compliance.js";
import { optimizeRate } from "./agent3RateOptimization.js";
import { recommendEquipment } from "./agent4Equipment.js";

const CONFIDENCE_THRESHOLD = 0.9;

interface ConfidenceCheck {
  ok: boolean;
  weight: number;
  label: string;
}

function computeConfidence(payload: NewShipmentPayload, complianceFlags: string[]): { score: number; errors: string[] } {
  const shipper = sanitizeParty(payload.shipper);
  const consignee = sanitizeParty(payload.consignee);

  const checks: ConfidenceCheck[] = [
    { ok: shipper.contactComplete, weight: 1, label: "Shipper contact details" },
    { ok: shipper.addressComplete, weight: 1, label: "Shipper complete address" },
    { ok: consignee.contactComplete, weight: 1, label: "Consignee contact details" },
    { ok: consignee.addressComplete, weight: 1, label: "Consignee complete address" },
    { ok: payload.cargo.handlingUnits.length > 0, weight: 1, label: "Handling units" },
    { ok: !!payload.cargo.totalWeightLbs, weight: 1, label: "Total weight" },
    { ok: !!payload.customs.portOfEntry, weight: 1, label: "Port of entry" },
    { ok: !!payload.customs.commercialInvoiceValue, weight: 1, label: "Commercial invoice value" },
    { ok: !!payload.customs.htsCode, weight: 1.5, label: "10-digit HTS/HS code" },
    { ok: !!payload.customs.countryOfOrigin, weight: 1, label: "Country of origin" },
    { ok: !!payload.customs.importerTaxId, weight: 1, label: "Importer tax ID" },
    { ok: complianceFlags.length === 0, weight: 1.5, label: "Compliance audit clean (no flags)" },
  ];

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const achievedWeight = checks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0);
  const errors = checks.filter((c) => !c.ok).map((c) => c.label);

  return { score: Math.round((achievedWeight / totalWeight) * 100) / 100, errors };
}

export function runPipeline(payload: NewShipmentPayload): PipelineResult {
  // Agent 1
  const shipper = sanitizeParty(payload.shipper);
  const consignee = sanitizeParty(payload.consignee);

  // Agent 2
  const compliance = auditCompliance(payload.customs, payload.cargo);

  // Agent 3
  const rateOptimization = optimizeRate(payload.cargo, payload.customs);

  // Agent 4
  const equipmentRecommendation = recommendEquipment(payload.cargo);

  const { score: confidenceScore, errors: validationErrors } = computeConfidence(payload, compliance.flags);
  const approvalStatus = confidenceScore >= CONFIDENCE_THRESHOLD ? "AUTO_DISPATCHED" : "PENDING_ROGER_APPROVAL";

  return {
    shipmentId: `SHIP-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
    payload: {
      ...payload,
      shipper: { ...payload.shipper, ...shipper },
      consignee: { ...payload.consignee, ...consignee },
    },
    confidenceScore,
    validationErrors,
    approvalStatus,
    // Mandatory literal-type gate, mirroring Agent 9's approval contract
    // elsewhere in this platform: an unapproved payload can never carry
    // autoActionExecuted: true, enforced by the type system as well as here.
    autoActionExecuted: approvalStatus === "AUTO_DISPATCHED",
    complianceFlags: compliance.flags,
    rateOptimization,
    equipmentRecommendation,
    createdAtIso: new Date().toISOString(),
  };
}
