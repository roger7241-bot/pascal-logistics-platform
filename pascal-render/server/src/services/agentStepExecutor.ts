// ============================================================================
// AGENT STEP EXECUTOR
// The quarterback calls this for each step in a playbook. Instead of just
// logging a trail entry, this actually invokes the agent — pulls its
// registry entry (role, description, humanInLoop), composes a system prompt
// that layers shared Pascal context + agent-specific role + this step's
// action + all prior contributions, calls Anthropic in Roger's voice, and
// writes the resulting draft to agent_drafts linked to the task.
//
// Every draft speaks with Roger's founder-operator voice: multi-modal freight
// expertise (LTL / TL / rail / ocean / air / DG), USMCA / customs
// coordination (never as broker), TMS ops rhythm, honest tone. Sign-off
// "— Roger, Pascal Logistics" on anything client-visible.
//
// Human-in-the-loop is preserved: every draft lands as pending. Gated
// steps additionally set the task to awaiting_review with the gate reason.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";
import type { PlaybookStep, Playbook } from "./playbooks.js";
import type { TrailEntry } from "./orchestrator.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export interface StepExecutionArgs {
  taskId: string;
  playbook: Playbook;
  step: PlaybookStep;
  stepIndex: number;                                // 0-based
  contextPayload: Record<string, unknown>;          // playbook context + accumulated contributions
  priorContributions: { agentKey: string; agentName: string; content: string }[];
  clientOrgId?: string;
}

export interface StepExecutionResult {
  draftId: string;
  contribution: string;                              // what the agent actually produced (short summary)
  draftSubject: string;
  draftBody: string;
  recipientRole: "client" | "carrier" | "broker" | "prospect" | "internal";
  simulated: boolean;
}

interface AgentMeta {
  name: string;
  role: string;
  description: string;
  agentNumber: number;
}

async function loadAgentMeta(agentKey: string): Promise<AgentMeta> {
  const result = await pool.query(
    `SELECT name, role, description, agent_number FROM agent_registry WHERE agent_key = $1`,
    [agentKey],
  );
  if (result.rowCount === 0) throw new Error(`Unknown agent: ${agentKey}`);
  const row = result.rows[0];
  return {
    name: row.name as string,
    role: row.role as string,
    description: row.description as string,
    agentNumber: Number(row.agent_number),
  };
}

// Compose the system prompt for a step. Layers: shared Pascal persona +
// this agent's specific role + explicit multi-modal voice reminder +
// step action + prior team contributions + output contract.
function buildSystemPrompt(meta: AgentMeta, playbook: Playbook, step: PlaybookStep, prior: StepExecutionArgs["priorContributions"]): string {
  const priorBlock = prior.length > 0
    ? `TEAM WORK SO FAR — you are picking up from teammates. Their contributions:\n${prior.map((p) => `- ${p.agentName}: ${p.content}`).join("\n")}\n`
    : `You are running the first step of this play. Your contribution sets up the rest of the team.\n`;

  return `${PASCAL_SYSTEM_PREFIX}
ROLE — You are ${meta.name} (Agent ${meta.agentNumber}, ${meta.role}). ${meta.description}

PLAYBOOK — "${playbook.name}". Full sequence: ${playbook.steps.map((s, i) => `(${i + 1}) ${s.action}`).join(" → ")}.

YOUR STEP — Step ${step.stepKey}: "${step.action}"

${priorBlock}
OUTPUT CONTRACT — return a JSON object with these keys:
- contribution: one-sentence summary of what you did for the trail (Roger reads this)
- draftSubject: subject line for the draft that goes to the review queue
- draftBody: the actual draft body — email / note / brief format appropriate to the step. Voice: Roger's founder-operator voice. Sign-off "— Roger, Pascal Logistics" if this is client / carrier / broker / prospect facing. No sign-off for internal.
- recipientRole: "client" | "carrier" | "broker" | "prospect" | "internal"

Return only the JSON, no prose around it.`;
}

