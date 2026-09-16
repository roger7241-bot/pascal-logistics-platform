// ============================================================================
// PUBLIC INVITE ACCEPT ROUTES
// The link in the Sprint 4 invite email pointed to /accept-invite?token=…
// but there was no server-side handler and no client page. This closes
// the loop — invitee lands, sees who invited them, sets a password (or
// signs in with Google when SSO is wired), and joins the account.
//
// Mounted at /api/public BEFORE the auth middleware so unauthenticated
// invitees can accept.
// ============================================================================

import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";

interface InviteRow {
  id: string;
  org_id: string;
  invited_email: string;
  invited_sub_role: string;
  token: string;
  invited_by: string;
  invited_at: Date;
  expires_at: Date;
  status: string;
}

export function createInviteAcceptRouter(): Router {
  const router = Router();

  // Preview endpoint — the accept page fetches this to render the "You've
  // been invited to X as ops" banner. Never returns the token itself,
  // never exposes anything sensitive. 404 if not found; 410 if expired.
  router.get("/invites/:token", async (req: Request, res: Response) => {
    const invite = await pool.query<InviteRow & { company_name: string | null }>(
      `SELECT i.*, a.company_name
       FROM client_invites i
       LEFT JOIN accounts a ON a.org_id = i.org_id
       WHERE i.token = $1`,
      [req.params.token],
    );
    if ((invite.rowCount ?? 0) === 0) return res.status(404).json({ error: "Invite not found." });
    const row = invite.rows[0];
    if (row.status !== "pending") return res.status(410).json({ error: `Invite is ${row.status}.` });
    if (new Date(row.expires_at) < new Date()) {
      await pool.query(`UPDATE client_invites SET status = 'expired' WHERE id = $1`, [row.id]);
      return res.status(410).json({ error: "Invite has expired. Ask for a fresh one." });
    }
    return res.status(200).json({
      companyName: row.company_name,
      invitedEmail: row.invited_email,
      invitedSubRole: row.invited_sub_role,
      invitedBy: row.invited_by,
      invitedAt: row.invited_at,
      expiresAt: row.expires_at,
    });
  });

  // Accept — creates the users row (or attaches to an existing one), marks
  // the invite accepted, sets last_login_at. New user picks a password
  // right here; Google-SSO path will wire a separate flow later.
  router.post("/invites/:token/accept", async (req: Request, res: Response) => {
    const { password, displayName } = req.body ?? {};
    if (!password || typeof password !== "string" || password.length < 10) {
      return res.status(400).json({ error: "Password required (10+ characters)." });
    }
    const invite = await pool.query<InviteRow>(
      `SELECT * FROM client_invites WHERE token = $1`,
      [req.params.token],
    );
    if ((invite.rowCount ?? 0) === 0) return res.status(404).json({ error: "Invite not found." });
    const row = invite.rows[0];
    if (row.status !== "pending") return res.status(410).json({ error: `Invite is ${row.status}.` });
    if (new Date(row.expires_at) < new Date()) {
      await pool.query(`UPDATE client_invites SET status = 'expired' WHERE id = $1`, [row.id]);
      return res.status(410).json({ error: "Invite has expired." });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // If the email is already a user on this org, just flip their sub_role.
    const existing = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [row.invited_email.toLowerCase()],
    );
    let userId: string;
    if ((existing.rowCount ?? 0) > 0) {
      const upd = await pool.query(
        `UPDATE users
           SET org_id = $1,
               client_sub_role = $2,
               password_hash = $3,
               display_name = COALESCE($4, display_name),
               accepted_at = COALESCE(accepted_at, now()),
               last_login_at = now()
         WHERE id = $5
         RETURNING id`,
        [row.org_id, row.invited_sub_role, passwordHash, displayName ?? null, existing.rows[0].id],
      );
      userId = upd.rows[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO users (org_id, email, password_hash, display_name, role,
           client_sub_role, invited_by, accepted_at, last_login_at)
         VALUES ($1, $2, $3, $4, 'client', $5, $6, now(), now())
         RETURNING id`,
        [
          row.org_id, row.invited_email.toLowerCase(), passwordHash,
          displayName ?? null, row.invited_sub_role, row.invited_by,
        ],
      );
      userId = ins.rows[0].id;
    }

    await pool.query(
      `UPDATE client_invites SET status = 'accepted', accepted_at = now() WHERE id = $1`,
      [row.id],
    );

    return res.status(200).json({
      userId,
      orgId: row.org_id,
      email: row.invited_email,
      subRole: row.invited_sub_role,
      message: "Accepted. Sign in from the login page.",
    });
  });

  return router;
}
