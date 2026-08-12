// ============================================================================
// LEADS AI ASSIST (Agent 10)
// Draft AI Intro Email — real Claude call, same real/fallback pattern as
// every other AI integration in this platform.
// Generate Cross-Border Savings Proposal — reuses the EXACT same
// optimizeRate() function that runs on every live shipment and every
// Carrier Desk spot quote. Not a separate, fabricated calculation.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { optimizeRate } from "../agents/agent3RateOptimization.js";
import type { CargoDetails, CustomsDetails } from "../types/shipment.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export interface LeadForAi {
  companyName: string;
  contactName?: string;
  targetLanes?: string;
  commodities?: string;
  operatingRegions?: string;
  targetBorderCrossing?: string;
}

export interface IntroEmailResult {
  subject: string;
  body: string;
  simulated: boolean;
}

export async function draftIntroEmail(lead: LeadForAi): Promise<IntroEmailResult> {
  if (!client) {
    return {
      subject: `Pascal Logistics — introduction for ${lead.companyName}`,
      body: `[Simulated — no ANTHROPIC_API_KEY configured] A real, tailored intro email referencing ${lead.targetLanes ?? "your trade lane"} and ${lead.commodities ?? "your commodities"} would be generated here.`,
      simulated: true,
    };
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      system:
        "You are Agent 10, Pascal Logistics' sales outreach assistant. Write a short, concrete cold-intro email — no filler, no generic sales language. Reference the specific trade lane and commodities given. End with a clear, low-friction ask (a 15-minute call). Return only the email body, no subject line, no preamble.",
      messages: [
        {
          role: "user",
          content: `Draft an intro email to ${lead.contactName ?? "the prospect"} at ${lead.companyName}. Trade lane: ${lead.targetLanes ?? "unspecified"}. Commodities: ${lead.commodities ?? "unspecified"}. Operating regions: ${lead.operatingRegions ?? "unspecified"}. Target border crossing: ${lead.targetBorderCrossing ?? "unspecified"}.`,
        },
      ],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return { subject: `Pascal Logistics — ${lead.targetLanes ?? "cross-border freight"} for ${lead.companyName}`, body: textBlock?.text ?? "Could not generate email body.", simulated: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { subject: `Pascal Logistics — introduction for ${lead.companyName}`, body: `Draft generation failed: ${message}`, simulated: false };
  }
}

export interface SavingsProposal {
  estimatedMonthlyVolumeShipments: number;
  perShipmentContractedUsd: number;
  perShipmentSpotBenchmarkUsd: number;
  monthlySavingsUsd: number;
  annualSavingsUsd: number;
  savingsFlagged: boolean;
}

/**
 * Reuses the real Agent 3 optimizeRate() function against a representative
 * shipment profile, then extrapolates to a monthly/annual estimate based
 * on the lead's stated volume — the per-shipment numbers are genuinely
 * computed by the same tested pipeline logic, not invented for this page.
 */
export function generateSavingsProposal(estimatedAnnualValueUsd: number, monthlyShipmentCount = 8): SavingsProposal {
  const representativeInvoiceValue = estimatedAnnualValueUsd > 0 ? estimatedAnnualValueUsd / (monthlyShipmentCount * 12) : 8000;
  const cargo: CargoDetails = { handlingUnits: [], isHazmat: false, totalWeightLbs: 8000 };
  const customs: CustomsDetails = { pgaFlags: [], commercialInvoiceValue: representativeInvoiceValue };
  const quote = optimizeRate(cargo, customs);

  const perShipmentSavings = quote.benchmarkSpotRateUsd - quote.contractedRateUsd;
  const monthlySavingsUsd = Math.round(perShipmentSavings * monthlyShipmentCount);

  return {
    estimatedMonthlyVolumeShipments: monthlyShipmentCount,
    perShipmentContractedUsd: quote.contractedRateUsd,
    perShipmentSpotBenchmarkUsd: quote.benchmarkSpotRateUsd,
    monthlySavingsUsd,
    annualSavingsUsd: monthlySavingsUsd * 12,
    savingsFlagged: quote.savingsFlagged,
  };
}
