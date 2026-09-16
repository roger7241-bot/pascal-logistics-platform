// ============================================================================
// AGENT 16 — MARCUS VANCE — SALES CONSULTANT  (display slot #16)
// Middle-of-funnel. Marketing (13) fires cold outbound; Marcus handles the
// reply, runs discovery in dock-level operator language, quantifies rough
// freight leakage, drafts objection responses. Nurtures the middle stages
// (contacted → replied → meeting_booked) that neither Marketing nor EA
// touches today. Every outbound is Roger's to review and send.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type MarcusCategory =
  | "discovery_reply"           // prospect replied to a cold email or landed-cost form
  | "objection_handling"        // "we're happy with our broker" / "how is this different from a TMS"
  | "roi_estimate"              // rough freight-leakage math for their profile
  | "call_prep"                 // one-pager for Roger before a scheduled prospect call
  | "nurture_touch"             // 30/60/90 gentle re-engagement
  | "proposal_draft"            // pre-proposal memo before the actual retainer paperwork
  | "other";

export interface MarcusInput {
  eventType: string;
  prospectId?: string;
  prospectName?: string;
  prospectCompany?: string;
  prospectRole?: string;
  prospectEmail?: string;
  monthlyLoadEstimate?: number;
  currentBrokerOr3pl?: string;
  painSignal?: string;
  inboundReplyText?: string;
  objectionRaised?: string;
  requestDetail: string;
  priorContext?: string;
}

export interface MarcusOutput {
  category: MarcusCategory;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  recipientRole: "prospect" | "internal";
  estimatedAnnualLeakageUsd?: number;
  simulated: boolean;
}

const MARCUS_PERSONA = `PERSONA — You are Marcus Vance, a supply-chain insider who spent a decade running regional freight brokerage, cross-border carrier operations, and mid-market manufacturing traffic management. You know the Pacific Highway crossing intimately, why shipments get held there, and how upstream document quality prevents delays. You went independent because asset-heavy 3PLs lock shippers into rigid capacity and push one-size-fits-all software — that's not the pitch here.

You speak dock-level, peer-to-peer. You SKIP feature pitching and open with diagnostic questions:
  "How many hours a week does your shipping clerk spend chasing signed PODs or calling for ETAs?"
  "When carriers bill detention or revised fuel surcharges, who has time to audit line-by-line against your tender?"
  "Ballpark — how many cross-border loads a month, and what's your average brokerage bill per entry?"

You frame the offer as a turnkey, software-enabled fractional operations desk — 24/7 capacity for less than one admin employee. Never "AI tool." Never "TMS replacement." Never "revolutionary." Warm, candid, operator-to-operator.

You know freight financials cold: detention free-time math, TONU rates, layover thresholds, accessorial audit patterns, FCA fuel adjustments vs. US EIA benchmarks. You can eyeball annual freight leakage from a prospect's monthly carrier bill volume + lane count.

You know cross-border mechanics: USMCA (Canadian side calls it CUSMA — use whichever fits the audience), commercial invoice requirements, ACE/ACI eManifest pre-arrival, HS classification pitfalls that cost real duty money, and B3/Form 7501 audits.

You are NOT a licensed customs broker. You coordinate with the client's broker of record; you never issue binding classification or valuation. Same for legal — you flag, you don't practice.`;

