// ============================================================================
// QuoteComparisonPanel
// Live Priority1 LTL rate comparison against the client's incumbent
// carrier rate on file. Drop into an operator/CRM view where you already
// know the client's orgId. Shows the incumbent rate pinned at top, then
// Priority1 carriers sorted cheapest-first with $ and % savings vs.
// incumbent. If no incumbent on file for the lane, just shows quotes.
// If PRIORITY1_API_KEY isn't configured in the server env, the response
// flags simulated:true and quotes will be empty — visible as a warning.
// ============================================================================

import { useState } from "react";
import { Search, Loader2, ArrowRight, TrendingDown, TrendingUp, AlertCircle, Info } from "lucide-react";
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
  orgId: string;
  defaultOriginZip?: string;
  defaultDestinationZip?: string;
  title?: string;
}

export function QuoteComparisonPanel({ orgId, defaultOriginZip = "", defaultDestinationZip = "", title = "Priority1 quote comparison" }: Props) {
  const [originZip, setOriginZip] = useState(defaultOriginZip);
  const [destinationZip, setDestinationZip] = useState(defaultDestinationZip);
  const [pickupDate, setPickupDate] = useState(new Date().toISOString().split("T")[0]);
  const [weightLbs, setWeightLbs] = useState("275");
  const [freightClass, setFreightClass] = useState("150");
  const [packagingType, setPackagingType] = useState("Pallet");
  const [units, setUnits] = useState("1");
  const [mode, setMode] = useState<"LTL" | "FTL">("LTL");
  const [trailerType, setTrailerType] = useState<string>("Dry Van");

  const [result, setResult] = useState<CompareResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function runComparison(e: React.FormEvent) {
    e.preventDefault();
    if (!originZip || !destinationZip || !weightLbs) return;

    setLoading(true);
    setError(undefined);
    setResult(undefined);

    try {
      const response = await api.quoteCompare<CompareResponse>({
        orgId,
        originZip: originZip.trim(),
        destinationZip: destinationZip.trim(),
        pickupDateIso: `${pickupDate}T00:00:00Z`,
        mode,
        trailerType: mode === "FTL" ? trailerType : undefined,
        items: [
          {
            freightClass: mode === "LTL" ? freightClass : "100",
            packagingType: mode === "FTL" ? "Full Trailer" : packagingType,
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to fetch quotes.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Search className="w-5 h-5 text-slate-700" />
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      </div>

      <form onSubmit={runComparison} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as "LTL" | "FTL")} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none">
            <option value="LTL">LTL — less-than-truckload</option>
            <option value="FTL">FTL — full truckload</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
          Origin ZIP / Postal
          <input value={originZip} onChange={(e) => setOriginZip(e.target.value)} required maxLength={10} placeholder="98230 or V4A 9V4" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
        </label>
        <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
          Destination ZIP / Postal
          <input value={destinationZip} onChange={(e) => setDestinationZip(e.target.value)} required maxLength={10} placeholder="60606 or M5V 2E7" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
        </label>
        <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
          Pickup date
          <input value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
        </label>
        <div>
          <WeightInput valueLbs={weightLbs} onChangeLbs={setWeightLbs} required minLbs={1} placeholder="275" label="Total weight" />
        </div>
        {mode === "LTL" ? (
          <>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              Freight class
              <select value={freightClass} onChange={(e) => setFreightClass(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none">
                {NMFC_CLASSES.map((cls) => (
                  <option key={cls} value={cls}>Class {cls}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              Units / Pieces
              <input value={units} onChange={(e) => setUnits(e.target.value)} type="number" min="1" placeholder="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
            </label>
            <div className="md:col-span-3">
              <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                Packaging type
                <select value={packagingType} onChange={(e) => setPackagingType(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none">
                  <option>Pallet</option>
                  <option>Skid</option>
                  <option>Crate</option>
                  <option>Drum</option>
                  <option>Box</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <label className="md:col-span-2 text-xs font-medium text-slate-600 uppercase tracking-wide">
            Trailer type
            <select value={trailerType} onChange={(e) => setTrailerType(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none">
              {TRAILER_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <div className="md:col-span-3 flex justify-end">
          <button type="submit" disabled={loading} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Compare {mode} rates
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result?.priority1Demo && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-violet-50 border border-violet-200 p-3 text-sm text-violet-900">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Demo mode</strong> — quotes below are illustrative (real carrier names, plausible rates by lane and weight, no live vendor). Turn off PRIORITY1_DEMO_MODE and add a real vendor key when you&rsquo;re ready for live quotes.
          </span>
        </div>
      )}

      {result?.priority1Simulated && !result?.priority1Demo && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>No rate vendor configured</strong> — set PRIORITY1_API_KEY for live quotes, or PRIORITY1_DEMO_MODE=true for illustrative rates.
          </span>
        </div>
      )}

      {result?.priority1Error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Priority1 error: {result.priority1Error}</span>
        </div>
      )}

      {result && !result.incumbent && result.quotes.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-200 p-3 text-sm text-sky-900">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>No rate on file for this lane — savings can't be computed. Add a rate under &ldquo;Current carrier rates on file&rdquo; to see savings on future comparisons.</span>
        </div>
      )}

      {result?.incumbent && (
        <div className="mb-4 rounded-lg border-2 border-slate-900 bg-slate-50 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-medium mb-1">Incumbent rate on file</div>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900">{result.incumbent.carrierName}</div>
              <div className="text-xs text-slate-500">{result.incumbent.serviceLevel ?? "—"} · {result.incumbent.transitDays ? `${result.incumbent.transitDays}d transit` : "—"} · effective {result.incumbent.effectiveDateIso ?? "—"} · {result.incumbent.rateSource}</div>
            </div>
            <div className="text-2xl font-mono font-semibold text-slate-900">${result.incumbent.totalRateUsd.toFixed(2)}</div>
          </div>
        </div>
      )}

      {result && result.quotes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 pr-3">Carrier</th>
                <th className="text-left py-2 pr-3">Service</th>
                <th className="text-right py-2 pr-3">Transit</th>
                <th className="text-right py-2 pr-3">Total</th>
                <th className="text-right py-2 pr-3">Savings $</th>
                <th className="text-right py-2 pr-3">Savings %</th>
                <th className="text-left py-2 pr-3">Expires</th>
              </tr>
            </thead>
            <tbody>
              {result.quotes.map((q, i) => {
                const savings = q.savingsVsIncumbentUsd;
                const savingsPct = q.savingsVsIncumbentPct;
                const savingsClass = savings === undefined ? "text-slate-400" : savings > 0 ? "text-emerald-700" : savings < 0 ? "text-rose-700" : "text-slate-500";
                return (
                  <tr key={`${q.carrierName}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 pr-3 font-medium text-slate-900">{q.carrierName}</td>
                    <td className="py-2 pr-3 text-slate-600">{q.serviceLevel ?? "—"}</td>
                    <td className="py-2 pr-3 text-right text-slate-600">{q.transitDays ? `${q.transitDays}d` : "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono font-medium text-slate-900">${q.totalUsd.toFixed(2)}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${savingsClass}`}>
                      {savings === undefined ? "—" : (
                        <span className="inline-flex items-center gap-1 justify-end">
                          {savings > 0 ? <TrendingDown className="w-3 h-3" /> : savings < 0 ? <TrendingUp className="w-3 h-3" /> : null}
                          ${Math.abs(savings).toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 text-right font-mono text-xs ${savingsClass}`}>
                      {savingsPct === undefined ? "—" : `${savingsPct.toFixed(1)}%`}
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{q.expirationDateIso ? new Date(q.expirationDateIso).toLocaleDateString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
