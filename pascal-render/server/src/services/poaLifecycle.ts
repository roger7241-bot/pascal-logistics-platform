// ============================================================================
// POA LIFECYCLE STATE MACHINE
// PENDING_UPLOAD -> UPLOADED_PENDING_BROKER_REVIEW -> ACTIVE_IN_ACE_ACI ->
// EXPIRED_NEEDS_RENEWAL. Enforces legal transitions only, backed by the
// poa_records table — closes the gap where the simulation engine read a
// hardcoded org->status map instead of a real state machine.
// ============================================================================

import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { sendOperationalEmail } from "./agentMailDispatch.js";

export type PoaStatus = "pending_upload" | "uploaded_pending_broker_review" | "active_in_ace_aci" | "expired_needs_renewal";

export interface PoaRecord {
  orgId: string;
  status: PoaStatus;
  documentId?: string;
  uploadedAtIso?: string;
  brokerNotifiedAtIso?: string;
  brokerName?: string;
  brokerEmail?: string;
  activatedAtIso?: string;
  expiresAtIso?: string;
}

const ALLOWED_TRANSITIONS: Record<PoaStatus, PoaStatus[]> = {
  pending_upload: ["uploaded_pending_broker_review"],
  uploaded_pending_broker_review: ["active_in_ace_aci", "pending_upload"],
  active_in_ace_aci: ["expired_needs_renewal"],
  expired_needs_renewal: ["uploaded_pending_broker_review"],
};

export class InvalidPoaTransitionError extends Error {
  constructor(from: PoaStatus, to: PoaStatus) {
    super(`Cannot transition POA from "${from}" to "${to}" — not an allowed state change.`);
    this.name = "InvalidPoaTransitionError";
  }
}

function rowToRecord(row: Record<string, unknown>): PoaRecord {
  return {
    orgId: row.org_id as string,
    status: row.status as PoaStatus,
    documentId: (row.document_id as string) ?? undefined,
    uploadedAtIso: (row.uploaded_at as Date | null)?.toISOString(),
    brokerNotifiedAtIso: (row.broker_notified_at as Date | null)?.toISOString(),
    brokerName: (row.broker_name as string) ?? undefined,
    brokerEmail: (row.broker_email as string) ?? undefined,
    activatedAtIso: (row.activated_at as Date | null)?.toISOString(),
    expiresAtIso: (row.expires_at as Date | null)?.toISOString(),
  };
}

export async function getOrCreatePoaRecord(orgId: string): Promise<PoaRecord> {
  const existing = await pool.query("SELECT * FROM poa_records WHERE org_id = $1", [orgId]);
  if (existing.rows.length > 0) return rowToRecord(existing.rows[0]);

  const created = await pool.query("INSERT INTO poa_records (org_id, status) VALUES ($1, 'pending_upload') RETURNING *", [orgId]);
  return rowToRecord(created.rows[0]);
}

async function transition(orgId: string, newStatus: PoaStatus, client?: PoolClient): Promise<PoaRecord> {
  const db = client ?? pool;
  const current = await getOrCreatePoaRecord(orgId);

  if (!ALLOWED_TRANSITIONS[current.status].includes(newStatus)) {
    throw new InvalidPoaTransitionError(current.status, newStatus);
  }

  const activatedAtClause = newStatus === "active_in_ace_aci" ? ", activated_at = now()" : "";
  const result = await db.query(`UPDATE poa_records SET status = $1, updated_at = now()${activatedAtClause} WHERE org_id = $2 RETURNING *`, [newStatus, orgId]);
  return rowToRecord(result.rows[0]);
}

export interface BrokerNotificationResult {
  success: boolean;
  sentTo: string;
  sentAtIso: string;
}

/**
 * Real AgentMail dispatch (see agentMailDispatch.ts). Falls back to a
 * logged simulation when no AGENTMAIL_API_KEY is configured — that
 * fallback lives in the shared dispatch module, not duplicated here.
 */
async function notifyBroker(brokerEmail: string): Promise<BrokerNotificationResult> {
  const sentAtIso = new Date().toISOString();
  const result = await sendOperationalEmail(brokerEmail, "New customs POA uploaded — action required", "A new customs Power of Attorney has been uploaded and is pending your review. Please review and activate in ACE/ACI at your earliest convenience.");
  return { success: result.success, sentTo: brokerEmail, sentAtIso };
}

export async function uploadPoa(orgId: string, documentId: string, brokerEmail: string, brokerName: string): Promise<PoaRecord> {
  await transition(orgId, "uploaded_pending_broker_review");
  const notification = await notifyBroker(brokerEmail);

  const result = await pool.query(
    "UPDATE poa_records SET document_id = $1, uploaded_at = now(), broker_notified_at = $2, broker_name = $3, broker_email = $4 WHERE org_id = $5 RETURNING *",
    [documentId, notification.sentAtIso, brokerName, brokerEmail, orgId],
  );
  return rowToRecord(result.rows[0]);
}

export async function brokerActivate(orgId: string): Promise<PoaRecord> {
  return transition(orgId, "active_in_ace_aci");
}

export async function brokerBounceBack(orgId: string): Promise<PoaRecord> {
  return transition(orgId, "pending_upload");
}

/** The dispatch gate: automated cross-border dispatch is blocked unless the POA is active AND not past its expiry. */
export function canDispatchCrossBorder(record: PoaRecord, now: Date = new Date()): boolean {
  if (record.status !== "active_in_ace_aci") return false;
  if (record.expiresAtIso && new Date(record.expiresAtIso).getTime() < now.getTime()) return false;
  return true;
}

export async function checkExpiry(orgId: string, now: Date = new Date()): Promise<PoaRecord> {
  const record = await getOrCreatePoaRecord(orgId);
  if (record.status === "active_in_ace_aci" && record.expiresAtIso && new Date(record.expiresAtIso).getTime() < now.getTime()) {
    return transition(orgId, "expired_needs_renewal");
  }
  return record;
}
