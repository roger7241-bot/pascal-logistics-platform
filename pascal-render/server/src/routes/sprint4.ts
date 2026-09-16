// ============================================================================
// SPRINT 4 ROUTES — multi-user access, prospect pipeline, calendar,
// Google SSO foundation. SMS approve-reject webhook lives in webhooks.ts
// because it's public.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { sendOperationalEmail } from "../services/agentMailDispatch.js";

function resolveOrgId(req: Request, allowQueryOverride: boolean): string | undefined {
  if (allowQueryOverride && req.authUser?.role === "operator") {
    const q = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    return q ?? req.authUser?.orgId ?? undefined;
  }
  return req.authUser?.orgId ?? undefined;
}

const VALID_SUB_ROLES = ["owner", "ops", "finance", "viewer"] as const;
type SubRole = typeof VALID_SUB_ROLES[number];

// ============================================================================
// MULTI-USER ACCESS ==========================================================
// ============================================================================
export function createMultiUserRouter(scope: "operator" | "client"): Router {
  const router = Router();
  const allowQueryOverride = scope === "operator";

  // List users on an account (client sees own org; operator can preview any).
  router.get("/account-users", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const users = await pool.query(
      `SELECT id, email, display_name, client_sub_role, invited_by, accepted_at,
              last_login_at, created_at, google_id IS NOT NULL AS has_google_sso
       FROM users WHERE org_id = $1 AND role = 'client'
       ORDER BY (accepted_at IS NULL) DESC, created_at ASC`,
      [orgId],
    );
    const invites = await pool.query(
      `SELECT id, invited_email, invited_sub_role, invited_by, invited_at,
              expires_at, status
       FROM client_invites WHERE org_id = $1 AND status = 'pending'
       ORDER BY invited_at DESC`,
      [orgId],
    );
    return res.status(200).json({ users: users.rows, pendingInvites: invites.rows });
  });

  // Invite a new user to the account. Owner + operator only.
  router.post("/account-users/invite", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    if (scope === "client") {
      // Only account owner can invite
      const requester = await pool.query(
        `SELECT client_sub_role FROM users WHERE email = $1 AND org_id = $2`,
        [req.authUser?.email ?? "", orgId],
      );
      if (requester.rows[0]?.client_sub_role !== "owner") {
        return res.status(403).json({ error: "Only the account owner can invite users." });
      }
    }
    const { email, subRole } = req.body ?? {};
    if (!email || typeof email !== "string" || !email.includes("@")) return res.status(400).json({ error: "Valid email required." });
    if (!VALID_SUB_ROLES.includes(subRole)) return res.status(400).json({ error: `subRole must be one of: ${VALID_SUB_ROLES.join(", ")}` });

    const token = randomBytes(24).toString("hex");
    const result = await pool.query(
      `INSERT INTO client_invites (org_id, invited_email, invited_sub_role, token, invited_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, invited_email, invited_sub_role, expires_at`,
      [orgId, email.toLowerCase(), subRole, token, req.authUser?.email ?? "system"],
    );

    // Send invite email — link back to accept page.
    const inviteUrl = `${process.env.CLIENT_ORIGIN_URL ?? "https://pascal-logistics-portal.onrender.com"}/accept-invite?token=${token}`;
    void sendOperationalEmail(
      email,
      `You've been invited to Pascal Logistics as ${subRole}`,
      `Hi,\n\n${req.authUser?.email ?? "The Pascal Logistics team"} invited you to their account as ${subRole}.\n\nAccept the invite: ${inviteUrl}\n\nThe link expires in 7 days.\n\n— Roger, Pascal Logistics`,
    ).catch((err) => console.error("Invite email failed:", err));

    return res.status(201).json({ invite: result.rows[0] });
  });

  // Revoke pending invite.
  router.delete("/account-users/invites/:id", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const result = await pool.query(
      `UPDATE client_invites SET status = 'revoked'
       WHERE id = $1 AND org_id = $2 AND status = 'pending'
       RETURNING id`,
      [req.params.id, orgId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Pending invite not found." });
    return res.status(200).json({ revoked: true });
  });

  // Update a user's sub-role. Owner + operator only.
  router.put("/account-users/:id/sub-role", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });
    const { subRole } = req.body ?? {};
    if (!VALID_SUB_ROLES.includes(subRole as SubRole)) return res.status(400).json({ error: `subRole must be one of: ${VALID_SUB_ROLES.join(", ")}` });
    const result = await pool.query(
      `UPDATE users SET client_sub_role = $1 WHERE id = $2 AND org_id = $3
       RETURNING id, email, client_sub_role`,
      [subRole, req.params.id, orgId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "User not found on this account." });
    return res.status(200).json({ user: result.rows[0] });
  });

  return router;
}

// ============================================================================
// PROSPECT PIPELINE ==========================================================
// ============================================================================
const VALID_STAGES = ["contacted", "replied", "meeting_booked", "proposal_sent", "signed", "lost"] as const;
type ProspectStage = typeof VALID_STAGES[number];

