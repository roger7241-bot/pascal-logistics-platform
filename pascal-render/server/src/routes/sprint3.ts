// ============================================================================
// SPRINT 3 ROUTES — operator unified inbox + batch draft actions
// + client activity timeline. Separate router so the mount points stay clean.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { dispatchDraft } from "../services/draftDispatch.js";

function resolveOrgId(req: Request, allowQueryOverride: boolean): string | undefined {
  if (allowQueryOverride && req.authUser?.role === "operator") {
    const q = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    return q ?? req.authUser?.orgId ?? undefined;
  }
  return req.authUser?.orgId ?? undefined;
}

export function createOperatorInboxRouter(): Router {
  const router = Router();

  // ============ Unified Operator Inbox =======================================
  // One call, one feed. Merges pending drafts, gated tasks, recent client
  // document uploads, cron activity, and unhandled tracking exceptions.
  router.get("/inbox", async (_req: Request, res: Response) => {
    const [drafts, gatedTasks, docs, cronEvents, exceptions] = await Promise.all([
      pool.query(
        `SELECT d.id, d.agent_key, ar.name AS agent_name, d.category, d.subject,
                d.status, d.created_at,
                d.payload -> 'output' ->> 'priority' AS priority,
                d.payload -> 'output' ->> 'summary' AS summary
         FROM agent_drafts d LEFT JOIN agent_registry ar USING (agent_key)
         WHERE d.status = 'pending' ORDER BY d.created_at DESC LIMIT 30`,
      ),
      pool.query(
        `SELECT id, task_type, subject, current_agent_key, human_gate_reason,
                created_at, updated_at, client_org_id
         FROM agent_tasks WHERE status = 'awaiting_review'
         ORDER BY updated_at DESC LIMIT 30`,
      ),
      pool.query(
        `SELECT d.id, d.filename, d.category, d.uploaded_at,
                a.company_name, a.org_id
         FROM vault_documents d LEFT JOIN accounts a USING (org_id)
         WHERE d.uploaded_at >= now() - INTERVAL '7 days'
         ORDER BY d.uploaded_at DESC LIMIT 30`,
      ),
      pool.query(
        `SELECT event_type, message, occurred_at, metadata
         FROM activity_log
         WHERE event_type LIKE 'cron_failure:%'
           AND occurred_at >= now() - INTERVAL '3 days'
         ORDER BY occurred_at DESC LIMIT 10`,
      ),
      pool.query(
        `SELECT m.id, m.event_type, m.location, m.occurred_at, m.details,
                s.tracking_number, s.mode, s.reference, s.org_id, a.company_name
         FROM shipment_milestones m
         JOIN tracking_subscriptions s ON s.id = m.subscription_id
         LEFT JOIN accounts a ON a.org_id = s.org_id
         WHERE m.is_exception = TRUE
           AND m.reported_at >= now() - INTERVAL '2 days'
         ORDER BY m.reported_at DESC LIMIT 20`,
      ),
    ]);

    return res.status(200).json({
      pendingDrafts: drafts.rows,
      gatedTasks: gatedTasks.rows,
      recentDocuments: docs.rows,
      cronFailures: cronEvents.rows,
      trackingExceptions: exceptions.rows,
      counts: {
        pendingDrafts: drafts.rowCount ?? 0,
        gatedTasks: gatedTasks.rowCount ?? 0,
        recentDocuments: docs.rowCount ?? 0,
        cronFailures: cronEvents.rowCount ?? 0,
        trackingExceptions: exceptions.rowCount ?? 0,
      },
    });
  });

  // ============ Batch draft actions ==========================================
  router.post("/agents/drafts/batch", async (req: Request, res: Response) => {
    const { ids, action, operatorNotes } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required." });
    if (!["approved", "rejected", "sent", "archived"].includes(action)) return res.status(400).json({ error: "action must be approved / rejected / sent / archived." });

    const result = await pool.query(
      `UPDATE agent_drafts
         SET status = $1,
             operator_notes = COALESCE($2, operator_notes),
             reviewed_at = now(),
             reviewer_email = $3
       WHERE id = ANY($4::uuid[])
         AND status = 'pending'
       RETURNING id, agent_key, payload`,
      [action, operatorNotes ?? null, req.authUser?.email ?? null, ids],
    );

    // If action was 'sent', dispatch each row in parallel; collect results.
    const dispatchResults: Array<{ id: string; attempted: boolean; recipient?: string; reason?: string; simulated?: boolean }> = [];
    if (action === "sent" && result.rows.length > 0) {
      await Promise.all(result.rows.map(async (row) => {
        try {
          const r = await dispatchDraft(row);
          const note = r.attempted
            ? `Sent to ${r.recipient}${r.emailResult?.simulated ? " (SIMULATED)" : ""}`
            : `Not sent: ${r.reason}`;
          await pool.query(
            `UPDATE agent_drafts SET operator_notes = COALESCE(operator_notes || E'\\n', '') || $1 WHERE id = $2`,
            [note, row.id],
          );
          dispatchResults.push({ id: row.id, attempted: r.attempted, recipient: r.recipient, reason: r.reason, simulated: r.emailResult?.simulated });
        } catch (err) {
          console.error(`Batch dispatch failed for ${row.id}:`, err);
          dispatchResults.push({ id: row.id, attempted: false, reason: err instanceof Error ? err.message : "Dispatch error" });
        }
      }));
    }

    return res.status(200).json({
      updatedCount: result.rowCount ?? 0,
      dispatchResults,
    });
  });

  return router;
}

