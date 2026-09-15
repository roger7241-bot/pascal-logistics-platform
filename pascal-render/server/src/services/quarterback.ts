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
import { createTask, advanceTask, closeTask } from "./orchestrator.js";
import { getPlaybook, type Playbook } from "./playbooks.js";

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

  let stepsExecuted = 1; // the create counts as step 1
  let stepsGated = 0;
  let currentAgentKey = firstStep.agentKey;

  // Execute the remaining steps in order. Stop at the first gate.
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

    // Advance from current agent to this step's agent (if different).
    if (i > 0 && currentAgentKey !== step.agentKey) {
      await advanceTask({
        taskId,
        fromAgentKey: currentAgentKey,
        toAgentKey: step.agentKey,
        contribution: `Handed off for: ${step.action}`,
      });
      currentAgentKey = step.agentKey;
    }

    // Log the step execution (in Phase 1 we record it as a trail entry;
    // Phase 2 will actually invoke each agent's categorizeAndDraft here).
    await advanceTask({
      taskId,
      fromAgentKey: step.agentKey,
      toAgentKey: i + 1 < playbook.steps.length ? playbook.steps[i + 1].agentKey : playbook.quarterback,
      contribution: `Executed: ${step.action}`,
    });
    stepsExecuted += 1;

    // Gate for review — stop the run here. Roger clears it manually and
    // the remaining steps get re-triggered by the orchestrator sweep
    // (or by clicking "Continue play" in the UI, future feature).
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
  // Roger's voice. If the play is not client-facing, we still produce
  // an internal narrative so Roger has the story on one page.
  let clientNarrative: string | undefined;
  if (playbook.clientVisible && client) {
    clientNarrative = await composeClientNarrative(playbook, args);
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
// message that makes the client feel the difference. First-person plural,
// no jargon, no agent names, no aggregate numbers. Signed by Roger.
async function composeClientNarrative(playbook: Playbook, args: RunPlaybookArgs): Promise<string> {
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

  const userPrompt = `Playbook: ${playbook.name}
Trigger: ${args.triggerSummary}
Context: ${JSON.stringify(args.contextPayload, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
}
