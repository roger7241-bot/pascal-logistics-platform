// ============================================================================
// Tier3Panel
// The operator-facing Supply Chain Manager admin surface for one client.
// Renders inside the CRM Accounts detail modal as a new "SCM (Tier 3)" tab.
// - Knowledge Base editor (SKUs, suppliers, lanes, customers, escalation)
// - KPI targets editor
// - ERP connection picker + demo/live toggle
// - Latest KPI snapshot readout + trigger for ad-hoc recompute
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, RefreshCw, Plus, X, Database, Target, BookOpen, Activity, AlertCircle } from "lucide-react";
import { api, ApiError } from "../config/api";

interface KnowledgeBase {
  skus?: Array<{ sku: string; description?: string; hs_code?: string; safety_stock_units?: number; moq?: number; lead_time_days?: number }>;
  suppliers?: Array<{ name: string; country?: string; terms?: string; otif_target_pct?: number; contact_email?: string; notes?: string }>;
  lanes?: Array<{ origin: string; destination: string; mode?: string; typical_carrier?: string; typical_transit_days?: number }>;
  customers?: Array<{ name: string; priority_tier?: string; sla_notes?: string }>;
  escalation?: Array<{ level: number; name: string; role?: string; phone?: string; email?: string; when_to_call?: string }>;
  erp_notes?: string;
}

interface KpiTargets {
  otif_target_pct?: number | null;
  perfect_order_target_pct?: number | null;
  freight_to_revenue_target_pct?: number | null;
  cash_to_cash_target_days?: number | null;
  inventory_turns_target?: number | null;
  order_fill_rate_target_pct?: number | null;
  supplier_otif_target_pct?: number | null;
  damage_rate_target_pct?: number | null;
  forecast_accuracy_mape_target_pct?: number | null;
  dead_stock_target_pct?: number | null;
}

interface KpiSnapshot {
  snapshot_date: string;
  otif_pct: number | null;
  perfect_order_pct: number | null;
  freight_to_revenue_pct: number | null;
  inventory_turns: number | null;
  order_fill_rate_pct: number | null;
  supplier_otif_pct: number | null;
  damage_rate_pct: number | null;
  dead_stock_pct: number | null;
  orders_total: number;
  orders_shipped_ontime: number;
  orders_shipped_infull: number;
  freight_cost_usd: string | number;
  revenue_usd: string | number;
  inventory_value_usd: string | number;
  source: "demo" | "erp_pull" | "manual";
}

