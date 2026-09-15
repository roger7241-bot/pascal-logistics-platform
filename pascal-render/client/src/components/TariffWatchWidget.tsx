// ============================================================================
// TariffWatchWidget
// Client-facing tariff monitoring. Renders the tariff_updates matching the
// client's tracked_hs_codes; falls back to the freshest updates when no
// codes are tracked so a newly-onboarded client still sees the widget
// populated. This is the visible face of the tariff-monitoring service
// on the Client Portal — the reason a supply-chain manager exists, minus
// the salary line. Should only render for cross-border-shipping clients
// (parent gates on isCrossBorder(caps)).
// ============================================================================

import { useEffect, useState } from "react";
import { Radio, ExternalLink, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { api, ApiError } from "../config/api";

interface TariffUpdate {
  id: string;
  hs_code: string;
  hs_description: string | null;
  direction: "US_TO_CA" | "CA_TO_US" | "US_INBOUND" | "CA_INBOUND" | "BILATERAL";
  mechanism: string;
  headline: string;
  summary: string;
  old_rate: string | null;
  new_rate: string | null;
  rate_delta_pct: string | null;
  effective_date: string | null;
  source_url: string | null;
  severity: "critical" | "notice" | "info";
  published_at: string;
}

const DIRECTION_LABEL: Record<TariffUpdate["direction"], string> = {
  US_TO_CA: "US → CA",
  CA_TO_US: "CA → US",
  US_INBOUND: "US inbound",
  CA_INBOUND: "CA inbound",
  BILATERAL: "Bilateral",
};

const SEVERITY_CLASS: Record<TariffUpdate["severity"], string> = {
  critical: "bg-rose-100 text-rose-700 border-rose-200",
  notice: "bg-amber-100 text-amber-700 border-amber-200",
  info: "bg-sky-100 text-sky-700 border-sky-200",
};

export function TariffWatchWidget() {
  const [updates, setUpdates] = useState<TariffUpdate[]>([]);
  const [tracked, setTracked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.clientTariffUpdates<{ tariffUpdates: TariffUpdate[]; trackedHsCodes: string[] }>(8);
        if (cancelled) return;
        setUpdates(result.tariffUpdates);
        setTracked(result.trackedHsCodes);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load tariff updates.");
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
          <Radio size={16} className="text-slate-700" />
          <p className="text-sm font-bold text-slate-900">Tariff Watch</p>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-emerald-700">Live</span>
        </div>
        <div className="text-[11px] font-mono text-slate-400">
          {tracked.length > 0 ? `Filtered to your ${tracked.length} tracked HS ${tracked.length === 1 ? "code" : "codes"}` : "Recent updates"}
        </div>
      </div>

      {error && (
        <div className="mx-5 my-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" />
          Loading policy watch…
        </div>
      ) : updates.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          {tracked.length > 0 ? (
            <>No recent updates on your tracked HS codes ({tracked.join(", ")}). Your desk is watching in the background.</>
          ) : (
            <>No updates to display yet.</>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {updates.map((u) => {
            const delta = u.rate_delta_pct !== null ? Number(u.rate_delta_pct) : null;
            const effective = u.effective_date ? new Date(u.effective_date).toLocaleDateString() : null;
            const published = new Date(u.published_at);
            const isExpanded = expanded === u.id;
            return (
              <div key={u.id} className="px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-start gap-3">
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide ${SEVERITY_CLASS[u.severity]}`}>
                    {u.mechanism}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 leading-tight">{u.headline}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono text-slate-700">HS {u.hs_code}</span>
                      <span>{DIRECTION_LABEL[u.direction]}</span>
                      {delta !== null && delta !== 0 && (
                        <span className={`font-mono ${delta > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                          {delta > 0 ? "+" : ""}{delta.toFixed(1)} pp
                        </span>
                      )}
                      {effective && <span>Effective {effective}</span>}
                      <span className="text-slate-400">· Filed {published.toLocaleDateString()}</span>
                    </p>
                    {isExpanded && (
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">{u.summary}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? undefined : u.id)}
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-700 inline-flex items-center gap-0.5"
                      >
                        {isExpanded ? "Hide" : "Read summary"} <ArrowRight size={10} />
                      </button>
                      {u.source_url && (
                        <a href={u.source_url} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-cyan-700 hover:text-cyan-900 inline-flex items-center gap-0.5">
                          Source <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
