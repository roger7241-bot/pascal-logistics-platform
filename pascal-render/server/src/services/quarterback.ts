// ============================================================================
// QUARTERBACK
// Entry point for named plays. A quarterback (Chief of Staff or EA) runs a
// playbook end-to-end: creates the orchestrated task, advances it through
// each step (with the right agent taking each), gates review at the marked
// points, and closes with a client-visible narrative if the playbook is
// client-facing.
//
// This is the "supply-chain manager coordinating a team" moment. Instead of
// each agent operating in isolation, the quarterback calls the play and
// every agent knows their role in it. Roger sees the full trail on
// /operator/agents so he can watch the team run — and step in at gates.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";
import { createTask, advanceTask, closeTask, getTask, type TrailEntry } from "./orchestrator.js";
import { getPlaybook, type Playbook } from "./playbooks.js";
import { executeAgentStep, extractPriorContributions } from "./agentStepExecutor.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export interface RunPlaybookArgs {
  playbookKey: string;
  triggerSummary: string;                 // one-liner describing why we're running this play
  clientOrgId?: string;
  contextPayload: Record<string, unknown>; // whatever data the play needs to reason about
  originAgentKey?: string;                // if a specific agent triggered this; defaults to quarterback
}

export interface PlaybookRunResult {
  taskId: string;
  playbook: Playbook;
  stepsExecuted: number;
  stepsGated: number;
  clientNarrative?: string;
}

