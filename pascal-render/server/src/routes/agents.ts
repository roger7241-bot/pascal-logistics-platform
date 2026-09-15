// ============================================================================
// AGENTS ROUTE
// Operator-only endpoints for the AI agent registry + review inbox.
// GET  /api/operator/agents                        list all agents
// GET  /api/operator/agents/drafts?status=pending  review queue
// PATCH /api/operator/agents/drafts/:id            approve / edit / reject
// POST /api/operator/agents/chief-of-staff/simulate  inject a test inbound
//                                                  message so Roger can
//                                                  see the flow end-to-end
//                                                  without live inbox
//                                                  integration yet
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { categorizeAndDraft, persistDraft, type InboundMessage } from "../services/agent6ChiefOfStaff.js";

export function createAgentsRouter(): Router {
  const router = Router();

  router.get("/agents", async (_req: Request, res: Response) => {
    const registryResult = await pool.query(
      `SELECT agent_key, agent_number, name, role, description, status, human_in_loop, last_run_at, last_run_status
       FROM agent_registry ORDER BY agent_number ASC`,
    );
    const draftCounts = await pool.query(
      `SELECT agent_key, COUNT(*) FILTER (WHERE status = 'pending') AS pending
       FROM agent_drafts GROUP BY agent_key`,
    );
    const byKey = new Map<string, number>();
    for (const row of draftCounts.rows) byKey.set(row.agent_key, Number(row.pending));

    return res.status(200).json({
      agents: registryResult.rows.map((r) => ({
        agentKey: r.agent_key,
        agentNumber: Number(r.agent_number),
        name: r.name,
        role: r.role,
        description: r.description,
        status: r.status,
        humanInLoop: r.human_in_loop,
        lastRunAtIso: r.last_run_at ? (r.last_run_at as Date).toISOString() : undefined,
        lastRunStatus: r.last_run_status,
        pendingDrafts: byKey.get(r.agent_key) ?? 0,
      })),
    });
  });

  router.get("/agents/drafts", async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const agentKey = typeof req.query.agentKey === "string" ? req.query.agentKey : undefined;
    const params: string[] = [status];
    let where = "WHERE status = $1";
    if (agentKey) {
      params.push(agentKey);
      where += ` AND agent_key = $2`;
    }
    const result = await pool.query(
      `SELECT id, agent_key, kind, category, subject, source_ref, payload, status, operator_notes, reviewed_at, reviewer_email, created_at
       FROM agent_drafts ${where} ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    return res.status(200).json({ drafts: result.rows });
  });

  router.patch("/agents/drafts/:id", async (req: Request, res: Response) => {
    const { status, operatorNotes, payload } = req.body ?? {};
    if (status !== "approved" && status !== "rejected" && status !== "sent" && status !== "archived") {
      return res.status(400).json({ error: "status must be 'approved', 'rejected', 'sent', or 'archived'." });
    }
    const setClauses = ["status = $1", "operator_notes = COALESCE($2, operator_notes)", "reviewed_at = now()", "reviewer_email = $3"];
    const params: unknown[] = [status, operatorNotes ?? null, req.authUser?.email ?? null];
    if (payload && typeof payload === "object") {
      setClauses.push(`payload = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(payload));
    }
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE agent_drafts SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Draft not found." });
    return res.status(200).json({ draft: result.rows[0] });
  });

  // Test-only endpoint — inject a fake inbound message so Roger can watch
  // the Chief of Staff flow end-to-end before live inbox integration.
  router.post("/agents/chief-of-staff/simulate", async (req: Request, res: Response) => {
    const { fromEmail, fromName, subject, body } = req.body ?? {};
    if (!fromEmail || !subject || !body) {
      return res.status(400).json({ error: "fromEmail, subject, and body are required." });
    }
    const message: InboundMessage = {
      fromEmail: String(fromEmail),
      fromName: fromName ? String(fromName) : undefined,
      subject: String(subject),
      body: String(body),
      receivedAtIso: new Date().toISOString(),
    };
    const output = await categorizeAndDraft(message);
    const draft = await persistDraft(message, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  return router;
}
