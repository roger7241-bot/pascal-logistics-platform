// ============================================================================
// DOCUMENT GENERATION — BOL, Commercial Invoice, USMCA cert
// Uses pdf-lib (already installed) to compose the three highest-volume
// documents SMB shippers actually ask us to produce. Layout is functional
// legal-form clean, not fancy — this replaces the "email me a template
// I'll fill in" flow with a fillable PDF the operator or client generates
// from shipment data in one click.
//
// Bill of Lading — VICS-style straight-BOL layout: shipper, consignee,
//   carrier, freight description, weight, class, hazmat flag, terms.
// Commercial Invoice — customs-compliant: sold-by, sold-to, ship-to,
//   line items with HS + country of origin, incoterm, currency,
//   total value declaration + signature block.
// USMCA Certificate of Origin — the four-section producer/exporter/
//   importer/goods layout CBP + CBSA accept. Blanket period supported.
// ============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

type Party = {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  taxId?: string;
};

type FreightLine = {
  pieces: number;
  packageType?: string;           // pallets / cartons / drums
  description: string;
  weightLb?: number;
  weightKg?: number;
  nmfcClass?: string;
  hazmatUn?: string;
  hsCode?: string;
  countryOfOrigin?: string;
  unitValueUsd?: number;
  totalValueUsd?: number;
};

export interface BolInput {
  bolNumber: string;
  shipDate: string;                       // YYYY-MM-DD
  shipper: Party;
  consignee: Party;
  billTo?: Party;
  carrierName: string;
  carrierScac?: string;
  proNumber?: string;
  poNumber?: string;
  lines: FreightLine[];
  freightTermsPrepaidOrCollect: "prepaid" | "collect" | "third_party";
  codAmountUsd?: number;
  specialInstructions?: string;
  isHazmat?: boolean;
  emergencyContactPhone?: string;
}

export interface CommercialInvoiceInput {
  invoiceNumber: string;
  invoiceDate: string;
  soldBy: Party;
  soldTo: Party;
  shipTo: Party;
  incoterm: "EXW" | "FOB" | "CIF" | "DAP" | "DDP" | string;
  incotermPlace: string;
  currency: string;
  countryOfExport?: string;
  countryOfManufacture?: string;
  reasonForExport?: string;               // "sale" | "sample" | "return"
  lines: FreightLine[];
  totalPieces: number;
  totalWeightKg: number;
  totalValueUsd: number;
  freightChargeUsd?: number;
  insuranceChargeUsd?: number;
  declarationLine?: string;
}

export interface UsmcaCertInput {
  certifierType: "importer" | "exporter" | "producer";
  certifierParty: Party;
  producerParty?: Party;
  exporterParty?: Party;
  importerParty?: Party;
  blanketPeriodStart?: string;            // YYYY-MM-DD
  blanketPeriodEnd?: string;
  goods: Array<{
    description: string;
    hsCode: string;
    originCriterion: "A" | "B" | "C" | "D";
    countryOfOrigin: string;
  }>;
  authorizedSignatoryName: string;
  authorizedSignatoryTitle?: string;
  signedOn: string;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
const PAGE_W = 612;                       // US Letter
const PAGE_H = 792;
const MARGIN = 40;
const LINE_GAP = 4;

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
}

