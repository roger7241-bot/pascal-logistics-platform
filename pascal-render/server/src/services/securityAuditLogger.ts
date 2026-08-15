// ============================================================================
// SECURITY AUDIT LOGGER — append-only. No route in this codebase issues
// UPDATE or DELETE against security_audit_logs; this module only ever
// INSERTs, and getAuditLogs only ever SELECTs.
// ============================================================================

import { pool } from "../db/pool.js";
import type { SecurityAuditLog, SecurityAuditLogEntry } from "../types/security.js";

export async function logSecurityAudit(entry: SecurityAuditLogEntry): Promise<void> {
  await pool.query(
    `INSERT INTO security_audit_logs (org_id, operator_name, resource_type, resource_id, action, ip_address) VALUES ($1,$2,$3,$4,$5,$6)`,
    [entry.orgId, entry.operatorName, entry.resourceType, entry.resourceId, entry.action, entry.ipAddress ?? null],
  );
}

function rowToAuditLog(row: Record<string, unknown>): SecurityAuditLog {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    operatorName: row.operator_name as string,
    resourceType: row.resource_type as SecurityAuditLog["resourceType"],
    resourceId: row.resource_id as string,
    action: row.action as SecurityAuditLog["action"],
    ipAddress: (row.ip_address as string) ?? undefined,
    occurredAtIso: new Date(row.occurred_at as string).toISOString(),
  };
}

export async function getAuditLogs(filters: { orgId?: string; resourceType?: string; limit?: number }): Promise<SecurityAuditLog[]> {
  const limit = Math.min(filters.limit ?? 50, 200);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.orgId) {
    params.push(filters.orgId);
    conditions.push(`org_id = $${params.length}`);
  }
  if (filters.resourceType) {
    params.push(filters.resourceType);
    conditions.push(`resource_type = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const result = await pool.query(`SELECT * FROM security_audit_logs ${where} ORDER BY occurred_at DESC LIMIT $${params.length}`, params);
  return result.rows.map(rowToAuditLog);
}
