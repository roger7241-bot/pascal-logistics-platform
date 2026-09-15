// ============================================================================
// SpotRateExplorer
// Client-facing spot rate lookup for the Client Portal. Same backend as the
// operator QuoteComparisonPanel but the endpoint auto-scopes to the
// authenticated client's own org — no orgId passed from the browser.
// "Request Pascal to book this" doesn't book directly; it opens the intake
// wizard preloaded with the winning carrier, so the operator still runs
// the booking pipeline and can catch capacity/PARS/DG issues before
// dispatch.
// ============================================================================

import { useState } from "react";
import { Search, Loader2, TrendingDown, TrendingUp, Info, AlertCircle, ArrowRight } from "lucide-react";
import { api, ApiError } from "../config/api";
import { WeightInput } from "./WeightInput";

interface IncumbentRate {
  id: string;
  carrierName: string;
  serviceLevel?: string;
  transitDays?: number;
  totalRateUsd: number;
  effectiveDateIso?: string;
  rateSource: string;
}

interface ComparedQuote {
  carrierName: string;
  serviceLevel?: string;
  transitDays?: number;
  totalUsd: number;
  expirationDateIso?: string;
  savingsVsIncumbentUsd?: number;
  savingsVsIncumbentPct?: number;
}

interface CompareResponse {
  incumbent?: IncumbentRate;
  quotes: ComparedQuote[];
  mode?: "LTL" | "FTL";
  priority1Simulated: boolean;
  priority1Demo?: boolean;
  priority1Error?: string;
}

const NMFC_CLASSES = ["50", "55", "60", "65", "70", "77.5", "85", "92.5", "100", "110", "125", "150", "175", "200", "250", "300", "400", "500"] as const;
const TRAILER_TYPES = ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Conestoga", "Straight Truck"] as const;

interface Props {
  onBookRequest?: (payload: { carrierName: string; originZip: string; destinationZip: string; pickupDateIso: string; totalUsd: number }) => void;
}