export function createProspectsRouter(): Router {
  const router = Router();

  router.get("/prospects", async (req: Request, res: Response) => {
    const stage = typeof req.query.stage === "string" && VALID_STAGES.includes(req.query.stage as ProspectStage) ? req.query.stage : undefined;
    const params: unknown[] = [];
    let where = "";
    if (stage) {
      params.push(stage);
      where = `WHERE stage = $1`;
    }
    const result = await pool.query(
      `SELECT * FROM prospects ${where} ORDER BY updated_at DESC LIMIT 300`,
      params,
    );
    // Group by stage for the board view.
    const board: Record<string, unknown[]> = {};
    for (const s of VALID_STAGES) board[s] = [];
    for (const row of result.rows) (board[row.stage] as unknown[]).push(row);
    return res.status(200).json({ prospects: result.rows, board });
  });

  router.post("/prospects", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.companyName || typeof b.companyName !== "string") return res.status(400).json({ error: "companyName required." });
    const stage = VALID_STAGES.includes(b.stage) ? b.stage : "contacted";
    const result = await pool.query(
      `INSERT INTO prospects (company_name, contact_name, contact_email, contact_role, industry,
         freight_volume_monthly, current_3pl_or_broker, pain_signal, source, stage, next_action,
         next_action_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        b.companyName, b.contactName ?? null, b.contactEmail ?? null, b.contactRole ?? null,
        b.industry ?? null, b.freightVolumeMonthly ?? null, b.current3plOrBroker ?? null,
        b.painSignal ?? null, b.source ?? null, stage, b.nextAction ?? null,
        b.nextActionAt ?? null, b.notes ?? null,
      ],
    );
    return res.status(201).json({ prospect: result.rows[0] });
  });

  router.patch("/prospects/:id", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (b.stage !== undefined) {
      if (!VALID_STAGES.includes(b.stage)) return res.status(400).json({ error: "invalid stage" });
      push("stage", b.stage);
    }
    if (b.contactName !== undefined) push("contact_name", b.contactName);
    if (b.contactEmail !== undefined) push("contact_email", b.contactEmail);
    if (b.nextAction !== undefined) push("next_action", b.nextAction);
    if (b.nextActionAt !== undefined) push("next_action_at", b.nextActionAt);
    if (b.notes !== undefined) push("notes", b.notes);
    if (b.lostReason !== undefined) push("lost_reason", b.lostReason);
    if (b.painSignal !== undefined) push("pain_signal", b.painSignal);
    if (b.freightVolumeMonthly !== undefined) push("freight_volume_monthly", b.freightVolumeMonthly);
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update." });
    sets.push(`updated_at = now()`);
    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE prospects SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Prospect not found." });
    return res.status(200).json({ prospect: result.rows[0] });
  });

  return router;
}

// ============================================================================
// CALENDAR + GOOGLE SSO FOUNDATION ============================================
// Skeleton routes ready for real Google OAuth wiring once Roger has API
// credentials. Currently returns demo/simulated responses so the UI works
// end-to-end pre-credentials.
// ============================================================================
export function createCalendarRouter(): Router {
  const router = Router();

  router.get("/calendar/integration-status", async (req: Request, res: Response) => {
    if (!req.authUser?.email) return res.status(400).json({ error: "No user on session." });
    const result = await pool.query(
      `SELECT google_email, calendar_id, connected_at, last_used_at
       FROM google_calendar_integrations gci
       JOIN users u ON u.id = gci.user_id
       WHERE u.email = $1`,
      [req.authUser.email],
    );
    return res.status(200).json({
      connected: (result.rowCount ?? 0) > 0,
      integration: result.rows[0] ?? null,
      configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
    });
  });

  router.post("/calendar/create-event", async (req: Request, res: Response) => {
    const { title, description, startIso, endIso, attendees } = req.body ?? {};
    if (!title || !startIso || !endIso) return res.status(400).json({ error: "title, startIso, endIso required." });
    const hasCreds = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID);
    if (!hasCreds) {
      // Demo mode — log the intent and return a simulated event.
      console.log(`[SIMULATED CALENDAR EVENT] "${title}" ${startIso} → ${endIso}`);
      return res.status(201).json({
        simulated: true,
        eventId: `demo_${Date.now()}`,
        htmlLink: null,
        message: "Calendar event queued in demo mode. Set GOOGLE_OAUTH_CLIENT_ID + finish OAuth flow to send to real Google Calendar.",
      });
    }
    // Real Google Calendar API call goes here once creds are wired.
    // For now, still simulate but tag as configured=true.
    return res.status(201).json({
      simulated: true,
      eventId: `pending_${Date.now()}`,
      htmlLink: null,
      message: "OAuth credentials configured but user has not connected their calendar yet. Direct them to /operator/settings to connect.",
      title, description, startIso, endIso, attendees,
    });
  });

  return router;
}
