// ============================================================================
// DOCUMENT GENERATION ROUTES — BOL / Commercial Invoice / USMCA cert
// Client + operator both mount the same handler under their scope.
// Returns application/pdf so the browser triggers a download.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { generateBol, generateCommercialInvoice, generateUsmcaCert,
  type BolInput, type CommercialInvoiceInput, type UsmcaCertInput,
} from "../services/documentGeneration.js";
import { pool } from "../db/pool.js";

function resolveOrgId(req: Request, allowQueryOverride: boolean): string | undefined {
  if (allowQueryOverride && req.authUser?.role === "operator") {
    const q = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    return q ?? req.authUser?.orgId ?? undefined;
  }
  return req.authUser?.orgId ?? undefined;
}

async function sendPdf(res: Response, filename: string, bytes: Uint8Array) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).end(Buffer.from(bytes));
}

export function createDocGenRouter(scope: "operator" | "client"): Router {
  const router = Router();
  const allowQueryOverride = scope === "operator";

  router.post("/documents/generate/bol", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.bolNumber || !b.shipper?.name || !b.consignee?.name || !b.carrierName || !Array.isArray(b.lines) || b.lines.length === 0) {
      return res.status(400).json({ error: "bolNumber, shipper.name, consignee.name, carrierName, lines[] required." });
    }
    const input: BolInput = {
      bolNumber: String(b.bolNumber),
      shipDate: String(b.shipDate ?? new Date().toISOString().slice(0, 10)),
      shipper: b.shipper,
      consignee: b.consignee,
      billTo: b.billTo,
      carrierName: String(b.carrierName),
      carrierScac: b.carrierScac ? String(b.carrierScac) : undefined,
      proNumber: b.proNumber ? String(b.proNumber) : undefined,
      poNumber: b.poNumber ? String(b.poNumber) : undefined,
      lines: b.lines,
      freightTermsPrepaidOrCollect: ["prepaid", "collect", "third_party"].includes(b.freightTermsPrepaidOrCollect) ? b.freightTermsPrepaidOrCollect : "prepaid",
      codAmountUsd: typeof b.codAmountUsd === "number" ? b.codAmountUsd : undefined,
      specialInstructions: b.specialInstructions ? String(b.specialInstructions) : undefined,
      isHazmat: b.isHazmat === true,
      emergencyContactPhone: b.emergencyContactPhone ? String(b.emergencyContactPhone) : undefined,
    };
    try {
      const bytes = await generateBol(input);
      // Log the generation to activity_log so the operator inbox sees it.
      const orgId = resolveOrgId(req, allowQueryOverride);
      void pool.query(
        `INSERT INTO activity_log (event_type, shipment_id, message, metadata)
         VALUES ('bol_generated', $1, $2, $3::jsonb)`,
        [b.bolNumber, `BOL generated for ${input.shipper.name} → ${input.consignee.name}`, JSON.stringify({ orgId, bolNumber: input.bolNumber })],
      ).catch((err) => console.error("BOL activity log failed:", err));
      return sendPdf(res, `BOL_${input.bolNumber}.pdf`, bytes);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "BOL generation failed." });
    }
  });

  router.post("/documents/generate/commercial-invoice", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.invoiceNumber || !b.soldBy?.name || !b.soldTo?.name || !b.shipTo?.name || !Array.isArray(b.lines) || b.lines.length === 0) {
      return res.status(400).json({ error: "invoiceNumber, soldBy.name, soldTo.name, shipTo.name, lines[] required." });
    }
    const input: CommercialInvoiceInput = {
      invoiceNumber: String(b.invoiceNumber),
      invoiceDate: String(b.invoiceDate ?? new Date().toISOString().slice(0, 10)),
      soldBy: b.soldBy,
      soldTo: b.soldTo,
      shipTo: b.shipTo,
      incoterm: String(b.incoterm ?? "FOB"),
      incotermPlace: String(b.incotermPlace ?? ""),
      currency: String(b.currency ?? "USD"),
      countryOfExport: b.countryOfExport ? String(b.countryOfExport) : undefined,
      countryOfManufacture: b.countryOfManufacture ? String(b.countryOfManufacture) : undefined,
      reasonForExport: b.reasonForExport ? String(b.reasonForExport) : undefined,
      lines: b.lines,
      totalPieces: Number(b.totalPieces ?? 0),
      totalWeightKg: Number(b.totalWeightKg ?? 0),
      totalValueUsd: Number(b.totalValueUsd ?? 0),
      freightChargeUsd: typeof b.freightChargeUsd === "number" ? b.freightChargeUsd : undefined,
      insuranceChargeUsd: typeof b.insuranceChargeUsd === "number" ? b.insuranceChargeUsd : undefined,
      declarationLine: b.declarationLine ? String(b.declarationLine) : undefined,
    };
    try {
      const bytes = await generateCommercialInvoice(input);
      return sendPdf(res, `CommercialInvoice_${input.invoiceNumber}.pdf`, bytes);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Commercial invoice generation failed." });
    }
  });

  router.post("/documents/generate/usmca-cert", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.certifierParty?.name || !Array.isArray(b.goods) || b.goods.length === 0 || !b.authorizedSignatoryName) {
      return res.status(400).json({ error: "certifierParty.name, goods[], authorizedSignatoryName required." });
    }
    const validCertifier = ["importer", "exporter", "producer"];
    const input: UsmcaCertInput = {
      certifierType: validCertifier.includes(b.certifierType) ? b.certifierType : "exporter",
      certifierParty: b.certifierParty,
      producerParty: b.producerParty,
      exporterParty: b.exporterParty,
      importerParty: b.importerParty,
      blanketPeriodStart: b.blanketPeriodStart ? String(b.blanketPeriodStart) : undefined,
      blanketPeriodEnd: b.blanketPeriodEnd ? String(b.blanketPeriodEnd) : undefined,
      goods: b.goods,
      authorizedSignatoryName: String(b.authorizedSignatoryName),
      authorizedSignatoryTitle: b.authorizedSignatoryTitle ? String(b.authorizedSignatoryTitle) : undefined,
      signedOn: String(b.signedOn ?? new Date().toISOString().slice(0, 10)),
    };
    try {
      const bytes = await generateUsmcaCert(input);
      return sendPdf(res, `USMCA_Cert_${input.certifierParty.name.replace(/[^A-Za-z0-9]/g, "_")}.pdf`, bytes);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "USMCA cert generation failed." });
    }
  });

  return router;
}
