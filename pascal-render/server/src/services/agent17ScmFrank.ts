// ============================================================================
// AGENT 17 — FRANK REYNOLDS — FRACTIONAL VP OF SUPPLY CHAIN  (display slot #17)
// Executive voice for Tier 3 clients. Weekly exec pack authoring, carrier-
// dispute rebuttals ($1k+), S&OP structure, vendor routing guides,
// root-cause analyses. Fires when the altitude of the question exceeds
// what operator-level agents should be answering.
//
// Sign-off: "Prepared by Frank Reynolds, Fractional VP of Supply Chain,
// on behalf of Pascal Logistics." (Named-persona positioning ONLY on
// Tier 3 accounts — sub-Tier-3 falls back to Roger's sign-off.)
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";
import { getKnowledgeBase, renderKnowledgeBaseForPrompt } from "./clientKnowledgeBase.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type FrankCategory =
  | "weekly_exec_pack"
  | "carrier_dispute_rebuttal"
  | "sop_playbook"
  | "root_cause_memo"
  | "sop_routing_guide"
  | "strategic_advisory"
  | "landed_cost_interpretation"
  | "other";

export interface FrankInput {
  eventType: string;
  clientOrgId?: string;
  clientName?: string;
  isTier3: boolean;
  scenarioDetail: string;
  disputeAmountUsd?: number;
  carrierName?: string;
  crossingPoint?: string;
  hsCodesInvolved?: string[];
  priorContext?: string;
  requestedDeliverable?: string;         // "S&OP cadence", "rebuttal letter", "routing guide", ...
}

export interface FrankOutput {
  category: FrankCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  immediateAction: string[];
  strategicFix: string[];
  financialImpactUsd?: number;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "client_executive" | "carrier" | "internal";
  simulated: boolean;
}

const FRANK_PERSONA = `PERSONA — You are Frank Reynolds, a Fractional Vice President of Supply Chain and Logistics. Your voice is the voice of a seasoned operator who has managed eight-figure freight budgets, sat in executive S&OP reviews, negotiated carrier contracts against real dollar levers, audited SAP / NetSuite / CargoWise, and walked warehouse loading docks resolving live exceptions. You speak like an executive — precise, decisive, financially framed, industry-native terminology, no filler.

MENTALITY:
- Root-cause over band-aids. Every incident: was it upstream (vendor, PO, invoice, cert), structural (transit benchmark, capacity, appointment window), or contractual (dwell clause, accessorial schedule)?
- P&L mindset. Every recommendation weighed against landed cost per unit, working capital, holding cost, margin protection.
- Upstream discipline. 90% of downstream freight failures start at the PO / commercial invoice / vendor compliance stage.
- Candor + decisiveness. Never "you should optimize." Always specific metrics, tolerances, playbooks.

DOMAIN COMPETENCE:
- Cross-border: US-Canada corridors (Pacific Highway/Blaine, Detroit/Windsor, Buffalo/Fort Erie), CBSA + CBP enforcement, ACE/ACI eManifest, USMCA/CUSMA rules of origin, B3/Form 7501, tariff engineering.
- Tactical freight: FTL, LTL, flatbed/specialized, reefer cold-chain, port drayage (demurrage, per diem, dual-transactions), accessorial negotiation (detention rates, free time, TONU, layovers).
- S&OP: 30/60/90-day rolling demand vs. capacity, safety-stock calc, tender-acceptance-rate monitoring, contract carrier commitments.
- Vendor compliance: inbound routing guides, supplier SLA chargebacks, packaging + labeling standards.
- Financial: freight bill audit tolerances, accessorial reconciliation, fuel-surcharge index (FCA vs. EIA), landed-cost modelling.
- Systems: EDI 204/214/210/990, ERP/WMS/TMS integrations, freight data structures.

FORMAT — When responding to a Tier 3 client scenario, use the executive brief structure:
  1. TL;DR — 2 sentences max, the number that matters + the recommendation
  2. Immediate action (what happens today)
  3. Strategic fix (upstream / structural / contractual)
  4. Financial / risk impact — quantified in dollars where possible
  5. Next milestone / deadline
Use bullet points, bold key metrics, and inline threshold tables when useful.

COMPLIANCE RAIL — You are NOT a licensed customs broker. You draft, flag, and structure; you never issue binding classification, valuation, or origin determinations. Anything requiring a broker ruling routes to the client's broker of record — you can DRAFT the ruling request, not the ruling.

VOICE — Assertive, composed, pragmatically skeptical. Eliminate filler and pleasantries. Executive terminology native: BOL, POD, accessorials, OS&D, landed cost, demurrage, PARS/PAPS, SCAC, tender acceptance rate, dwell time, cost-per-cwt, freight-to-revenue ratio.`;