export function SpotRateExplorer({ onBookRequest }: Props) {
  const [originZip, setOriginZip] = useState("");
  const [destinationZip, setDestinationZip] = useState("");
  const [pickupDate, setPickupDate] = useState(new Date().toISOString().split("T")[0]);
  const [weightLbs, setWeightLbs] = useState("500");
  const [freightClass, setFreightClass] = useState("150");
  const [mode, setMode] = useState<"LTL" | "FTL">("LTL");
  const [trailerType, setTrailerType] = useState<string>("Dry Van");
  const units = "1";

  const [result, setResult] = useState<CompareResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!originZip || !destinationZip || !weightLbs) return;
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await api.clientQuoteCompare<CompareResponse>({
        originZip: originZip.trim(),
        destinationZip: destinationZip.trim(),
        pickupDateIso: `${pickupDate}T00:00:00Z`,
        mode,
        trailerType: mode === "FTL" ? trailerType : undefined,
        items: [
          {
            freightClass: mode === "LTL" ? freightClass : "100",
            packagingType: mode === "FTL" ? "Full Trailer" : "Pallet",
            units: Number(units),
            pieces: Number(units),
            totalWeightLbs: Number(weightLbs),
            lengthIn: 48,
            widthIn: 40,
            heightIn: 40,
          },
        ],
      });
      setResult(response);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to fetch rates.");
    } finally {
      setLoading(false);
    }
  }

  function handleBook(q: ComparedQuote) {
    if (onBookRequest) {
      onBookRequest({
        carrierName: q.carrierName,
        originZip,
        destinationZip,
        pickupDateIso: `${pickupDate}T00:00:00Z`,
        totalUsd: q.totalUsd,
      });
    } else {
      alert(`We'll pass along your interest in booking ${q.carrierName} at $${q.totalUsd.toFixed(2)} to your Pascal Logistics operator. They'll confirm carrier availability and PARS/PAPS readiness before dispatch.`);
    }
  }

  const best = result?.quotes?.[0];
  const bestSavings = best?.savingsVsIncumbentUsd;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-slate-700" />
          <p className="text-sm font-bold">Spot Rate Explorer</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">Planning only · Operator confirms every booking</span>
        </div>
        {result && (
          <button onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
      </div>

      <form onSubmit={run} className="grid grid-cols-2 gap-3 p-5 md:grid-cols-6">
        <label className="col-span-1 text-xs font-medium text-slate-600 uppercase tracking-wide">Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as "LTL" | "FTL")} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none">
            <option value="LTL">LTL — less-than-truckload</option>
            <option value="FTL">FTL — full truckload</option>
          </select>
        </label>
        <label className="col-span-1 text-xs font-medium text-slate-600 uppercase tracking-wide">Origin ZIP / Postal
          <input value={originZip} onChange={(e) => setOriginZip(e.target.value)} required maxLength={10} placeholder="98230 or V4A 9V4" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
        </label>
        <label className="col-span-1 text-xs font-medium text-slate-600 uppercase tracking-wide">Dest. ZIP / Postal
          <input value={destinationZip} onChange={(e) => setDestinationZip(e.target.value)} required maxLength={10} placeholder="60606 or M5V 2E7" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
        </label>
        <label className="col-span-1 text-xs font-medium text-slate-600 uppercase tracking-wide">Pickup date
          <input value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
        </label>
        <div className="col-span-1">
          <WeightInput valueLbs={weightLbs} onChangeLbs={setWeightLbs} required minLbs={1} placeholder="500" label="Weight" />
        </div>
        {mode === "LTL" ? (
          <label className="col-span-1 text-xs font-medium text-slate-600 uppercase tracking-wide">Freight class
            <select value={freightClass} onChange={(e) => setFreightClass(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none">
              {NMFC_CLASSES.map((cls) => (
                <option key={cls} value={cls}>Class {cls}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="col-span-1 text-xs font-medium text-slate-600 uppercase tracking-wide">Trailer type
            <select value={trailerType} onChange={(e) => setTrailerType(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none">
              {TRAILER_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <div className="col-span-2 flex items-end md:col-span-6">
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
            Compare {mode} rates
          </button>
        </div>
      </form>

      {(error || result?.priority1Error) && (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error ?? result?.priority1Error}</span>
        </div>
      )}

      {result?.priority1Demo && (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 text-xs text-violet-800">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          <span><strong>Demo rates</strong> — Pascal Logistics is currently in a rate-vendor evaluation. Numbers below are illustrative real carrier names with realistic pricing. Live rates coming shortly.</span>
        </div>
      )}

      {result && !result.incumbent && result.quotes.length > 0 && (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          <span>No rate on file for this lane, so savings can&rsquo;t be shown yet. Your Pascal Logistics operator will backfill your incumbent rate so future comparisons show what you would save.</span>
        </div>
      )}

      {result && expanded && result.quotes.length > 0 && (
        <>
          {result.incumbent && (
            <div className="mx-5 mb-4 rounded-lg border-2 border-slate-900 bg-slate-50 p-3">
              <div className="text-[10px] font-mono uppercase tracking-wide text-slate-500 mb-1">Your rate on file (incumbent)</div>
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{result.incumbent.carrierName}</div>
                  <div className="text-xs text-slate-500">{result.incumbent.serviceLevel ?? "—"} · {result.incumbent.transitDays ? `${result.incumbent.transitDays}d` : "—"} · from {result.incumbent.rateSource}</div>
                </div>
                <div className="text-xl font-mono font-semibold text-slate-900">${result.incumbent.totalRateUsd.toFixed(2)}</div>
              </div>
            </div>
          )}

          {best && bestSavings !== undefined && bestSavings > 0 && (
            <div className="mx-5 mb-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
              <TrendingDown size={14} />
              <span>Best option: <strong>{best.carrierName}</strong> at ${best.totalUsd.toFixed(2)} — <strong>saves ${bestSavings.toFixed(2)} ({best.savingsVsIncumbentPct?.toFixed(1)}%)</strong> vs your incumbent.</span>
            </div>
          )}

          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 pr-3">Carrier</th>
                  <th className="text-left py-2 pr-3">Service</th>
                  <th className="text-right py-2 pr-3">Transit</th>
                  <th className="text-right py-2 pr-3">Total</th>
                  <th className="text-right py-2 pr-3">Savings</th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {result.quotes.map((q, i) => {
                  const savings = q.savingsVsIncumbentUsd;
                  const cls = savings === undefined ? "text-slate-400" : savings > 0 ? "text-emerald-700" : savings < 0 ? "text-rose-600" : "text-slate-500";
                  return (
                    <tr key={`${q.carrierName}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 pr-3 font-medium text-slate-900">{q.carrierName}</td>
                      <td className="py-2 pr-3 text-slate-600">{q.serviceLevel ?? "—"}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{q.transitDays ? `${q.transitDays}d` : "—"}</td>
                      <td className="py-2 pr-3 text-right font-mono font-medium text-slate-900">${q.totalUsd.toFixed(2)}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${cls}`}>
                        {savings === undefined ? "—" : (
                          <span className="inline-flex items-center gap-1 justify-end">
                            {savings > 0 ? <TrendingDown size={11} /> : savings < 0 ? <TrendingUp size={11} /> : null}
                            ${Math.abs(savings).toFixed(2)}
                            {q.savingsVsIncumbentPct !== undefined && <span className="text-[10px] text-slate-500">({q.savingsVsIncumbentPct.toFixed(1)}%)</span>}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleBook(q)}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-cyan-50 hover:border-cyan-300"
                        >
                          Request booking
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