function drawText(ctx: Ctx, text: string, opts: { size?: number; bold?: boolean; x?: number; maxWidth?: number } = {}) {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.font;
  ctx.page.drawText(text.slice(0, opts.maxWidth ?? 400), {
    x: opts.x ?? MARGIN,
    y: ctx.y,
    size,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  ctx.y -= size + LINE_GAP;
}

function drawSectionHeader(ctx: Ctx, label: string) {
  ctx.y -= 6;
  ctx.page.drawRectangle({ x: MARGIN - 2, y: ctx.y - 4, width: PAGE_W - MARGIN * 2 + 4, height: 16, color: rgb(0.92, 0.92, 0.94) });
  drawText(ctx, label, { size: 10, bold: true });
  ctx.y -= 2;
}

function drawParty(ctx: Ctx, party: Party, xOffset = 0, colWidth = 250) {
  const startY = ctx.y;
  const drawLine = (text: string, bold = false) => {
    ctx.page.drawText(text.slice(0, colWidth / 5), {
      x: MARGIN + xOffset,
      y: ctx.y,
      size: 9,
      font: bold ? ctx.bold : ctx.font,
      color: rgb(0.1, 0.1, 0.1),
    });
    ctx.y -= 11;
  };
  drawLine(party.name, true);
  if (party.address) drawLine(party.address);
  const cityLine = [party.city, party.state, party.postalCode].filter(Boolean).join(", ");
  if (cityLine) drawLine(cityLine);
  if (party.country) drawLine(party.country);
  if (party.contactName) drawLine(`Contact: ${party.contactName}`);
  if (party.contactPhone) drawLine(`Ph: ${party.contactPhone}`);
  if (party.contactEmail) drawLine(party.contactEmail);
  if (party.taxId) drawLine(`Tax ID: ${party.taxId}`);
  return startY;
}

async function newDoc(): Promise<{ doc: PDFDocument; page: PDFPage; font: PDFFont; bold: PDFFont }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, page, font, bold };
}

// ---------------------------------------------------------------------------
// Bill of Lading
// ---------------------------------------------------------------------------
export async function generateBol(input: BolInput): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDoc();
  const ctx: Ctx = { page, font, bold, y: PAGE_H - MARGIN };

  drawText(ctx, "BILL OF LADING", { size: 18, bold: true });
  drawText(ctx, `BOL #: ${input.bolNumber}   Ship date: ${input.shipDate}`, { size: 10 });
  if (input.proNumber) drawText(ctx, `PRO #: ${input.proNumber}   PO #: ${input.poNumber ?? "—"}`, { size: 10 });

  drawSectionHeader(ctx, "SHIPPER");
  drawParty(ctx, input.shipper);
  ctx.y -= 4;

  drawSectionHeader(ctx, "CONSIGNEE");
  drawParty(ctx, input.consignee);
  ctx.y -= 4;

  if (input.billTo) {
    drawSectionHeader(ctx, "BILL TO");
    drawParty(ctx, input.billTo);
    ctx.y -= 4;
  }

  drawSectionHeader(ctx, "CARRIER");
  drawText(ctx, `${input.carrierName}${input.carrierScac ? `  (SCAC: ${input.carrierScac})` : ""}`, { size: 10 });
  drawText(ctx, `Freight terms: ${input.freightTermsPrepaidOrCollect.replace(/_/g, " ")}${input.codAmountUsd ? `   COD: $${input.codAmountUsd.toLocaleString()}` : ""}`, { size: 10 });

  drawSectionHeader(ctx, "FREIGHT DESCRIPTION");
  drawText(ctx, "Pieces  Type       Description                            Weight       NMFC   HazMat", { size: 9, bold: true });
  for (const l of input.lines) {
    const row = [
      String(l.pieces).padEnd(7),
      (l.packageType ?? "").padEnd(11),
      l.description.slice(0, 40).padEnd(40),
      `${l.weightLb ?? Math.round((l.weightKg ?? 0) * 2.20462)} lb`.padEnd(12),
      (l.nmfcClass ?? "").padEnd(7),
      l.hazmatUn ?? "",
    ].join(" ");
    drawText(ctx, row, { size: 9 });
  }
  const totalWeightLb = input.lines.reduce((sum, l) => sum + (l.weightLb ?? Math.round((l.weightKg ?? 0) * 2.20462)), 0);
  const totalPieces = input.lines.reduce((sum, l) => sum + l.pieces, 0);
  drawText(ctx, `Total: ${totalPieces} pieces, ${totalWeightLb} lb`, { size: 10, bold: true });

  if (input.isHazmat) {
    drawSectionHeader(ctx, "HAZARDOUS MATERIALS");
    drawText(ctx, "This shipment contains hazardous materials. Emergency response contact:", { size: 9 });
    drawText(ctx, input.emergencyContactPhone ?? "[REQUIRED — insert 24/7 emergency contact phone]", { size: 10, bold: true });
  }

  if (input.specialInstructions) {
    drawSectionHeader(ctx, "SPECIAL INSTRUCTIONS");
    drawText(ctx, input.specialInstructions, { size: 9 });
  }

  ctx.y = 90;
  drawSectionHeader(ctx, "SIGNATURES");
  drawText(ctx, "Shipper signature: ________________________   Date: __________", { size: 9 });
  drawText(ctx, "Driver signature:  ________________________   Date: __________", { size: 9 });
  drawText(ctx, "Consignee sig:     ________________________   Date: __________", { size: 9 });

  drawText(ctx, "Generated by Pascal Logistics — pascallogistics.com", { size: 8, x: MARGIN });
  return await doc.save();
}