// Run a named play end-to-end. Each step is recorded on the task trail.
// Gated steps stop the run and land the task in awaiting_review; the
// remaining steps resume after Roger clears the gate (via advanceTask).
export async function runPlaybook(args: RunPlaybookArgs): Promise<PlaybookRunResult> {
  const playbook = getPlaybook(args.playbookKey);
  if (!playbook) throw new Error(`Unknown playbook: ${args.playbookKey}`);

  const originAgentKey = args.originAgentKey ?? playbook.quarterback;
  const firstStep = playbook.steps[0];

  // Create the task under the quarterback with the first step's agent
  // marked as current. The trail records the QB "calling the play".
  const taskId = await createTask({
    taskType: `playbook:${playbook.key}`,
    originAgentKey,
    nextAgentKey: firstStep.agentKey,
    clientOrgId: args.clientOrgId,
    subject: `${playbook.name} — ${args.triggerSummary}`,
    payload: {
      playbookKey: playbook.key,
      quarterback: playbook.quarterback,
      trigger: args.triggerSummary,
      ...args.contextPayload,
    },
    originContribution: `${playbook.quarterback === "agent6_chief_of_staff" ? "Chief of Staff" : "Executive Assistant"} called the play: ${playbook.name}. ${args.triggerSummary}`,
  });

  // Preload agent names once for use by extractPriorContributions.
  const agentNameMap = new Map<string, string>();
  const registryRows = await pool.query(`SELECT agent_key, name FROM agent_registry`);
  for (const r of registryRows.rows) agentNameMap.set(r.agent_key, r.name);

  let stepsExecuted = 1; // the create counts as step 1
  let stepsGated = 0;
  let currentAgentKey = firstStep.agentKey;
  // Accumulate the playbook payload as each step contributes.
  let livePayload: Record<string, unknown> = { ...args.contextPayload, playbookKey: playbook.key, trigger: args.triggerSummary };

  // Execute each step in order. Stop at the first gate.
  for (let i = 0; i < playbook.steps.length; i++) {
    const step = playbook.steps[i];

    if (step.skipIf && step.skipIf(args.contextPayload)) {
      await advanceTask({
        taskId,
        fromAgentKey: currentAgentKey,
        toAgentKey: i + 1 < playbook.steps.length ? playbook.steps[i + 1].agentKey : playbook.quarterback,
        contribution: `Skipped step "${step.action}" — condition not met`,
      });
      continue;
    }

    // Advance from the current agent to this step's agent (if different).
    if (i > 0 && currentAgentKey !== step.agentKey) {
      await advanceTask({
        taskId,
        fromAgentKey: currentAgentKey,
        toAgentKey: step.agentKey,
        contribution: `Handed off for: ${step.action}`,
      });
      currentAgentKey = step.agentKey;
    }

    // Actually invoke the agent. This produces a real draft, in Roger's
    // voice, with all prior team contributions in context — the difference
    // vs a rigid pipeline. The draft lands in the review queue linked to
    // this task.
    const taskRow = await getTask(taskId);
    const prior = extractPriorContributions((taskRow?.trail ?? []) as TrailEntry[], agentNameMap);

    const execution = await executeAgentStep({
      taskId,
      playbook,
      step,
      stepIndex: i,
      contextPayload: livePayload,
      priorContributions: prior,
      clientOrgId: args.clientOrgId,
    });

    // Record the substantive contribution on the trail with the draft id
    // so Roger can jump straight from the trail to the draft.
    await advanceTask({
      taskId,
      fromAgentKey: step.agentKey,
      toAgentKey: i + 1 < playbook.steps.length ? playbook.steps[i + 1].agentKey : playbook.quarterback,
      contribution: execution.contribution,
      linkedDraftId: execution.draftId,
    });

    // Fold the agent's contribution into the live payload so subsequent
    // steps see it in their context.
    livePayload = {
      ...livePayload,
      [`step_${step.stepKey}_output`]: {
        agentKey: step.agentKey,
        contribution: execution.contribution,
        draftId: execution.draftId,
        recipientRole: execution.recipientRole,
      },
    };
    stepsExecuted += 1;

    // Gate for review — stop the run. Roger clears the gate and the
    // remaining steps resume in a follow-up (Phase-3 "continue play" UI).
    if (step.gateForReview) {
      await advanceTask({
        taskId,
        fromAgentKey: step.agentKey,
        toAgentKey: playbook.quarterback,
        contribution: `Gated for Roger: ${step.gateForReview}`,
        humanGateReason: step.gateForReview,
      });
      stepsGated += 1;
      return { taskId, playbook, stepsExecuted, stepsGated };
    }
  }

  // Client-visible narrative wrap-up. Composed by the quarterback in
  // Roger's voice, using every prior contribution from the team so it
  // reads as one coordinated response — not five stitched drafts.
  let clientNarrative: string | undefined;
  if (playbook.clientVisible && client) {
    const finalTaskRow = await getTask(taskId);
    const priorForNarrative = extractPriorContributions((finalTaskRow?.trail ?? []) as TrailEntry[], agentNameMap);
    clientNarrative = await composeClientNarrative(playbook, args, priorForNarrative);
    await pool.query(
      `UPDATE agent_tasks SET payload = payload || $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify({ clientNarrative }), taskId],
    );
  }

  await closeTask(
    taskId,
    playbook.quarterback,
    "completed",
    playbook.clientVisible
      ? `Play complete. Client-visible narrative composed for Roger's review.`
      : `Play complete. Internal task closed — no client outbound.`,
  );

  return { taskId, playbook, stepsExecuted, stepsGated, clientNarrative };
}

// Compose the client-visible narrative — the "here's what we did"
// message that makes the client feel the difference. Uses every prior
// contribution from the team so the narrative reflects the actual
// coordinated work, not a generic summary. Signed by Roger.
async function composeClientNarrative(
  playbook: Playbook,
  args: RunPlaybookArgs,
  contributions: { agentKey: string; agentName: string; content: string }[],
): Promise<string> {
  if (!client) return "";
  const qbName = playbook.quarterback === "agent6_chief_of_staff" ? "Chief of Staff" : "Executive Assistant";
  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the ${qbName} (Agent ${playbook.quarterback === "agent6_chief_of_staff" ? "10" : "11"}). You just quarterbacked the "${playbook.name}" play for a client and now you compose the message the client sees. This is the moment they feel the difference vs a normal freight vendor — proactive, specific, coordinated.

Structure (120-200 words):
- What we noticed (concrete + specific)
- What we did (the coordinated response, in one paragraph — never name internal agents, always say "we")
- What that means for you (impact on their operation)
- What to expect next (specific timeline or action item)
- Sign-off "— Roger, Pascal Logistics"

Rules:
- Never reference internal agent names, task IDs, or system mechanics.
- Never overpromise on timing.
- Ground everything in the context they know (their shipment, their broker, their HS code).
- If the play needs their input, ask for it explicitly with a soft ask.`;

  const teamWorkBlock = contributions.length > 0
    ? `\n\nWhat the team actually did (fold this into "what we did"):\n${contributions.map((c) => `- ${c.content}`).join("\n")}`
    : "";

  const userPrompt = `Playbook: ${playbook.name}
Trigger: ${args.triggerSummary}
Context: ${JSON.stringify(args.contextPayload, null, 2)}${teamWorkBlock}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
}
