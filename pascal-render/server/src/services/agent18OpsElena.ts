// ============================================================================
// AGENT 18 — ELENA ROSTOVA — DIRECTOR OF OPERATIONS  (display slot #18)
// Roger's second-in-command. When delegation is enabled, Elena reviews gated
// tasks + pending drafts FIRST. She auto-approves within tolerance
// (dispatches ≤ $500, routine WISMO / POD / doc requests, matched-pattern
// playbook steps) and escalates real judgment calls to Roger.
//
// Elena's authority is bounded by explicit tolerance rules — she cannot
// commit pricing, deny insurance claims, sign contracts, or send anything
// to a client's C-suite without Roger's sign-off. Bounded autonomy: high
// for tactical routine, zero for pricing/legal/strategic.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type ElenaVerdict = "auto_approve" | "escalate_to_roger" | "reject" | "hold_for_info";

export interface ElenaReviewInput {
  reviewSubject: string;                 // "draft ABC-123" or "task XYZ-789"
  itemType: "draft" | "task";
  itemId: string;
  agentAuthor: string;                   // which agent produced it
  category: string;                      // category / event_type
  priority: string;                      // urgent / normal / low
  content: string;                       // draft body OR gate reason
  dollarExposureUsd?: number;
  recipientRole?: string;
  clientOrgId?: string;
  clientName?: string;
  clientRetainerTier?: string;
}

export interface ElenaOutput {
  verdict: ElenaVerdict;
  reasoning: string;                     // Elena's short internal justification
  escalationBriefing?: {                 // populated only when verdict = 'escalate_to_roger'
    whatOccurred: string;
    immediateActionTaken: string;
    currentStatus: string;
    nextMilestone: string;
    dollarImpactUsd?: number;
    threeChoices: string[];
    recommendation: string;
  };
  simulated: boolean;
}

const ELENA_PERSONA = `PERSONA — You are Elena Rostova, Director of Operations. You are Roger's operational right hand — decisive, methodical, hyper-competent. You are NOT a passive assistant or triage bot; when Roger is away or heads-down on growth, you hold operational command. You catch downstream failures before they cascade (a Sanitizer delay → Vetting → Customs Liaison → dock appointment miss). You present DECISIONS, not raw problems.

CORE OPERATING PRINCIPLES:
- Total process visibility — you see the interconnections between agents.
- Relentless SLA enforcement — every retainer promise is your personal responsibility.
- Autonomous problem resolution within tolerance; escalation for real judgment calls.
- Human-in-the-loop gatekeeper — you clear the queues, maintaining quality without becoming the bottleneck.

AUTO-APPROVE TOLERANCE (resolve without escalating):
  ✓ Individual draft dispatches ≤ $500 exposure (freight cost / claim / accessorial)
  ✓ Routine daily briefs to Tier 1 / 1.5 / 2 clients opted in
  ✓ Category-standard responses: WISMO, doc retrieval, POD chase, tracking updates
  ✓ Playbook step outputs matching expected patterns
  ✓ Renewal reminders < 30 days out with counterparty on file
  ✓ Onboarding checklist step completions

ALWAYS ESCALATE TO ROGER:
  ✗ Any dispute ≥ $1,000 (dollar or reputational)
  ✗ New client sign-off, retainer pricing commitments
  ✗ Any legal / regulatory decision (customs holds, insurance claim denials, contract clauses)
  ✗ Drafts going to a client's C-suite (CFO, CEO, VP Ops)
  ✗ Anything Marcus (Agent 16) flagged as close-adjacent
  ✗ Tier 3 client strategic advisories (route to Frank instead)
  ✗ Anything that changes an SOP or contract term
  ✗ Anything with the word "dispute", "claim over $1k", "cancel", "terminate", "penalty"

HOLD FOR INFO — when you're missing data to decide either way, mark the item on hold and specify what you need.

FORMAT ESCALATIONS — When you escalate, you present a scannable exec brief:
  WHAT OCCURRED: [1 sentence]
  IMMEDIATE ACTION TAKEN: [what you did before escalating]
  CURRENT STATUS: [where things stand right now]
  NEXT MILESTONE: [what happens next and when]
  DOLLAR IMPACT: [$X]
  THREE CHOICES:
    A) [option] — pros / cons
    B) [option] — pros / cons
    C) [option] — pros / cons
  RECOMMENDATION: [your definitive pick with 1-sentence rationale]

Roger reads this in 30 seconds and clicks approve.

TONE — Calm, authoritative, direct. Eliminate pleasantries. Bullet points, bold metrics, deadlines. Never speculate; if you don't know, say what you need to know.

You are NOT a licensed customs broker or a lawyer. You flag those calls to Roger even inside tolerance.`;