// ---------------------------------------------------------------------------
// Commercial Invoice
// ---------------------------------------------------------------------------
export async function generateCommercialInvoice(input: CommercialInvoiceInput): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDoc();
  const ctx: Ctx = { page, font, bold, y: PAGE_H - MARGIN };

  drawText(ctx, "COMMERCIAL INVOICE", { size: 18, bold: true });
  drawText(ctx, `Invoice #: ${input.invoiceNumber}   Date: ${input.invoiceDate}   Currency: ${input.currency}`, { size: 10 });
  drawText(ctx, `Incoterm: ${input.incoterm} ${input.incotermPlace}   Reason: ${input.reasonForExport ?? "sale"}`, { size: 10 });

  drawSectionHeader(ctx, "SOLD BY (Exporter)");
  drawParty(ctx, input.soldBy);
  ctx.y -= 4;

  drawSectionHeader(ctx, "SOLD TO (Importer)");
  drawParty(ctx, input.soldTo);
  ctx.y -= 4;

  drawSectionHeader(ctx, "SHIP TO");
  drawParty(ctx, input.shipTo);
  ctx.y -= 4;

  drawSectionHeader(ctx, "GOODS DESCRIPTION");
  drawText(ctx, "Qty   Description                       HS Code       Origin    Unit $    Line $", { size: 9, bold: true });
  for (const l of input.lines) {
    const row = [
      String(l.pieces).padEnd(5),
      l.description.slice(0, 32).padEnd(34),
      (l.hsCode ?? "").padEnd(14),
      (l.countryOfOrigin ?? "").padEnd(10),
      l.unitValueUsd ? `$${l.unitValueUsd.toFixed(2)}`.padEnd(10) : "".padEnd(10),
      l.totalValueUsd ? `$${l.totalValueUsd.toFixed(2)}` : "",
    ].join(" ");
    drawText(ctx, row, { size: 9 });
  }

  drawSectionHeader(ctx, "TOTALS");
  drawText(ctx, `Total pieces: ${input.totalPieces}   Total weight: ${input.totalWeightKg} kg`, { size: 10 });
  drawText(ctx, `Goods value:        $${input.totalValueUsd.toLocaleString()} ${input.currency}`, { size: 10 });
  if (input.freightChargeUsd) drawText(ctx, `Freight:            $${input.freightChargeUsd.toLocaleString()} ${input.currency}`, { size: 10 });
  if (input.insuranceChargeUsd) drawText(ctx, `Insurance:          $${input.insuranceChargeUsd.toLocaleString()} ${input.currency}`, { size: 10 });
  const grand = input.totalValueUsd + (input.freightChargeUsd ?? 0) + (input.insuranceChargeUsd ?? 0);
  drawText(ctx, `INVOICE TOTAL:      $${grand.toLocaleString()} ${input.currency}`, { size: 11, bold: true });

  drawSectionHeader(ctx, "DECLARATION");
  drawText(ctx, input.declarationLine ?? "I declare the information contained on this invoice is true and correct.", { size: 9 });

  ctx.y = 100;
  drawText(ctx, "Authorized signature: ________________________   Date: __________", { size: 9 });
  drawText(ctx, "Generated by Pascal Logistics — pascallogistics.com", { size: 8 });
  return await doc.save();
}

