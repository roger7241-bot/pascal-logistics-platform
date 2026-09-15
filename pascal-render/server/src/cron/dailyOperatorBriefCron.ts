// ============================================================================
// CRON — Daily Operator Brief (06:00 America/Los_Angeles)
// Composes Roger's morning digest. Pulls the past 24h of activity across
// every agent: pending drafts by agent, cross-agent tasks in flight,
// urgent items awaiting review, tariff moves from overnight, past-due
// invoices Finance flagged, POA / insurance renewals approaching. Chief
// of Staff persona composes the narrative. Lands as a pending draft
// under agent6_chief_of_staff labelled 'daily_operator_brief' so Roger
// gets it in the review queue when he opens the portal at 06:00 PT.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "../services/pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

async function main() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [pendingDrafts, tasksInFlight, urgentReviews, tariffs, activity] = await Promise.all([
    pool.query(
      `SELECT ad.agent_key, ar.name AS agent_name, COUNT(*)::int AS n
       FROM agent_drafts ad JOIN agent_registry ar USING (agent_key)
       WHERE ad.status = 'pending' AND ad.created_at >= $1
       GROUP BY ad.agent_key, ar.name ORDER BY n DESC`,
      [since],
    ),
    pool.query(
      `SELECT task_type, current_agent_key, subject, updated_at
       FROM agent_tasks WHERE status IN ('in_progress', 'handed_off')
         AND updated_at >= $1 ORDER BY updated_at DESC LIMIT 20`,
      [since],
    ),
    pool.query(
      `SELECT subject, human_gate_reason, current_agent_key
       FROM agent_tasks WHERE status = 'awaiting_review' ORDER BY created_at ASC LIMIT 10`,
    ),
    pool.query(
      `SELECT headline, hs_code, severity, effective_date FROM tariff_updates
       WHERE published_at >= $1 ORDER BY severity ASC, published_at DESC LIMIT 5`,
      [since],
    ),
    pool.query(
      `SELECT event_type, shipment_id, message FROM activity_log
       WHERE occurred_at >= $1 ORDER BY occurred_at DESC LIMIT 15`,
      [since],
    ),
  ]);

  const context = `Data pulled from past 24 hours:

Pending drafts by agent:
${pendingDrafts.rows.map((r) => `  ${r.agent_name}: ${r.n}`).join("\n") || "  (none)"}

Tasks in flight (cross-agent handoffs):
${tasksInFlight.rows.map((r) => `  ${r.task_type}: ${r.subject} (currently with ${r.current_agent_key})`).join("\n") || "  (none)"}

Awaiting your review (blocking):
${urgentReviews.rows.map((r) => `  ${r.subject} — ${r.human_gate_reason ?? "gated"} (with ${r.current_agent_key})`).join("\n") || "  (none)"}

Overnight tariff moves:
${tariffs.rows.map((r) => `  [${r.severity}] HS ${r.hs_code}: ${r.headline}${r.effective_date ? ` — effective ${r.effective_date}` : ""}`).join("\n") || "  (none)"}

Freight activity:
${activity.rows.map((r) => `  ${r.event_type}${r.shipment_id ? ` (${r.shipment_id})` : ""}: ${r.message}`).join("\n") || "  (none)"}`;

  const totalDrafts = pendingDrafts.rows.reduce((sum, r) => sum + Number(r.n), 0);
  const totalTasks = tasksInFlight.rowCount ?? 0;
  const totalGates = urgentReviews.rowCount ?? 0;

  let body = "";
  if (client) {
    const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Chief of Staff (Agent 10). Compose Roger's daily morning brief. Structure:

1. TOP OF MIND (1-2 sentences) — the single most important thing this morning
2. WAITING ON YOU — items gated for review, urgent-first
3. IN FLIGHT — cross-agent tasks being worked, one line each
4. OVERNIGHT — tariff moves, exceptions, market moves
5. TODAY'S FOCUS — one specific recommended focus block

Tone: precise, factual, respectful of Roger's time. 300-500 words. No preamble, no sign-off (this goes to Roger only, internal). Format with clear section headers.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Compose today's operator brief.\n\n${context}` }],
    });
    body = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  } else {
    body = `Morning Roger,\n\n${totalGates} items awaiting review, ${totalDrafts} drafts pending, ${totalTasks} tasks in flight. [Simulated — no ANTHROPIC_API_KEY]\n\n${context}`;
  }

  const payload = {
    inbound: {
      fromEmail: "internal-cron@pascallogistics.com",
      fromName: "Daily Operator Brief Cron",
      subject: `Daily brief for ${new Date().toISOString().slice(0, 10)}`,
      body: context,
    },
    output: {
      category: "operational",
      priority: totalGates > 0 ? "urgent" : "normal",
      summary: `${totalGates} gated · ${totalDrafts} pending drafts · ${totalTasks} tasks in flight`,
      suggestedActions: totalGates > 0 ? ["Clear the review-gated items first", "Then triage the pending drafts", "Focus block starts after triage"] : ["Triage pending drafts", "Focus block on the top-of-mind item"],
      draftResponseSubject: `Morning brief — ${new Date().toISOString().slice(0, 10)}`,
      draftResponseBody: body,
      simulated: !client,
    },
  };

  await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent6_chief_of_staff', 'daily_operator_brief', 'operational', $1, $2, $3::jsonb)`,
    [`Morning brief ${new Date().toISOString().slice(0, 10)}`, `daily_brief:operator:${new Date().toISOString().slice(0, 10)}`, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'daily_brief_drafted', updated_at = now()
     WHERE agent_key = 'agent6_chief_of_staff'`,
  );
  console.log(`Daily operator brief drafted: ${totalGates} gated / ${totalDrafts} drafts / ${totalTasks} tasks.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Daily operator brief cron failed:", err);
    process.exit(1);
  });
