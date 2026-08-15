// ============================================================================
// SECURITY AUDIT LOGGING TYPES
// Append-only trail of every operator read/export/download of sensitive
// client data: tax IDs (EIN/BN/RFC) and POA documents specifically named
// in the brief, plus general vault document access.
// ============================================================================

export type AuditedResourceType = "tax_id" | "poa_document" | "vault_document";
export type AuditedAction = "read" | "export" | "download";

export interface SecurityAuditLog {
  id: string;
  orgId: string;
  operatorName: string;
  resourceType: AuditedResourceType;
  resourceId: string;
  action: AuditedAction;
  ipAddress?: string;
  occurredAtIso: string;
}

export interface SecurityAuditLogEntry {
  orgId: string;
  operatorName: string;
  resourceType: AuditedResourceType;
  resourceId: string;
  action: AuditedAction;
  ipAddress?: string;
}
