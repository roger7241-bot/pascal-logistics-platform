// ============================================================================
// ClientHtsLookupPage
// Warehouse-first HTS lookup. Type "8471" or "laptop" — get classification,
// current US + CA duty rates (MFN vs USMCA), any Section 232 / 301 flags,
// recent tariff activity affecting the code, and a quick duty calculator.
// NOT customs advisory — every real classification decision routes to the
// client's broker of record. Line at the top says so.
// ============================================================================

import { useState } from "react";
import { Search, Loader2, AlertCircle, ExternalLink, Info, Calculator } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

interface HtsRow {
  hs_code: string;
  chapter: string;
  short_description: string;
  full_description: string | null;
  us_mfn_rate_pct: string | null;
  us_usmca_rate_pct: string | null;
  ca_mfn_rate_pct: string | null;
  ca_usmca_rate_pct: string | null;
  us_section_232: boolean;
  us_section_301: boolean;
  add_cvd_flag: boolean;
  common_synonyms: string[] | null;
  notes: string | null;
}

interface TariffActivity {
  external_ref: string | null;
  hs_code: string;
  headline: string;
  summary: string;
  severity: string;
  effective_date: string | null;
  source_url: string | null;
  old_rate: string | null;
  new_rate: string | null;
  rate_delta_pct: string | null;
  published_at: string;
  mechanism: string;
  direction: string;
}

interface DutyPreview {
  appliedRatePct: number;
  dutyUsd: number;
  additionalFees: Array<{ label: string; amountUsd: number; notes: string }>;
  totalDutyAndFeesUsd: number;
  warning: string | null;
}

function fmtRate(v: string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return `${n.toFixed(2)}%`;
}