const FRANK_SIGNOFF_TIER3 = `— Prepared by Frank Reynolds, Fractional VP of Supply Chain, on behalf of Pascal Logistics.`;
const FRANK_SIGNOFF_STANDARD = `— Roger, Pascal Logistics`;

export async function categorizeAndDraft(input: FrankInput): Promise<FrankOutput> {
  // Pull client KB when we have an orgId — pins the operational context Frank needs.
  let kbBlock = "";
  if (input.clientOrgId) {
    try {
      const kb = await getKnowledgeBase(input.clientOrgId);
      kbBlock = `\n${renderKnowledgeBaseForPrompt(kb)}\n\n`;
    } catch { /* ignore */ }
  }
  const signoff = input.isTier3 ? FRANK_SIGNOFF_TIER3 : FRANK_SIGNOFF_STANDARD;

  if (!client) {
    return {
      category: "strategic_advisory",
      priority: "normal",
      summary: `[Simulated] Frank would author a ${input.requestedDeliverable ?? "strategic memo"} for ${input.clientName ?? "the client"}. Enable ANTHROPIC_API_KEY.`,
      immediateAction: ["Configure ANTHROPIC_API_KEY on the API service."],
      strategicFix: ["Wire Frank into weekly exec-pack cron once live."],
      suggestedActions: ["Roger reviews before send"],
      draftResponseSubject: `${input.clientName ?? "Client"}: ${input.eventType}`,
      draftResponseBody: `[Simulated executive memo — set ANTHROPIC_API_KEY]\n\n${signoff}`,
      recipientRole: "client_executive",
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}${kbBlock}${FRANK_PERSONA}

ROLE — You are Frank Reynolds (Agent 17). This is a ${input.isTier3 ? "TIER 3" : "sub-Tier-3"} scenario for ${input.clientName ?? "the client"}.

Sign every client-visible draft with: "${signoff}"

Categories: weekly_exec_pack / carrier_dispute_rebuttal / sop_playbook / root_cause_memo / sop_routing_guide / strategic_advisory / landed_cost_interpretation / other

Return only JSON:
  category, priority (urgent/normal/low), summary (2 sentences),
  immediateAction (array of specific numbered directives for today),
  strategicFix (array of the upstream / structural / contractual fix),
  financialImpactUsd (numeric — best-effort dollar exposure),
  suggestedActions (1-4 imperatives for Roger),
  draftResponseSubject, draftResponseBody,
  recipientRole ("client_executive" / "carrier" / "internal").`;

  const userPrompt = `Event type: ${input.eventType}
Requested deliverable: ${input.requestedDeliverable ?? "not specified"}
Scenario detail:
${input.scenarioDetail}
${input.disputeAmountUsd ? `\nDollar exposure: $${input.disputeAmountUsd.toLocaleString()}` : ""}
${input.carrierName ? `\nCarrier: ${input.carrierName}` : ""}
${input.crossingPoint ? `\nCrossing point: ${input.crossingPoint}` : ""}
${input.hsCodesInvolved?.length ? `\nHS codes: ${input.hsCodesInvolved.join(", ")}` : ""}
${input.priorContext ? `\nPrior context: ${input.priorContext}` : ""}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1400,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed: Partial<FrankOutput> = (() => { try { return JSON.parse(cleaned); } catch { return {}; } })();

  const valid: FrankCategory[] = ["weekly_exec_pack", "carrier_dispute_rebuttal", "sop_playbook", "root_cause_memo", "sop_routing_guide", "strategic_advisory", "landed_cost_interpretation", "other"];
  return {
    category: (valid as string[]).includes(String(parsed.category)) ? (parsed.category as FrankCategory) : "strategic_advisory",
    priority: parsed.priority === "urgent" || parsed.priority === "low" ? parsed.priority : "normal",
    summary: String(parsed.summary ?? ""),
    immediateAction: Array.isArray(parsed.immediateAction) ? parsed.immediateAction.map(String) : [],
    strategicFix: Array.isArray(parsed.strategicFix) ? parsed.strategicFix.map(String) : [],
    financialImpactUsd: typeof parsed.financialImpactUsd === "number" ? parsed.financialImpactUsd : undefined,
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? `${input.clientName ?? "Client"}: ${input.eventType}`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: parsed.recipientRole === "carrier" || parsed.recipientRole === "internal" ? parsed.recipientRole : "client_executive",
    simulated: false,
  };
}

export async function persistDraft(input: FrankInput, output: FrankOutput, sourceRef?: string) {
  const payload = { input, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent17_scm_frank', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [
      output.recipientRole === "internal" ? "internal_scm_memo" : output.category,
      output.category,
      `${input.clientName ?? "Client"}: ${input.eventType}`,
      sourceRef ?? null,
      JSON.stringify(payload),
    ],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent17_scm_frank'`,
  );
  return result.rows[0];
}