export function createClientActivityRouter(): Router {
  const router = Router();

  // ============ Client Activity Timeline =====================================
  // What did we do for you this week / month. Client-safe view: no internal
  // agent names surface (we translate agent_key → generic label), no draft
  // internals shown, only sent drafts + closed tasks + tracking + docs.
  router.get("/activity", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, true);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));

    const [tasks, sent, docs, milestones] = await Promise.all([
      pool.query(
        `SELECT id, task_type, subject, status, created_at, updated_at
         FROM agent_tasks
         WHERE client_org_id = $1
           AND updated_at >= now() - $2::int * INTERVAL '1 day'
         ORDER BY updated_at DESC LIMIT 100`,
        [orgId, days],
      ),
      pool.query(
        `SELECT d.id, d.category, d.subject, d.reviewed_at,
                d.payload -> 'output' ->> 'summary' AS summary
         FROM agent_drafts d
         WHERE d.status = 'sent'
           AND d.reviewed_at >= now() - $1::int * INTERVAL '1 day'
           AND (d.source_ref LIKE 'daily_brief:client:' || $2 || '%'
                OR d.source_ref LIKE 'weekly_exec_pack:' || $2 || '%'
                OR d.source_ref LIKE '%:' || $2 || ':%')
         ORDER BY d.reviewed_at DESC LIMIT 100`,
        [days, orgId],
      ),
      pool.query(
        `SELECT id, filename, category, uploaded_at FROM vault_documents
         WHERE org_id = $1 AND uploaded_at >= now() - $2::int * INTERVAL '1 day'
         ORDER BY uploaded_at DESC LIMIT 50`,
        [orgId, days],
      ),
      pool.query(
        `SELECT m.id, m.event_type, m.location, m.occurred_at, m.is_exception,
                s.tracking_number, s.mode, s.reference
         FROM shipment_milestones m
         JOIN tracking_subscriptions s ON s.id = m.subscription_id
         WHERE s.org_id = $1 AND m.occurred_at >= now() - $2::int * INTERVAL '1 day'
         ORDER BY m.occurred_at DESC LIMIT 100`,
        [orgId, days],
      ),
    ]);

    return res.status(200).json({
      days,
      tasksCompleted: tasks.rows.filter((t) => t.status === "completed").length,
      totalTasks: tasks.rowCount ?? 0,
      briefsSent: sent.rowCount ?? 0,
      documentsUploaded: docs.rowCount ?? 0,
      milestonesReceived: milestones.rowCount ?? 0,
      exceptionsHandled: milestones.rows.filter((m) => m.is_exception).length,
      tasks: tasks.rows,
      briefsSentList: sent.rows,
      documents: docs.rows,
      milestones: milestones.rows,
    });
  });

  return router;
}
