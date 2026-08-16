// ============================================================================
// REAL AUTHENTICATION SERVICE — bcrypt password verification + JWT session
// tokens carried in an httpOnly cookie. Closes the "no auth layer, org_id
// trusted from request params" gap that was previously a documented,
// deliberate limitation of this platform.
//
// JWT_SECRET is required (sync:false in render.yaml) — this module throws
// on startup if it's missing rather than silently falling back to an
// insecure default, since a guessable/fallback secret would make every
// session forgeable.
// ============================================================================

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set. Refusing to start with an insecure/guessable session secret.");
}

const SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 hours
export const SESSION_COOKIE_NAME = "pascal_session";

export interface SessionPayload {
  userId: string;
  email: string;
  role: "operator" | "client";
  orgId: string | null;
}

export interface AuthenticatedUser extends SessionPayload {
  displayName: string | null;
}

export async function verifyCredentials(email: string, password: string): Promise<AuthenticatedUser | undefined> {
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
  if (result.rowCount === 0) return undefined;
  const row = result.rows[0];
  const valid = await bcrypt.compare(password, row.password_hash as string);
  if (!valid) return undefined;
  return {
    userId: row.id as string,
    email: row.email as string,
    role: row.role as "operator" | "client",
    orgId: (row.org_id as string) ?? null,
    displayName: (row.display_name as string) ?? null,
  };
}

export function issueSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: SESSION_DURATION_SECONDS });
}

export function verifySessionToken(token: string): SessionPayload | undefined {
  try {
    return jwt.verify(token, JWT_SECRET as string) as SessionPayload;
  } catch {
    return undefined;
  }
}

export function sessionCookieMaxAgeMs(): number {
  return SESSION_DURATION_SECONDS * 1000;
}

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 10);
}
