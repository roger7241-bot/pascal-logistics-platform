// ============================================================================
// DOCUMENT EXTRACTION — real Claude-powered parsing for Step 3 of the
// Client Shipment Intake Wizard ("Drop Commercial Invoice... here to
// auto-fill booking details"). Requires ANTHROPIC_API_KEY (provisioned as
// sync:false in render.yaml). Uses tool-forced structured output so the
// response is guaranteed to match ExtractedShipmentFields, not free text
// that needs a second parsing pass.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export interface ExtractedShipmentFields {
  shipperName?: string;
  consigneeName?: string;
  htsCode?: string;
  countryOfOrigin?: string;
  commercialInvoiceValue?: number;
  currency?: string;
  totalWeightLbs?: number;
}

export interface ExtractionResult {
  success: boolean;
  simulated: boolean;
  fields?: ExtractedShipmentFields;
  error?: string;
}

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_extracted_fields",
  description: "Records the shipment fields found in the document text.",
  input_schema: {
    type: "object",
    properties: {
      shipperName: { type: "string", description: "The shipper/exporter company name, if present." },
      consigneeName: { type: "string", description: "The consignee/importer company name, if present." },
      htsCode: { type: "string", description: "The HTS/HS tariff classification code, if present." },
      countryOfOrigin: { type: "string", description: "ISO 2-letter country of origin code, if present." },
      commercialInvoiceValue: { type: "number", description: "The total commercial invoice value as a plain number, if present." },
      currency: { type: "string", description: "The 3-letter currency code (USD/CAD/EUR), if present." },
      totalWeightLbs: { type: "number", description: "Total shipment weight in pounds, if present (convert from kg if needed)." },
    },
  },
};

/**
 * Extracts structured shipment fields from raw document text (a commercial
 * invoice, packing list, or similar). Falls back to a clearly-labeled
 * simulated result when no ANTHROPIC_API_KEY is configured, same pattern
 * as the Twilio and AgentMail modules — this sandbox has no live key, so
 * the fallback path is what actually runs here, but the extraction call
 * itself is real.
 */
export async function extractShipmentFieldsFromText(documentText: string): Promise<ExtractionResult> {
  if (!client) {
    console.log(`[SIMULATED DOCUMENT EXTRACTION — no ANTHROPIC_API_KEY configured] Would extract fields from ${documentText.length} chars of document text.`);
    return { success: true, simulated: true, fields: {} };
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "record_extracted_fields" },
      messages: [
        {
          role: "user",
          content: `Extract the shipment fields from this document text. Only include fields you can actually find — omit anything not present rather than guessing:\n\n${documentText}`,
        },
      ],
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) throw new Error("Model did not return the expected tool call.");

    return { success: true, simulated: false, fields: toolUse.input as ExtractedShipmentFields };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Anthropic API error";
    console.error(`Document extraction failed: ${error}`);
    return { success: false, simulated: false, error };
  }
}
