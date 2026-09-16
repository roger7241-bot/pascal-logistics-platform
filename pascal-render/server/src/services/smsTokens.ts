// ============================================================================
// SMS TOKENS — short-code approve/reject for gated tasks + drafts
// notifyRoger generates one of these per gate. Roger replies "YES 4271" or
// "NO 4271" and our SMS webhook resolves the code → applies the action.
// ============================================================================

import { randomInt } from "node:crypto";
import { pool } from "../db/pool.js";

export interface CreatedToken {
  shortCode: string;
  expiresAtIso: string;
}

// Generate a 4-digit code not currently in use, insert the token row.
export async function createSmsToken(targetType: "draft" | "task", targetId: string): Promise<CreatedToken> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(randomInt(1000, 10000));
    try {
      const result = await pool.query(
        `INSERT INTO notification_tokens (short_code, target_type, target_id)
         VALUES ($1, $2, $3)
         RETURNING short_code, expires_at`,
        [code, targetType, targetId],
      );
      return {
        shortCode: result.rows[0].short_code,
        expiresAtIso: (result.rows[0].expires_at as Date).toISOString(),
      };
    } catch (err) {
      // Unique violation → try another code
      const isUniqueViolation = err instanceof Error && /duplicate key value/.test(err.message);
      if (!isUniqueViolation) throw err;
    }
  }
  throw new Error("Could not generate a unique SMS token after 10 attempts.");
}

export interface RedeemedToken {
  targetType: "draft" | "task";
  targetId: string;
  action: "sent" | "rejected";
}

// Parse a raw SMS body like "YES 4271" or "no 4271 please" and, if a live
// token matches, mark it used and return the resolved target.
export async function redeemSmsToken(body: string): Promise<RedeemedToken | null> {
  const cleaned = body.trim().toLowerCase();
  const codeMatch = cleaned.match(/\b(\d{4})\b/);
  const isYes = /\b(yes|y|approve|send|ok)\b/.test(cleaned);
  const isNo = /\b(no|n|reject|deny|nope)\b/.test(cleaned);
  if (!codeMatch || (!isYes && !isNo)) return null;
  const action = isYes ? "sent" : "rejected";
  const code = codeMatch[1];

  const result = await pool.query(
    `UPDATE notification_tokens
       SET used_at = now(), used_action = $1
     WHERE short_code = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING target_type, target_id`,
    [action, code],
  );
  if (result.rowCount === 0) return null;
  return {
    targetType: result.rows[0].target_type,
    targetId: result.rows[0].target_id,
    action,
  };
}
