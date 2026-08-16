// ============================================================================
// AUTH MIDDLEWARE — requires a valid session cookie before any /api/operator
// or /api/client route runs. Attaches req.authUser so downstream routes can
// derive orgId from the verified session instead of trusting whatever the
// client sent — this is the actual fix for the multi-tenant "Client A sees
// Client B's data" risk, not just a login screen bolted on top.
// ============================================================================

import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionPayload } from "../services/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: SessionPayload;
    }
  }
}

function extractSession(req: Request): SessionPayload | undefined {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return undefined;
  return verifySessionToken(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = extractSession(req);
  if (!session) return res.status(401).json({ error: "Not authenticated. Please log in." });
  req.authUser = session;
  next();
  return;
}

export function requireOperator(req: Request, res: Response, next: NextFunction) {
  const session = extractSession(req);
  if (!session) return res.status(401).json({ error: "Not authenticated. Please log in." });
  if (session.role !== "operator") return res.status(403).json({ error: "Operator access required." });
  req.authUser = session;
  next();
  return;
}