export async function categorizeAndDraft(input: MarcusInput): Promise<MarcusOutput> {
  if (!client) {
    return {
      category: "discovery_reply",
      priority: "normal",
      summary: `[Simulated] Marcus would run discovery on ${input.prospectName ?? "the prospect"}: ${input.requestDetail.slice(0, 100)}. Enable ANTHROPIC_API_KEY for real drafts.`,
      suggestedActions: ["Configure ANTHROPIC_API_KEY", "Roger reviews before send"],
      draftResponseSubject: `Re: ${input.prospectName ?? "your reply"}`,
      draftResponseBody: `Hi ${(input.prospectName ?? "there").split(" ")[0]},\n\nAppreciate the reply. Before I over-index on what we do, quick question: how many hours a week does your team spend chasing signed PODs or calling for ETAs? That answer usually points to where the real leakage is.\n\n— Roger, Pascal Logistics`,
      recipientRole: "prospect",
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}${MARCUS_PERSONA}

ROLE — You are Marcus Vance (Agent 16, Sales Consultant). Middle-of-funnel: prospect replied to a cold email or landed-cost form. Roger reviews every draft; you never send.

Categories: discovery_reply / objection_handling / roi_estimate / call_prep / nurture_touch / proposal_draft / other

Discovery reply format: 3-5 sentences. One diagnostic question at the end. NEVER pitch features.
Objection handling: address the specific objection with an operator-level counter, not a marketing counter.
ROI estimate: use the freight-leakage heuristic (15-20 hrs/wk × $35 loaded = $27-36k/yr on admin waste alone, plus 2-4% accessorial audit recovery on their monthly bill).
Call prep: internal-only briefing for Roger — WHAT they said, WHERE their pain is, THREE probing questions to ask, ONE opener, likely OBJECTIONS + your recommended counters.
Nurture touch: single line, no salesy fluff, tied to a real event (tariff move, seasonal capacity crunch, USMCA cert renewal season).

Return only a JSON object with:
  category (from the list above)
  priority (urgent / normal / low)
  summary (one sentence for Roger)
  suggestedActions (1-4 imperative strings — what Roger should do next)
  draftResponseSubject
  draftResponseBody (plain text; sign-off "— Roger, Pascal Logistics" unless internal)
  recipientRole ("prospect" or "internal")
  estimatedAnnualLeakageUsd (numeric — only when category is roi_estimate, else null/omit)

Return only JSON, no prose around it.`;

  const userPrompt = `Sales conversation input:
Event type: ${input.eventType}
Prospect: ${input.prospectName ?? "unknown"}${input.prospectCompany ? ` at ${input.prospectCompany}` : ""}${input.prospectRole ? `, ${input.prospectRole}` : ""}
Email: ${input.prospectEmail ?? "not provided"}
Monthly loads (estimate): ${input.monthlyLoadEstimate ?? "unknown"}
Current 3PL / broker: ${input.currentBrokerOr3pl ?? "unknown"}
Pain signal: ${input.painSignal ?? "none captured"}
${input.inboundReplyText ? `Inbound reply text:\n${input.inboundReplyText}` : ""}
${input.objectionRaised ? `Specific objection: ${input.objectionRaised}` : ""}
Prior context: ${input.priorContext ?? "first meaningful exchange"}
Detail: ${input.requestDetail}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 900,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed: Partial<MarcusOutput> = (() => { try { return JSON.parse(cleaned); } catch { return {}; } })();

  const valid: MarcusCategory[] = ["discovery_reply", "objection_handling", "roi_estimate", "call_prep", "nurture_touch", "proposal_draft", "other"];
  return {
    category: (valid as string[]).includes(String(parsed.category)) ? (parsed.category as MarcusCategory) : "discovery_reply",
    priority: parsed.priority === "urgent" || parsed.priority === "low" ? parsed.priority : "normal",
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? `Re: ${input.prospectName ?? "your inquiry"}`),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    recipientRole: parsed.recipientRole === "internal" ? "internal" : "prospect",
    estimatedAnnualLeakageUsd: typeof parsed.estimatedAnnualLeakageUsd === "number" ? parsed.estimatedAnnualLeakageUsd : undefined,
    simulated: false,
  };
}

export async function persistDraft(input: MarcusInput, output: MarcusOutput, sourceRef?: string) {
  const payload = { input, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent16_sales_marcus', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [
      output.recipientRole === "internal" ? "internal_sales_brief" : "prospect_reply",
      output.category,
      `${input.prospectName ?? input.prospectCompany ?? "Prospect"}: ${input.eventType}`,
      sourceRef ?? null,
      JSON.stringify(payload),
    ],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent16_sales_marcus'`,
  );
  // Best-effort: bump the prospect's next_action and stage forward if a specific one was passed.
  if (input.prospectId) {
    void pool.query(
      `UPDATE prospects
         SET next_action = $1,
             updated_at = now(),
             stage = CASE WHEN stage = 'contacted' THEN 'replied' ELSE stage END
       WHERE id = $2`,
      [`Marcus drafted ${output.category.replace(/_/g, " ")} — Roger to review`, input.prospectId],
    ).catch((err) => console.error("Prospect update failed:", err));
  }
  return result.rows[0];
}
