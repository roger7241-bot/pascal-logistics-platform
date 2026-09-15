// ============================================================================
// CarrierScorecardWidget
// The "your carriers, ranked by performance" card. Shows the top 5
// carriers on file for the client's org, sorted by on-time %. Signals
// the desk is running vendor management — one of the classic supply-
// chain manager responsibilities — without the client needing to log
// into a separate TMS to see it.
//
// Universal (renders for every client profile). Domestic-only shippers
// have carriers too; the metric is not cross-border-gated.
// ============================================================================

import { useEffect, useState } from "react";
import { Truck, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api, ApiError } from "../config/api";

interface CarrierRow {
  carrierName: string;
  integrationStatus: string;
  onTimePct?: number;
  claimsRatePct?: number;
}

interface Summary {
  carrierScorecard?: CarrierRow[];
}

function scoreClass(onTimePct: number | undefined): string {
  if (onTimePct === undefined) return "text-slate-400";
  if (onTimePct >= 95) return "text-emerald-700";
  if (onTimePct >= 85) return "text-slate-700";
  return "text-rose-700";
}

function scoreIcon(onTimePct: number | undefined) {
  if (onTimePct === undefined) return <Minus size={11} />;
  if (onTimePct >= 95) return <TrendingUp size={11} />;
  if (onTimePct >= 85) return <Minus size={11} />;
  return <TrendingDown size={11} />;
}

export function CarrierScorecardWidget() {
  const [rows, setRows] = useState<CarrierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.clientPortalSummary<Summary>();
        if (cancelled) return;
        setRows(result.carrierScorecard ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load carrier scorecard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <Truck size={16} className="text-slate-700" />
          <p className="text-sm font-bold text-slate-900">Your carriers — this month</p>
        </div>
        <p className="text-[11px] font-mono text-slate-400">On-time · claims/OS&amp;D</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <p className="px-5 py-6 text-center text-xs text-slate-500">{error}</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-500">
          No carrier accounts linked yet. Your operator will add carriers to the desk as they get set up.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <div key={`${r.carrierName}-${i}`} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{r.carrierName}</p>
                <p className="text-[11px] text-slate-500">{r.integrationStatus.replace(/_/g, " ")}</p>
              </div>
              <div className={`flex items-center gap-4 text-xs font-mono ${scoreClass(r.onTimePct)}`}>
                <span className="inline-flex items-center gap-1">
                  {scoreIcon(r.onTimePct)}
                  {r.onTimePct !== undefined ? `${r.onTimePct.toFixed(1)}%` : "—"}
                </span>
                <span className="text-slate-500">
                  {r.claimsRatePct !== undefined ? `${r.claimsRatePct.toFixed(1)}%` : "—"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