// Deterministic fallback when Anthropic isn't reachable.
function fallbackOutput(meta: AgentMeta, step: PlaybookStep, prior: StepExecutionArgs["priorContributions"]): StepExecutionResult {
  const contribution = `[Simulated] ${meta.name} executed step "${step.action}" (no ANTHROPIC_API_KEY configured).`;
  return {
    draftId: "",
    contribution,
    draftSubject: `${meta.name}: ${step.action}`,
    draftBody: `[Simulated ${meta.name} output — set ANTHROPIC_API_KEY on the API service to enable live drafts]\n\nStep: ${step.action}\nTeam work so far: ${prior.length} prior contributions.`,
    recipientRole: "internal",
    simulated: true,
  };
}

export async function executeAgentStep(args: StepExecutionArgs): Promise<StepExecutionResult> {
  const meta = await loadAgentMeta(args.step.agentKey);

  let contribution: string;
  let draftSubject: string;
  let draftBody: string;
  let recipientRole: StepExecutionResult["recipientRole"];
  let simulated: boolean;

  if (!client) {
    const fb = fallbackOutput(meta, args.step, args.priorContributions);
    contribution = fb.contribution;
    draftSubject = fb.draftSubject;
    draftBody = fb.draftBody;
    recipientRole = fb.recipientRole;
    simulated = true;
  } else {
    const systemPrompt = buildSystemPrompt(meta, args.playbook, args.step, args.priorContributions);
    const userPrompt = `Playbook context:\n${JSON.stringify(args.contextPayload, null, 2)}\n\nExecute your step now.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 900,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    let parsed: { contribution?: string; draftSubject?: string; draftBody?: string; recipientRole?: string } = {};
    try { parsed = JSON.parse(cleaned); } catch { /* keep parsed empty */ }

    contribution = String(parsed.contribution ?? `${meta.name} completed step "${args.step.action}"`);
    draftSubject = String(parsed.draftSubject ?? `${meta.name}: ${args.step.action}`);
    draftBody = String(parsed.draftBody ?? "");
    recipientRole = (["client", "carrier", "broker", "prospect", "internal"].includes(parsed.recipientRole ?? "") ? parsed.recipientRole : "internal") as StepExecutionResult["recipientRole"];
    simulated = false;
  }

  // Persist as a pending draft so Roger sees it in the review queue.
  const payload = {
    playbookKey: args.playbook.key,
    playbookName: args.playbook.name,
    stepKey: args.step.stepKey,
    stepAction: args.step.action,
    context: args.contextPayload,
    priorContributions: args.priorContributions,
    output: {
      category: "operational",
      priority: args.step.gateForReview ? "urgent" : "normal",
      summary: contribution,
      suggestedActions: args.step.gateForReview ? [`Review — gate: ${args.step.gateForReview}`, "Approve to continue play"] : ["Review the draft", "Send if it reads right"],
      draftResponseSubject: draftSubject,
      draftResponseBody: draftBody,
      simulated,
      recipientRole,
    },
  };

  const draftResult = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ($1, $2, 'operational', $3, $4, $5::jsonb)
     RETURNING id`,
    [
      args.step.agentKey,
      `playbook_step:${args.playbook.key}:${args.step.stepKey}`,
      draftSubject,
      `task:${args.taskId}`,
      JSON.stringify(payload),
    ],
  );
  const draftId = draftResult.rows[0].id as string;

  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'playbook_step', updated_at = now()
     WHERE agent_key = $1`,
    [args.step.agentKey],
  );

  return { draftId, contribution, draftSubject, draftBody, recipientRole, simulated };
}

// Helper — collapse the task's trail down to prior contributions ready
// to hand to the next step's executor.
export function extractPriorContributions(trail: TrailEntry[], agents: Map<string, string>): { agentKey: string; agentName: string; content: string }[] {
  // Only surface entries that had substantive contributions — skip the
  // "handed off for X" plumbing entries.
  return trail
    .filter((t) => t.action !== "advanced" || !t.contribution.startsWith("Handed off"))
    .map((t) => ({
      agentKey: t.agentKey,
      agentName: agents.get(t.agentKey) ?? t.agentKey,
      content: t.contribution,
    }));
}
