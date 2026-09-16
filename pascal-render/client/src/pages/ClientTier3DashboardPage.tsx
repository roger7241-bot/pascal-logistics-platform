// ============================================================================
// ClientTier3DashboardPage
// The Tier 3 executive dashboard the CLIENT sees. Their CFO / VP Ops opens
// this Monday morning and sees exactly the numbers a $120K in-house Supply
// Chain Manager would deliver on a weekly deck — but live, always.
//
// NO knowledge base, NO ERP credentials, NO agent internals surface here.
// Just KPIs vs targets, week-over-week trends, and the raw underlying counts.
// Non-Tier-3 clients see a paywall-style upgrade prompt.
// ============================================================================

import { useEffect, useState } from "react";
import { Activity, TrendingUp, TrendingDown, Minus, AlertCircle, Loader2, Lock } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

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

interface KpiTargets {
  otif_target_pct?: number | null;
  perfect_order_target_pct?: number | null;
  freight_to_revenue_target_pct?: number | null;
  cash_to_cash_target_days?: number | null;
  inventory_turns_target?: number | null;
  order_fill_rate_target_pct?: number | null;
  supplier_otif_target_pct?: number | null;
  damage_rate_target_pct?: number | null;
  dead_stock_target_pct?: number | null;
}

interface DashboardResponse {
  account: { org_id: string; company_name: string; retainer_tier: string | null };
  kpiTargets: KpiTargets | null;
  kpiSnapshots: KpiSnapshot[];
}

type NumericKey = keyof Pick<KpiSnapshot, "otif_pct" | "perfect_order_pct" | "freight_to_revenue_pct" | "inventory_turns" | "order_fill_rate_pct" | "supplier_otif_pct" | "damage_rate_pct" | "dead_stock_pct">;

function trend(latest: number | null, prior: number | null, higherIsBetter: boolean): { arrow: JSX.Element; delta: string; color: string } {
  if (latest === null || prior === null || latest === undefined || prior === undefined) {
    return { arrow: <Minus size={12} />, delta: "n/a", color: "text-slate-400" };
  }
  const d = Number(latest) - Number(prior);
  if (Math.abs(d) < 0.05) return { arrow: <Minus size={12} />, delta: "flat", color: "text-slate-500" };
  const good = higherIsBetter ? d > 0 : d < 0;
  return {
    arrow: d > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />,
    delta: `${d > 0 ? "+" : ""}${d.toFixed(1)}`,
    color: good ? "text-emerald-700" : "text-rose-700",
  };
}