export async function reviewItem(input: ElenaReviewInput): Promise<ElenaOutput> {
  if (!client) {
    // Deterministic fallback — safest default is to escalate.
    return {
      verdict: "escalate_to_roger",
      reasoning: "[Simulated] ANTHROPIC_API_KEY not configured — defaulting to escalate.",
      escalationBriefing: {
        whatOccurred: input.reviewSubject,
        immediateActionTaken: "Elena reviewed but cannot decide without live inference.",
        currentStatus: "Awaiting Roger.",
        nextMilestone: "Roger clicks approve or reject in the AI Agents review queue.",
        dollarImpactUsd: input.dollarExposureUsd,
        threeChoices: ["Approve as drafted", "Edit and send", "Reject"],
        recommendation: "Cannot recommend without live inference. Enable ANTHROPIC_API_KEY.",
      },
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}${ELENA_PERSONA}

ROLE — You are Elena Rostova (Agent 18) reviewing an item Roger would otherwise see in his queue. Decide: auto_approve, escalate_to_roger, reject, or hold_for_info.

Return only JSON with keys:
  verdict (one of the four)
  reasoning (one sentence — your internal justification)
  escalationBriefing (object — populate ONLY when verdict = escalate_to_roger)
    whatOccurred, immediateActionTaken, currentStatus, nextMilestone,
    dollarImpactUsd (numeric), threeChoices (array of 3 strings),
    recommendation (string)

Return only JSON.`;

  const userPrompt = `Item under review:
Subject: ${input.reviewSubject}
Type: ${input.itemType}
Agent author: ${input.agentAuthor}
Category: ${input.category}
Priority: ${input.priority}
Dollar exposure: ${input.dollarExposureUsd ? `$${input.dollarExposureUsd.toLocaleString()}` : "n/a"}
Recipient: ${input.recipientRole ?? "unknown"}
Client: ${input.clientName ?? "n/a"}${input.clientRetainerTier ? ` (${input.clientRetainerTier})` : ""}

Content:
${input.content.slice(0, 4000)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed: Partial<ElenaOutput> = (() => { try { return JSON.parse(cleaned); } catch { return {}; } })();

  const valid: ElenaVerdict[] = ["auto_approve", "escalate_to_roger", "reject", "hold_for_info"];
  return {
    verdict: (valid as string[]).includes(String(parsed.verdict)) ? (parsed.verdict as ElenaVerdict) : "escalate_to_roger",
    reasoning: String(parsed.reasoning ?? ""),
    escalationBriefing: parsed.escalationBriefing,
    simulated: false,
  };
}

// Persist Elena's verdict as its own draft row so Roger can see the decision
// trail even for auto-approved items. Also writes to operator_notes on the
// underlying draft/task so the audit trail lives with the item.
export async function persistVerdict(input: ElenaReviewInput, output: ElenaOutput) {
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload, status, reviewed_at, operator_notes)
     VALUES ('agent18_ops_elena', 'gate_review', $1, $2, $3, $4::jsonb, $5, now(), $6)
     RETURNING *`,
    [
      output.verdict,
      `Elena reviewed: ${input.reviewSubject}`,
      `${input.itemType}:${input.itemId}`,
      JSON.stringify({ input, output }),
      output.verdict === "auto_approve" ? "sent" : "pending",
      output.reasoning,
    ],
  );
  // Note on the underlying item too — Roger sees Elena's reasoning inline.
  if (input.itemType === "draft") {
    void pool.query(
      `UPDATE agent_drafts SET operator_notes = COALESCE(operator_notes || E'\\n', '') || $1 WHERE id = $2`,
      [`[Elena · ${output.verdict}] ${output.reasoning}`, input.itemId],
    ).catch(() => undefined);
  } else {
    void pool.query(
      `UPDATE agent_tasks SET trail = trail || $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify([{ agentKey: "agent18_ops_elena", action: output.verdict === "escalate_to_roger" ? "gated_for_review" : "advanced", contribution: `Elena reviewed: ${output.reasoning}`, atIso: new Date().toISOString() }]), input.itemId],
    ).catch(() => undefined);
  }
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = $1, updated_at = now()
     WHERE agent_key = 'agent18_ops_elena'`,
    [`review:${output.verdict}`],
  );
  return result.rows[0];
}

// Read the delegation setting — cheap enough to call on every gate.
export async function isDelegationActive(): Promise<boolean> {
  const result = await pool.query<{ value: { enabled: boolean } }>(
    `SELECT value FROM operator_settings WHERE key = 'delegation'`,
  );
  return result.rows[0]?.value?.enabled === true;
}

export async function setDelegation(enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO operator_settings (key, value)
     VALUES ('delegation', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ enabled, delegate_agent_key: "agent18_ops_elena" })],
  );
}
