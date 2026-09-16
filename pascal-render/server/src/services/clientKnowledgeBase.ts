// ============================================================================
// CLIENT KNOWLEDGE BASE
// The persistent per-client memory a real SCM would carry in their head after
// six months on the job. Every Tier 3 agent prompt pins this — that's the
// difference between a generic freight vendor and a supply-chain manager
// who knows their SKUs, suppliers, lanes, and escalation ladder cold.
// ============================================================================

import { pool } from "../db/pool.js";

export interface KnowledgeBase {
  skus?: Array<{ sku: string; description?: string; uom?: string; weight_lb?: number; hs_code?: string; coo?: string; safety_stock_units?: number; moq?: number; lead_time_days?: number }>;
  suppliers?: Array<{ name: string; country?: string; terms?: string; otif_target_pct?: number; contact_name?: string; contact_email?: string; notes?: string }>;
  lanes?: Array<{ origin: string; destination: string; mode?: string; typical_carrier?: string; typical_transit_days?: number; notes?: string }>;
  customers?: Array<{ name: string; priority_tier?: string; otif_target_pct?: number; sla_notes?: string }>;
  escalation?: Array<{ level: number; name: string; role?: string; phone?: string; email?: string; when_to_call?: string }>;
  seasonality?: Array<{ pattern: string; months: string[]; notes?: string }>;
  erp_notes?: string;
}

export async function getKnowledgeBase(orgId: string): Promise<KnowledgeBase> {
  const result = await pool.query<{ knowledge: KnowledgeBase }>(
    `SELECT knowledge FROM client_knowledge_base WHERE org_id = $1`,
    [orgId],
  );
  return result.rows[0]?.knowledge ?? {};
}

export async function upsertKnowledgeBase(orgId: string, knowledge: KnowledgeBase): Promise<KnowledgeBase> {
  const result = await pool.query<{ knowledge: KnowledgeBase }>(
    `INSERT INTO client_knowledge_base (org_id, knowledge)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (org_id) DO UPDATE
       SET knowledge = EXCLUDED.knowledge,
           updated_at = now()
     RETURNING knowledge`,
    [orgId, JSON.stringify(knowledge)],
  );
  return result.rows[0].knowledge;
}

// Render the KB as a compact prompt-friendly block. This is what gets pinned
// into agent system prompts when the task is Tier-3-scoped.
export function renderKnowledgeBaseForPrompt(kb: KnowledgeBase): string {
  const sections: string[] = [];
  if (kb.skus?.length) {
    sections.push(`SKUs on file (${kb.skus.length}):\n${kb.skus.slice(0, 15).map((s) => `  - ${s.sku}${s.description ? ` — ${s.description}` : ""}${s.hs_code ? ` (HS ${s.hs_code})` : ""}${s.lead_time_days ? `; lead ${s.lead_time_days}d` : ""}`).join("\n")}${kb.skus.length > 15 ? `\n  ...and ${kb.skus.length - 15} more` : ""}`);
  }
  if (kb.suppliers?.length) {
    sections.push(`Suppliers (${kb.suppliers.length}):\n${kb.suppliers.map((s) => `  - ${s.name}${s.country ? ` (${s.country})` : ""}${s.terms ? ` · ${s.terms}` : ""}${s.otif_target_pct ? ` · OTIF target ${s.otif_target_pct}%` : ""}${s.notes ? ` — ${s.notes}` : ""}`).join("\n")}`);
  }
  if (kb.lanes?.length) {
    sections.push(`Lanes (${kb.lanes.length}):\n${kb.lanes.map((l) => `  - ${l.origin} → ${l.destination}${l.mode ? ` (${l.mode})` : ""}${l.typical_carrier ? ` via ${l.typical_carrier}` : ""}${l.typical_transit_days ? ` — ${l.typical_transit_days}d transit` : ""}`).join("\n")}`);
  }
  if (kb.customers?.length) {
    sections.push(`Key customers (${kb.customers.length}):\n${kb.customers.map((c) => `  - ${c.name}${c.priority_tier ? ` (${c.priority_tier})` : ""}${c.sla_notes ? ` — ${c.sla_notes}` : ""}`).join("\n")}`);
  }
  if (kb.escalation?.length) {
    sections.push(`Escalation ladder:\n${kb.escalation.sort((a, b) => a.level - b.level).map((e) => `  L${e.level}. ${e.name}${e.role ? ` (${e.role})` : ""}${e.when_to_call ? ` — call when: ${e.when_to_call}` : ""}`).join("\n")}`);
  }
  if (kb.seasonality?.length) {
    sections.push(`Seasonality:\n${kb.seasonality.map((s) => `  - ${s.pattern}${s.months.length ? ` (${s.months.join(", ")})` : ""}${s.notes ? ` — ${s.notes}` : ""}`).join("\n")}`);
  }
  if (kb.erp_notes) sections.push(`ERP notes: ${kb.erp_notes}`);
  if (sections.length === 0) return "No client knowledge base on file yet — treat generically.";
  return `CLIENT KNOWLEDGE BASE (Tier 3 — pinned deep client context):\n\n${sections.join("\n\n")}`;
}