export function ClientTier3DashboardPage() {
  const [data, setData] = useState<DashboardResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const preview = params.get("orgId") ?? undefined;
        const d = await api.clientTier3Dashboard<DashboardResponse>(preview);
        setData(d);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setLocked(true);
        } else {
          setError(err instanceof ApiError ? err.message : "Failed to load dashboard.");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppHeader />
        <div className="mx-auto max-w-6xl p-6"><div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading dashboard…</div></div>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppHeader />
        <div className="mx-auto max-w-2xl p-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Lock size={16} className="text-slate-700" />
              <h1 className="text-lg font-bold">Supply Chain Manager tier</h1>
            </div>
            <p className="text-sm text-slate-600 mb-3">The Executive Dashboard is included with the Tier 3 (Supply Chain Manager) retainer. Your leadership team sees:</p>
            <ul className="mb-4 list-disc list-inside space-y-1 text-xs text-slate-600">
              <li>OTIF, Perfect Order, Freight-to-Revenue, Inventory Turns benchmarked vs your targets</li>
              <li>Supplier OTIF + Order Fill Rate + Damage Rate + Dead Stock visibility</li>
              <li>A weekly executive pack drafted every Friday, sent Monday morning</li>
              <li>Every KPI grounded in your live ERP data — NetSuite, QuickBooks, Dynamics, Sage, Oracle, SAP, or Odoo</li>
            </ul>
            <p className="text-xs text-slate-500">Talk to Roger about upgrading — <a className="text-cyan-700 hover:underline" href="mailto:operations@pascallogistics.com">operations@pascallogistics.com</a>.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppHeader />
        <div className="mx-auto max-w-6xl p-6">
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error ?? "Dashboard unavailable."}</span>
          </div>
        </div>
      </div>
    );
  }

  const latest = data.kpiSnapshots[0];
  const priorWeek = data.kpiSnapshots.find((s, i) => i > 0 && (new Date(latest.snapshot_date).getTime() - new Date(s.snapshot_date).getTime()) >= 6 * 86_400_000) ?? data.kpiSnapshots[data.kpiSnapshots.length - 1];
  const targets = data.kpiTargets ?? {};

  const kpis: { label: string; latestKey: NumericKey; targetKey: keyof KpiTargets; higherIsBetter: boolean; unit: string }[] = [
    { label: "OTIF", latestKey: "otif_pct", targetKey: "otif_target_pct", higherIsBetter: true, unit: "%" },
    { label: "Perfect Order", latestKey: "perfect_order_pct", targetKey: "perfect_order_target_pct", higherIsBetter: true, unit: "%" },
    { label: "Freight / Revenue", latestKey: "freight_to_revenue_pct", targetKey: "freight_to_revenue_target_pct", higherIsBetter: false, unit: "%" },
    { label: "Inventory Turns", latestKey: "inventory_turns", targetKey: "inventory_turns_target", higherIsBetter: true, unit: "" },
    { label: "Order Fill Rate", latestKey: "order_fill_rate_pct", targetKey: "order_fill_rate_target_pct", higherIsBetter: true, unit: "%" },
    { label: "Supplier OTIF", latestKey: "supplier_otif_pct", targetKey: "supplier_otif_target_pct", higherIsBetter: true, unit: "%" },
    { label: "Damage Rate", latestKey: "damage_rate_pct", targetKey: "damage_rate_target_pct", higherIsBetter: false, unit: "%" },
    { label: "Dead Stock", latestKey: "dead_stock_pct", targetKey: "dead_stock_target_pct", higherIsBetter: false, unit: "%" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-slate-700" />
            <h1 className="text-xl font-bold">Executive Dashboard</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">
              {data.account.company_name} · updated {latest?.snapshot_date ?? "n/a"}
            </span>
          </div>
          {latest?.source === "demo" && (
            <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-violet-800">Demo data</span>
          )}
        </div>

        {!latest ? (
          <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-600">
            The first KPI snapshot lands overnight after your ERP is connected. Talk to Roger if this doesn't populate by tomorrow morning.
          </div>
        ) : (
          <>
            {/* KPI grid */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((k) => {
                const val = latest[k.latestKey] as number | null;
                const priorVal = priorWeek ? (priorWeek[k.latestKey] as number | null) : null;
                const target = targets[k.targetKey] as number | null | undefined;
                const t = trend(val, priorVal, k.higherIsBetter);
                let statusColor = "border-slate-200";
                if (val !== null && val !== undefined && target !== null && target !== undefined) {
                  const meets = k.higherIsBetter ? Number(val) >= Number(target) : Number(val) <= Number(target);
                  statusColor = meets ? "border-emerald-300" : "border-rose-300";
                }
                return (
                  <div key={k.label} className={`rounded-lg border-2 bg-white p-4 shadow-sm ${statusColor}`}>
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">{k.label}</p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <p className="text-2xl font-bold text-slate-900">
                        {val !== null && val !== undefined ? `${Number(val).toFixed(1)}${k.unit}` : <span className="text-slate-400 text-base font-normal">n/a</span>}
                      </p>
                      <div className={`flex items-center gap-0.5 text-[11px] ${t.color}`}>{t.arrow} {t.delta}</div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">Target: {target !== null && target !== undefined ? `${Number(target).toFixed(1)}${k.unit}` : "not set"}</p>
                  </div>
                );
              })}
            </section>

            {/* Underlying counts */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Orders</p>
                <p className="text-xl font-bold text-slate-900">{latest.orders_total}</p>
                <p className="text-[11px] text-slate-500">{latest.orders_shipped_ontime} on-time · {latest.orders_shipped_infull} in-full</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Revenue</p>
                <p className="text-xl font-bold text-slate-900">${Math.round(Number(latest.revenue_usd ?? 0)).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Freight cost</p>
                <p className="text-xl font-bold text-slate-900">${Math.round(Number(latest.freight_cost_usd ?? 0)).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Inventory value</p>
                <p className="text-xl font-bold text-slate-900">${Math.round(Number(latest.inventory_value_usd ?? 0)).toLocaleString()}</p>
              </div>
            </section>

            {/* Trend history */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <p className="text-sm font-bold text-slate-900">30-day KPI history</p>
                <p className="text-[11px] text-slate-500">Newest first. Raw daily rollups powering the numbers above.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-mono uppercase text-[10px]">Date</th>
                      <th className="px-3 py-2 text-right font-mono uppercase text-[10px]">OTIF</th>
                      <th className="px-3 py-2 text-right font-mono uppercase text-[10px]">Perfect Order</th>
                      <th className="px-3 py-2 text-right font-mono uppercase text-[10px]">Freight/Rev</th>
                      <th className="px-3 py-2 text-right font-mono uppercase text-[10px]">Inv Turns</th>
                      <th className="px-3 py-2 text-right font-mono uppercase text-[10px]">Supplier OTIF</th>
                      <th className="px-3 py-2 text-right font-mono uppercase text-[10px]">Orders</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.kpiSnapshots.map((s) => (
                      <tr key={s.snapshot_date}>
                        <td className="px-3 py-2 text-slate-700">{s.snapshot_date}</td>
                        <td className="px-3 py-2 text-right">{s.otif_pct !== null ? `${Number(s.otif_pct).toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right">{s.perfect_order_pct !== null ? `${Number(s.perfect_order_pct).toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right">{s.freight_to_revenue_pct !== null ? `${Number(s.freight_to_revenue_pct).toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right">{s.inventory_turns !== null ? Number(s.inventory_turns).toFixed(2) : "—"}</td>
                        <td className="px-3 py-2 text-right">{s.supplier_otif_pct !== null ? `${Number(s.supplier_otif_pct).toFixed(1)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right">{s.orders_total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