interface ErpConnection {
  provider: string;
  connection_status: string;
  demo_mode: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

interface Snapshot {
  account: { org_id: string; company_name: string; retainer_tier: string | null };
  knowledgeBase: KnowledgeBase;
  kpiTargets: KpiTargets | null;
  kpiSnapshots: KpiSnapshot[];
  erpConnection: ErpConnection | null;
}

type SubTab = "kpis" | "kb" | "targets" | "erp";

export function Tier3Panel({ orgId }: { orgId: string }) {
  const [snap, setSnap] = useState<Snapshot | undefined>();
  const [providers, setProviders] = useState<{ key: string; label: string; liveWired: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [subTab, setSubTab] = useState<SubTab>("kpis");
  const [kbDraft, setKbDraft] = useState<KnowledgeBase>({});
  const [targetsDraft, setTargetsDraft] = useState<KpiTargets>({});
  const [erpDraft, setErpDraft] = useState<{ provider: string; demoMode: boolean }>({ provider: "demo", demoMode: true });

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [s, p] = await Promise.all([
        api.tier3Snapshot<Snapshot>(orgId),
        api.erpProviders<{ providers: { key: string; label: string; liveWired: boolean }[] }>(),
      ]);
      setSnap(s);
      setProviders(p.providers);
      setKbDraft(s.knowledgeBase ?? {});
      setTargetsDraft(s.kpiTargets ?? {});
      setErpDraft({
        provider: s.erpConnection?.provider ?? "demo",
        demoMode: s.erpConnection?.demo_mode ?? true,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load Tier 3 snapshot.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  async function saveKb() {
    setSaving(true);
    setError(undefined);
    try {
      await api.updateKnowledgeBase(orgId, kbDraft as unknown as Record<string, unknown>);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save knowledge base.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTargets() {
    setSaving(true);
    setError(undefined);
    try {
      // Convert camel snake_case to camelCase for the PUT (route uses camelCase keys internally).
      const camel: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(targetsDraft)) {
        const camelKey = k.replace(/_([a-z])/g, (_m, l) => l.toUpperCase());
        camel[camelKey] = v as number | null;
      }
      await api.updateKpiTargets(orgId, camel);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save KPI targets.");
    } finally {
      setSaving(false);
    }
  }

  async function saveErp() {
    setSaving(true);
    setError(undefined);
    try {
      await api.updateErpConnection(orgId, { provider: erpDraft.provider, demoMode: erpDraft.demoMode });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save ERP connection.");
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(undefined);
    try {
      await api.refreshKpis(orgId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "KPI refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !snap) {
    return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading Tier 3…</div>;
  }
  const latest = snap?.kpiSnapshots?.[0];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tier / retainer status */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Supply Chain Manager tier</p>
            <p className="text-sm font-semibold text-slate-900">{snap?.account.retainer_tier ?? "not set"} — {snap?.account.company_name}</p>
          </div>
          <button onClick={refresh} disabled={refreshing} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh KPIs now
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {[
          { k: "kpis", label: "KPIs", icon: Activity },
          { k: "kb", label: "Knowledge Base", icon: BookOpen },
          { k: "targets", label: "KPI Targets", icon: Target },
          { k: "erp", label: "ERP Connection", icon: Database },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.k} onClick={() => setSubTab(t.k as SubTab)} className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs font-medium ${subTab === t.k ? "border-cyan-500 text-slate-900 bg-slate-50" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              <Icon size={12} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* KPIs sub-tab */}
      {subTab === "kpis" && (
        <div className="space-y-3">
          {!latest ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">No KPI snapshots yet. Click "Refresh KPIs now" above to compute the first one.</div>
          ) : (
            <>
              <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Latest snapshot ({latest.snapshot_date}) — source: {latest.source === "demo" ? "DEMO DATA" : latest.source === "erp_pull" ? "live ERP" : "manual"}</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  { label: "OTIF", value: latest.otif_pct, unit: "%", target: snap?.kpiTargets?.otif_target_pct },
                  { label: "Perfect Order", value: latest.perfect_order_pct, unit: "%", target: snap?.kpiTargets?.perfect_order_target_pct },
                  { label: "Freight/Revenue", value: latest.freight_to_revenue_pct, unit: "%", target: snap?.kpiTargets?.freight_to_revenue_target_pct },
                  { label: "Inventory Turns", value: latest.inventory_turns, unit: "", target: snap?.kpiTargets?.inventory_turns_target },
                  { label: "Order Fill Rate", value: latest.order_fill_rate_pct, unit: "%", target: snap?.kpiTargets?.order_fill_rate_target_pct },
                  { label: "Supplier OTIF", value: latest.supplier_otif_pct, unit: "%", target: snap?.kpiTargets?.supplier_otif_target_pct },
                  { label: "Damage Rate", value: latest.damage_rate_pct, unit: "%", target: snap?.kpiTargets?.damage_rate_target_pct },
                  { label: "Dead Stock", value: latest.dead_stock_pct, unit: "%", target: snap?.kpiTargets?.dead_stock_target_pct },
                ].map((k) => (
                  <div key={k.label} className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">{k.label}</p>
                    <p className="text-lg font-bold text-slate-900">
                      {k.value !== null && k.value !== undefined ? `${Number(k.value).toFixed(1)}${k.unit}` : <span className="text-slate-400 text-sm font-normal">n/a</span>}
                    </p>
                    <p className="text-[10px] text-slate-500">Target: {k.target !== null && k.target !== undefined ? `${Number(k.target).toFixed(1)}${k.unit}` : "not set"}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Orders (this window)</p>
                  <p className="text-sm font-semibold text-slate-900">{latest.orders_total}</p>
                  <p className="text-[10px] text-slate-500">{latest.orders_shipped_ontime} on-time · {latest.orders_shipped_infull} in-full</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Revenue</p>
                  <p className="text-sm font-semibold text-slate-900">${Math.round(Number(latest.revenue_usd ?? 0)).toLocaleString()}</p>
                  <p className="text-[10px] text-slate-500">Freight ${Math.round(Number(latest.freight_cost_usd ?? 0)).toLocaleString()}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Inventory Value</p>
                  <p className="text-sm font-semibold text-slate-900">${Math.round(Number(latest.inventory_value_usd ?? 0)).toLocaleString()}</p>
                </div>
              </div>
              <p className="text-[10px] text-slate-500">{snap?.kpiSnapshots?.length ?? 0} snapshots retained (last 30 days).</p>
            </>
          )}
        </div>
      )}

      {/* Knowledge Base sub-tab */}
      {subTab === "kb" && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-600">The persistent client knowledge that pins into every agent prompt when the client is Tier 3. This is what makes drafts read like they came from a Supply Chain Manager who knows the account cold.</p>

          <ListEditor
            title="SKUs on file"
            items={kbDraft.skus ?? []}
            onChange={(items) => setKbDraft({ ...kbDraft, skus: items })}
            columns={[
              { key: "sku", label: "SKU", type: "text" },
              { key: "description", label: "Description", type: "text" },
              { key: "hs_code", label: "HS code", type: "text" },
              { key: "lead_time_days", label: "Lead (d)", type: "number" },
              { key: "safety_stock_units", label: "Safety stock", type: "number" },
            ]}
          />
          <ListEditor
            title="Suppliers"
            items={kbDraft.suppliers ?? []}
            onChange={(items) => setKbDraft({ ...kbDraft, suppliers: items })}
            columns={[
              { key: "name", label: "Name", type: "text" },
              { key: "country", label: "Country", type: "text" },
              { key: "terms", label: "Terms", type: "text" },
              { key: "otif_target_pct", label: "OTIF %", type: "number" },
              { key: "contact_email", label: "Contact email", type: "text" },
            ]}
          />
          <ListEditor
            title="Lanes"
            items={kbDraft.lanes ?? []}
            onChange={(items) => setKbDraft({ ...kbDraft, lanes: items })}
            columns={[
              { key: "origin", label: "Origin", type: "text" },
              { key: "destination", label: "Destination", type: "text" },
              { key: "mode", label: "Mode", type: "text" },
              { key: "typical_carrier", label: "Carrier", type: "text" },
              { key: "typical_transit_days", label: "Transit (d)", type: "number" },
            ]}
          />
          <ListEditor
            title="Key customers"
            items={kbDraft.customers ?? []}
            onChange={(items) => setKbDraft({ ...kbDraft, customers: items })}
            columns={[
              { key: "name", label: "Name", type: "text" },
              { key: "priority_tier", label: "Priority", type: "text" },
              { key: "sla_notes", label: "SLA notes", type: "text" },
            ]}
          />
          <ListEditor
            title="Escalation ladder"
            items={kbDraft.escalation ?? []}
            onChange={(items) => setKbDraft({ ...kbDraft, escalation: items })}
            columns={[
              { key: "level", label: "L", type: "number" },
              { key: "name", label: "Name", type: "text" },
              { key: "role", label: "Role", type: "text" },
              { key: "phone", label: "Phone", type: "text" },
              { key: "email", label: "Email", type: "text" },
              { key: "when_to_call", label: "When to call", type: "text" },
            ]}
          />
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">ERP notes (freeform)</span>
            <textarea value={kbDraft.erp_notes ?? ""} onChange={(e) => setKbDraft({ ...kbDraft, erp_notes: e.target.value })} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs" placeholder="Anything specific to this client's ERP quirks — SKU aliasing, subsidiary mapping, revenue recognition quirks…" />
          </label>

          <div className="flex justify-end">
            <button onClick={saveKb} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save Knowledge Base
            </button>
          </div>
        </div>
      )}

      {/* KPI Targets sub-tab */}
      {subTab === "targets" && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-600">The thresholds their leadership sets with us. The weekly exec pack benchmarks against these and flags drift.</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {[
              { k: "otif_target_pct", label: "OTIF %", suffix: "%" },
              { k: "perfect_order_target_pct", label: "Perfect Order %", suffix: "%" },
              { k: "freight_to_revenue_target_pct", label: "Freight/Rev %", suffix: "%" },
              { k: "cash_to_cash_target_days", label: "Cash-to-Cash (d)", suffix: "d" },
              { k: "inventory_turns_target", label: "Inventory Turns", suffix: "" },
              { k: "order_fill_rate_target_pct", label: "Order Fill %", suffix: "%" },
              { k: "supplier_otif_target_pct", label: "Supplier OTIF %", suffix: "%" },
              { k: "damage_rate_target_pct", label: "Damage %", suffix: "%" },
              { k: "forecast_accuracy_mape_target_pct", label: "Forecast MAPE %", suffix: "%" },
              { k: "dead_stock_target_pct", label: "Dead Stock %", suffix: "%" },
            ].map((t) => (
              <label key={t.k} className="block">
                <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">{t.label}</span>
                <input
                  type="number"
                  step="0.1"
                  value={(targetsDraft as Record<string, number | null | undefined>)[t.k] ?? ""}
                  onChange={(e) => setTargetsDraft({ ...targetsDraft, [t.k]: e.target.value === "" ? null : Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                  placeholder={`target${t.suffix}`}
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={saveTargets} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save Targets
            </button>
          </div>
        </div>
      )}

      {/* ERP Connection sub-tab */}
      {subTab === "erp" && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-600">Pick their ERP. Demo mode ships realistic sample data so we can sell + demo Tier 3 before wiring live credentials. Switch to live once the client authorizes the connector.</p>
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Provider</span>
            <select value={erpDraft.provider} onChange={(e) => setErpDraft({ ...erpDraft, provider: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
              {providers.map((p) => (
                <option key={p.key} value={p.key}>{p.label}{p.liveWired ? "" : " (demo-only for now)"}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={erpDraft.demoMode} onChange={(e) => setErpDraft({ ...erpDraft, demoMode: e.target.checked })} />
            Demo mode (return sample data)
          </label>
          {snap?.erpConnection && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
              <p>Current: <span className="font-semibold">{snap.erpConnection.provider}</span> · status: <span className="font-semibold">{snap.erpConnection.connection_status}</span></p>
              <p>Last sync: {snap.erpConnection.last_sync_at ? new Date(snap.erpConnection.last_sync_at).toLocaleString() : "never"} {snap.erpConnection.last_sync_status ? `· ${snap.erpConnection.last_sync_status}` : ""}</p>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={saveErp} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save ERP Connection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Small inline editor for the array-of-object KB sections.
function ListEditor<T extends Record<string, unknown>>({
  title, items, onChange, columns,
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  columns: { key: string; label: string; type: "text" | "number" }[];
}) {
  function updateRow(i: number, key: string, value: string) {
    const col = columns.find((c) => c.key === key);
    const parsed = col?.type === "number" ? (value === "" ? undefined : Number(value)) : value;
    const next = items.slice();
    next[i] = { ...next[i], [key]: parsed } as T;
    onChange(next);
  }
  function addRow() {
    const blank = columns.reduce((acc, c) => ({ ...acc, [c.key]: c.type === "number" ? undefined : "" }), {} as Record<string, unknown>);
    onChange([...items, blank as T]);
  }
  function removeRow(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold text-slate-800">{title}</p>
        <button onClick={addRow} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
          <Plus size={11} /> Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-[11px] text-slate-500">No entries yet.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {items.map((row, i) => (
            <div key={i} className="grid grid-cols-1 items-center gap-1 px-3 py-2 md:grid-cols-6">
              {columns.map((c) => (
                <input
                  key={c.key}
                  type={c.type === "number" ? "number" : "text"}
                  value={(row[c.key] as string | number | undefined) ?? ""}
                  onChange={(e) => updateRow(i, c.key, e.target.value)}
                  placeholder={c.label}
                  className="rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                />
              ))}
              <button onClick={() => removeRow(i)} className="text-[11px] text-rose-600 hover:text-rose-700 md:justify-self-end"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
