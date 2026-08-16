import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { verifyCredentials, issueSessionToken, sessionCookieMaxAgeMs, hashPassword, SESSION_COOKIE_NAME } from "../services/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

const isProduction = process.env.NODE_ENV === "production";

export function createAuthRouter(): Router {
  const router = Router();

  router.post("/login", async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "email and password are required." });
    }

    const user = await verifyCredentials(email, password);
    if (!user) return res.status(401).json({ error: "Incorrect email or password." });

    const token = issueSessionToken({ userId: user.userId, email: user.email, role: user.role, orgId: user.orgId });
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax", // frontend and backend are on different subdomains in production
      maxAge: sessionCookieMaxAgeMs(),
    });
    return res.status(200).json({ userId: user.userId, email: user.email, role: user.role, orgId: user.orgId, displayName: user.displayName });
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    return res.status(200).json({ ok: true });
  });

  router.get("/me", requireAuth, (req: Request, res: Response) => {
    return res.status(200).json(req.authUser);
  });

  // Requires the CURRENT password to change it — prevents someone who
  // merely has an active session (e.g. a shared/forgotten-open browser)
  // from locking out the real account owner without knowing the password.
  router.post("/change-password", requireAuth, async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ error: "currentPassword and a newPassword of at least 8 characters are required." });
    }
    const user = await verifyCredentials(req.authUser!.email, currentPassword);
    if (!user) return res.status(401).json({ error: "Current password is incorrect." });

    const newHash = await hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, req.authUser!.userId]);
    return res.status(200).json({ ok: true });
  });

  return router;
}