export function ClientHtsLookupPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HtsRow[]>([]);
  const [selected, setSelected] = useState<HtsRow | undefined>();
  const [activity, setActivity] = useState<TariffActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [dutyValue, setDutyValue] = useState("10000");
  const [dutySide, setDutySide] = useState<"US" | "CA">("US");
  const [dutyUsmca, setDutyUsmca] = useState(false);
  const [dutyPreview, setDutyPreview] = useState<DutyPreview | undefined>();
  const [dutyLoading, setDutyLoading] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    setError(undefined);
    setSelected(undefined);
    setActivity([]);
    setDutyPreview(undefined);
    try {
      const r = await api.htsLookup<{ results: HtsRow[] }>("client", query.trim());
      setResults(r.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function pick(row: HtsRow) {
    setSelected(row);
    setDutyPreview(undefined);
    try {
      const d = await api.htsGet<{ classification: HtsRow; recentTariffActivity: TariffActivity[] }>("client", row.hs_code);
      setSelected(d.classification);
      setActivity(d.recentTariffActivity);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load HS detail.");
    }
  }

  async function preview() {
    if (!selected) return;
    setDutyLoading(true);
    setError(undefined);
    try {
      const d = await api.htsDutyPreview<DutyPreview>("client", {
        hsCode: selected.hs_code,
        declaredValueUsd: Number(dutyValue) || 0,
        importSide: dutySide,
        useUsmca: dutyUsmca,
      });
      setDutyPreview(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Duty preview failed.");
    } finally {
      setDutyLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Search size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">HTS / HS Code Lookup</h1>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 flex items-start gap-2">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          <span>Working reference for our warehouse team. <strong>Not binding customs advice</strong> — every entry classification is confirmed by your broker of record before we file.</span>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* Search */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
              placeholder="HS code (e.g. 8471) or product name (e.g. 'laptop', 'plywood', 'bracket')"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button onClick={search} disabled={loading || !query.trim()} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              Search
            </button>
          </div>
        </section>

        {results.length > 0 && !selected && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3">
              <p className="text-sm font-bold text-slate-900">{results.length} match{results.length === 1 ? "" : "es"}</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {results.map((r) => (
                <li key={r.hs_code}>
                  <button onClick={() => pick(r)} className="w-full px-5 py-3 text-left hover:bg-slate-50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800">{r.hs_code}</span>
                      {r.us_section_232 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-800">§232</span>}
                      {r.us_section_301 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-800">§301</span>}
                      {r.add_cvd_flag && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-800">ADD/CVD</span>}
                    </div>
                    <p className="text-sm text-slate-900">{r.short_description}</p>
                    <p className="text-[11px] text-slate-500">Chapter {r.chapter} · US MFN {fmtRate(r.us_mfn_rate_pct)} / USMCA {fmtRate(r.us_usmca_rate_pct)} · CA MFN {fmtRate(r.ca_mfn_rate_pct)} / CUSMA {fmtRate(r.ca_usmca_rate_pct)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {selected && (
          <>
            <section className="rounded-xl border-2 border-cyan-300 bg-cyan-50/30 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded bg-white border border-cyan-300 px-2 py-1 font-mono text-sm font-bold text-cyan-900">{selected.hs_code}</span>
                    {selected.us_section_232 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-800">Section 232</span>}
                    {selected.us_section_301 && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-800">Section 301</span>}
                    {selected.add_cvd_flag && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-800">ADD/CVD</span>}
                  </div>
                  <p className="text-lg font-bold text-slate-900">{selected.short_description}</p>
                  {selected.full_description && <p className="text-xs text-slate-600 mt-1">{selected.full_description}</p>}
                  {selected.notes && <p className="text-[11px] text-amber-800 italic mt-1">{selected.notes}</p>}
                </div>
                <button onClick={() => { setSelected(undefined); setActivity([]); setDutyPreview(undefined); }} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">US Import</p>
                  <p className="text-sm font-semibold text-slate-900">MFN {fmtRate(selected.us_mfn_rate_pct)}</p>
                  <p className="text-sm font-semibold text-emerald-700">USMCA {fmtRate(selected.us_usmca_rate_pct)}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">CA Import</p>
                  <p className="text-sm font-semibold text-slate-900">MFN {fmtRate(selected.ca_mfn_rate_pct)}</p>
                  <p className="text-sm font-semibold text-emerald-700">CUSMA {fmtRate(selected.ca_usmca_rate_pct)}</p>
                </div>
              </div>
            </section>

            {/* Duty preview */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Calculator size={14} className="text-slate-700" />
                <p className="text-sm font-bold text-slate-900">Quick duty preview</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={dutyValue} onChange={(e) => setDutyValue(e.target.value)} placeholder="Declared value (USD)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <select value={dutySide} onChange={(e) => setDutySide(e.target.value as "US" | "CA")} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  <option value="US">Importing to US</option>
                  <option value="CA">Importing to CA</option>
                </select>
                <label className="flex items-center gap-1 text-[11px] text-slate-700">
                  <input type="checkbox" checked={dutyUsmca} onChange={(e) => setDutyUsmca(e.target.checked)} />
                  USMCA / CUSMA qualifying
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <button onClick={preview} disabled={dutyLoading} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {dutyLoading ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />}
                  Calculate
                </button>
              </div>
              {dutyPreview && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Applied rate {dutyPreview.appliedRatePct.toFixed(2)}%</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">${dutyPreview.dutyUsd.toLocaleString()}</p>
                  <p className="text-[11px] text-slate-500">Duty on ${Number(dutyValue).toLocaleString()} declared value</p>
                  {dutyPreview.additionalFees.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                      {dutyPreview.additionalFees.map((f, i) => (
                        <li key={i} className="flex justify-between"><span>{f.label}</span><span className="font-mono">${f.amountUsd.toFixed(2)}</span></li>
                      ))}
                      <li className="border-t border-slate-200 pt-1 mt-1 flex justify-between font-semibold"><span>Total duty + fees</span><span className="font-mono">${dutyPreview.totalDutyAndFeesUsd.toFixed(2)}</span></li>
                    </ul>
                  )}
                  {dutyPreview.warning && <p className="mt-2 text-[11px] text-rose-800">{dutyPreview.warning}</p>}
                </div>
              )}
            </section>

            {activity.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-3">
                  <p className="text-sm font-bold text-slate-900">Recent tariff activity on {selected.hs_code}</p>
                  <p className="text-[11px] text-slate-500">From Federal Register / CBSA / trade publications</p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {activity.map((a) => (
                    <li key={a.external_ref ?? a.headline} className="px-5 py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase ${a.severity === "critical" ? "border-rose-300 bg-rose-50 text-rose-800" : a.severity === "notice" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300 bg-slate-50 text-slate-600"}`}>{a.severity}</span>
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-600">{a.mechanism}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{a.headline}</p>
                      <p className="text-[11px] text-slate-600 mt-1">{a.summary}</p>
                      <p className="text-[10px] text-slate-500 mt-1">Effective {a.effective_date ?? "TBD"} · published {new Date(a.published_at).toLocaleDateString()}</p>
                      {a.source_url && <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-700 hover:underline flex items-center gap-1 mt-1"><ExternalLink size={10} /> Source</a>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