// ---------------------------------------------------------------------------
// USMCA Certification of Origin
// ---------------------------------------------------------------------------
export async function generateUsmcaCert(input: UsmcaCertInput): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDoc();
  const ctx: Ctx = { page, font, bold, y: PAGE_H - MARGIN };

  drawText(ctx, "USMCA CERTIFICATION OF ORIGIN", { size: 16, bold: true });
  drawText(ctx, "Data elements per USMCA Article 5.2 — accepted by CBP and CBSA.", { size: 9 });

  drawSectionHeader(ctx, "1. CERTIFIER");
  drawText(ctx, `Certifier is: ${input.certifierType.toUpperCase()}`, { size: 10, bold: true });
  drawParty(ctx, input.certifierParty);
  ctx.y -= 4;

  if (input.producerParty) { drawSectionHeader(ctx, "2. PRODUCER"); drawParty(ctx, input.producerParty); ctx.y -= 4; }
  if (input.exporterParty) { drawSectionHeader(ctx, "3. EXPORTER"); drawParty(ctx, input.exporterParty); ctx.y -= 4; }
  if (input.importerParty) { drawSectionHeader(ctx, "4. IMPORTER"); drawParty(ctx, input.importerParty); ctx.y -= 4; }

  if (input.blanketPeriodStart || input.blanketPeriodEnd) {
    drawSectionHeader(ctx, "BLANKET PERIOD");
    drawText(ctx, `From: ${input.blanketPeriodStart ?? "N/A"}   To: ${input.blanketPeriodEnd ?? "N/A"}`, { size: 10 });
  }

  drawSectionHeader(ctx, "5. GOODS COVERED");
  drawText(ctx, "Description                                          HS Code       Criterion  Origin", { size: 9, bold: true });
  for (const g of input.goods) {
    const row = [
      g.description.slice(0, 48).padEnd(50),
      g.hsCode.padEnd(14),
      g.originCriterion.padEnd(11),
      g.countryOfOrigin,
    ].join(" ");
    drawText(ctx, row, { size: 9 });
  }
  ctx.y -= 6;
  drawText(ctx, "Origin criterion legend:", { size: 8, bold: true });
  drawText(ctx, "A — Wholly obtained/produced in USMCA territory.", { size: 8 });
  drawText(ctx, "B — Produced entirely in territory using non-originating materials meeting HS-classification change rules (Annex 4-B).", { size: 8 });
  drawText(ctx, "C — Produced entirely in territory exclusively from originating materials.", { size: 8 });
  drawText(ctx, "D — Otherwise qualifies under Article 4.2(d) (limited disassembly / recovered materials).", { size: 8 });

  drawSectionHeader(ctx, "6. CERTIFICATION");
  drawText(ctx, "I certify the goods described in this document qualify as originating and the information", { size: 9 });
  drawText(ctx, "contained herein is true and accurate. I assume responsibility for proving such representations.", { size: 9 });
  ctx.y -= 20;
  drawText(ctx, `Name:      ${input.authorizedSignatoryName}`, { size: 10 });
  if (input.authorizedSignatoryTitle) drawText(ctx, `Title:     ${input.authorizedSignatoryTitle}`, { size: 10 });
  drawText(ctx, `Signed:    ${input.signedOn}`, { size: 10 });
  drawText(ctx, "Signature: ________________________________________", { size: 10 });

  ctx.y = 60;
  drawText(ctx, "Generated by Pascal Logistics — pascallogistics.com. Not customs-broker advice.", { size: 8 });
  return await doc.save();
}
