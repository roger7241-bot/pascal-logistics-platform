// ============================================================================
// AGENT ORCHESTRATOR
// Cross-agent task handoffs. When one agent produces a finding another agent
// should act on, it creates or advances an agent_task. Every handoff appends
// to the trail JSONB so Roger can see exactly which agents touched what and
// why. Named human-gate points force operator review before an outbound
// crosses them — nothing goes to a client or carrier without Roger's sign-off.
//
// Usage from an agent service (typical pattern):
//
//   // Customs Liaison finds a missing USMCA cert:
//   const taskId = await createTask({
//     taskType: "usmca_missing_alert",
//     originAgentKey: "agent13_customs_liaison",
//     nextAgentKey: "agent5_client_chat",     // Customer Service composes client note
//     clientOrgId,
//     subject: `USMCA missing on shipment ${event.shipmentRef}`,
//     payload: { shipmentRef, hsCode, estimatedDutyImpact },
//     originContribution: "Pre-entry audit flagged missing USMCA cert",
//   });
//
//   // Customer Service picks it up in the daily orchestrator sweep or on
//   // a webhook, produces a client-facing draft, and hands off to Finance
//   // to flag the duty impact:
//   await advanceTask(taskId, "agent8_finance", "Drafted client outreach; forwarding duty impact for AR watchlist");
// ============================================================================

import { pool } from "../db/pool.js";
import { notifyRoger } from "./rogerNotify.js";

export interface TrailEntry {
  agentKey: string;
  action: "created" | "advanced" | "gated_for_review" | "completed" | "rejected" | "blocked";
  contribution: string;
  atIso: string;
}

export interface CreateTaskArgs {
  taskType: string;
  originAgentKey: string;
  nextAgentKey?: string;            // if omitted, task stays with origin
  clientOrgId?: string;
  subject: string;
  payload: Record<string, unknown>;
  originContribution: string;
  linkedDraftId?: string;
  humanGateReason?: string;         // if set, task is created "awaiting_review"
}

export interface AdvanceTaskArgs {
  taskId: string;
  fromAgentKey: string;
  toAgentKey: string;
  contribution: string;
  payloadPatch?: Record<string, unknown>;
  linkedDraftId?: string;
  humanGateReason?: string;
}

// Create a new orchestrated task. Origin agent contributes the initial trail
// entry. If nextAgentKey is provided, task is handed off; if humanGateReason
// is set, task lands in awaiting_review for Roger.
export async function createTask(args: CreateTaskArgs): Promise<string> {
  const now = new Date().toISOString();
  const initialTrail: TrailEntry[] = [{
    agentKey: args.originAgentKey,
    action: "created",
    contribution: args.originContribution,
    atIso: now,
  }];

  let status: "in_progress" | "awaiting_review" | "handed_off" = "in_progress";
  let currentAgent = args.originAgentKey;

  if (args.humanGateReason) {
    status = "awaiting_review";
  } else if (args.nextAgentKey && args.nextAgentKey !== args.originAgentKey) {
    status = "handed_off";
    currentAgent = args.nextAgentKey;
    initialTrail.push({
      agentKey: args.originAgentKey,
      action: "advanced",
      contribution: `Handed off to ${args.nextAgentKey}`,
      atIso: now,
    });
  }

  const result = await pool.query(
    `INSERT INTO agent_tasks (task_type, status, origin_agent_key, current_agent_key,
       client_org_id, subject, payload, trail, human_gate_reason, linked_draft_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
     RETURNING id`,
    [
      args.taskType, status, args.originAgentKey, currentAgent,
      args.clientOrgId ?? null, args.subject,
      JSON.stringify(args.payload), JSON.stringify(initialTrail),
      args.humanGateReason ?? null, args.linkedDraftId ?? null,
    ],
  );
  const taskId = result.rows[0].id as string;
  if (args.humanGateReason) {
    // Fire-and-forget — never let a notification delay task creation.
    void notifyRoger({
      subject: `[Gated] ${args.subject}`,
      message: `${args.humanGateReason}\n\nOpen the AI Agents board to review.`,
    }).catch((err) => console.error("Gate notification failed:", err));
  }
  return taskId;
}

// Move a task from one agent to another. Appends to the trail.
export async function advanceTask(args: AdvanceTaskArgs): Promise<void> {
  const now = new Date().toISOString();
  const entry: TrailEntry = {
    agentKey: args.fromAgentKey,
    action: args.humanGateReason ? "gated_for_review" : "advanced",
    contribution: args.contribution,
    atIso: now,
  };

  const status = args.humanGateReason ? "awaiting_review" : "handed_off";

  await pool.query(
    `UPDATE agent_tasks
       SET status = $1,
           current_agent_key = $2,
           trail = trail || $3::jsonb,
           payload = CASE WHEN $4::jsonb IS NULL THEN payload ELSE payload || $4::jsonb END,
           human_gate_reason = $5,
           linked_draft_id = COALESCE($6, linked_draft_id),
           updated_at = now()
     WHERE id = $7`,
    [
      status,
      args.toAgentKey,
      JSON.stringify([entry]),
      args.payloadPatch ? JSON.stringify(args.payloadPatch) : null,
      args.humanGateReason ?? null,
      args.linkedDraftId ?? null,
      args.taskId,
    ],
  );
  if (args.humanGateReason) {
    // Get task subject for a readable notification.
    const t = await pool.query(`SELECT subject FROM agent_tasks WHERE id = $1`, [args.taskId]);
    const subject = t.rows[0]?.subject ?? "task";
    void notifyRoger({
      subject: `[Gated] ${subject}`,
      message: `${args.humanGateReason}\n\nOpen the AI Agents board to review.`,
    }).catch((err) => console.error("Gate notification failed:", err));
  }
}

// Mark a task complete (or rejected / blocked). Terminal state.
export async function closeTask(taskId: string, agentKey: string, resolution: "completed" | "rejected" | "blocked", contribution: string): Promise<void> {
  const entry: TrailEntry = {
    agentKey,
    action: resolution,
    contribution,
    atIso: new Date().toISOString(),
  };
  await pool.query(
    `UPDATE agent_tasks
       SET status = $1,
           trail = trail || $2::jsonb,
           updated_at = now()
     WHERE id = $3`,
    [resolution, JSON.stringify([entry]), taskId],
  );
}

// Read a task by id (for agents that need to consume prior context).
export async function getTask(taskId: string) {
  const result = await pool.query(`SELECT * FROM agent_tasks WHERE id = $1`, [taskId]);
  return result.rows[0];
}

// List recent tasks — used by the operator UI and by the daily brief crons.
export async function listRecentTasks(limitDays = 1, statusFilter?: string) {
  const params: unknown[] = [`${limitDays} days`];
  let where = `updated_at >= now() - $1::interval`;
  if (statusFilter) {
    params.push(statusFilter);
    where += ` AND status = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT id, task_type, status, origin_agent_key, current_agent_key,
            client_org_id, subject, payload, trail, human_gate_reason,
            linked_draft_id, created_at, updated_at
     FROM agent_tasks WHERE ${where} ORDER BY updated_at DESC LIMIT 100`,
    params,
  );
  return result.rows;
}
