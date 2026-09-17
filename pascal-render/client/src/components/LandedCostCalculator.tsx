// ============================================================================
// LandedCostCalculator
// Shared calculator UI used by both the public marketing route and the
// client portal. When onSaveLead is provided, an "Email me this quote"
// affordance appears — that path captures a lead into the prospect
// pipeline. Otherwise the calculator is pure compute + display.
// ============================================================================

import { useState } from "react";
import { Calculator, Loader2, AlertCircle, Send, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../config/api";

type Mode = "LTL" | "TL" | "OCEAN_FCL" | "OCEAN_LCL" | "AIR";

interface CostLine { label: string; amountUsd: number; notes?: string }
interface Breakdown {
  freight: CostLine[]; duties: CostLine[]; brokerage: CostLine[];
  insurance: CostLine[]; lastMile: CostLine[]; otherAccessorials: CostLine[];
  totals: {
    freightUsd: number; dutiesUsd: number; brokerageUsd: number;
    insuranceUsd: number; lastMileUsd: number; accessorialsUsd: number;
    grandTotalUsd: number; perKgUsd: number; perPieceUsd: number | null;
  };
  assumptions: string[];
  estimatedAtIso: string;
}

interface Props {
  variant: "public" | "authed";
  scope?: "operator" | "client";
  onLeadSaved?: (prospectId: string) => void;
}

const MODE_LABELS: Record<Mode, string> = {
  LTL: "LTL (Less-than-truckload)",
  TL: "Truckload",
  OCEAN_FCL: "Ocean container (FCL)",
  OCEAN_LCL: "Ocean groupage (LCL)",
  AIR: "Air",
};

const HS_CHAPTERS: { code: string; label: string }[] = [
  { code: "84", label: "84 · Machinery" },
  { code: "85", label: "85 · Electrical machinery" },
  { code: "87", label: "87 · Vehicles" },
  { code: "72", label: "72 · Iron & steel (raw)" },
  { code: "73", label: "73 · Iron & steel articles" },
  { code: "94", label: "94 · Furniture" },
  { code: "39", label: "39 · Plastics" },
  { code: "40", label: "40 · Rubber" },
  { code: "44", label: "44 · Wood" },
  { code: "48", label: "48 · Paper" },
  { code: "61", label: "61 · Apparel (knit)" },
  { code: "62", label: "62 · Apparel (woven)" },
  { code: "63", label: "63 · Textile articles" },
  { code: "22", label: "22 · Beverages" },
  { code: "OTHER", label: "Other / not sure" },
];

export function LandedCostCalculator({ variant, scope = "client", onLeadSaved }: Props) {
  const [mode, setMode] = useState<Mode>("OCEAN_FCL");
  const [origin, setOrigin] = useState("Shanghai");
  const [originCountry, setOriginCountry] = useState("CN");
  const [destination, setDestination] = useState("Vancouver");
  const [destinationCountry, setDestinationCountry] = useState("CA");
  const [destinationZip] = useState("");
  const [weightKg, setWeightKg] = useState("12000");
  const [volumeCbm, setVolumeCbm] = useState("28");
  const [pieces, setPieces] = useState("24");
  const [hsChapter, setHsChapter] = useState("84");
  const [hsCode, setHsCode] = useState("");
  const [declaredValueUsd, setDeclaredValueUsd] = useState("45000");
  const [incoterm, setIncoterm] = useState<"EXW" | "FOB" | "CIF" | "DAP" | "DDP">("FOB");
  const [useUsmcaOrigin, setUseUsmcaOrigin] = useState(false);
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [isDangerousGoods, setIsDangerousGoods] = useState(false);
  const [lastMileZip, setLastMileZip] = useState("");

  const [result, setResult] = useState<Breakdown | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Lead capture
  const [leadEmail, setLeadEmail] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadCompany, setLeadCompany] = useState("");
  const [savingLead, setSavingLead] = useState(false);
  const [leadSaved, setLeadSaved] = useState(false);

  function buildInput(): Record<string, unknown> {
    return {
      mode, origin, originCountry, destination, destinationCountry,
      destinationZip: destinationZip || undefined,
      weightKg: Number(weightKg) || 0,
      volumeCbm: volumeCbm ? Number(volumeCbm) : undefined,
      pieces: pieces ? Number(pieces) : undefined,
      hsCode: hsCode || undefined,
      hsChapter: hsChapter && hsChapter !== "OTHER" ? hsChapter : undefined,
      declaredValueUsd: Number(declaredValueUsd) || 0,
      incoterm,
      useUsmcaOrigin,
      includeInsurance,
      isDangerousGoods,
      lastMileZip: lastMileZip || undefined,
    };
  }

  async function compute() {
    setLoading(true);
    setError(undefined);
    setLeadSaved(false);
    try {
      const input = buildInput();
      const r = variant === "public"
        ? await api.publicLandedCostEstimate<Breakdown>(input)
        : await api.landedCostEstimate<Breakdown>(scope, input);
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Estimate failed.");
    } finally {
      setLoading(false);
    }
  }

  async function saveLead() {
    if (!leadEmail.trim() || !leadEmail.includes("@")) {
      setError("Please enter a valid email.");
      return;
    }
    setSavingLead(true);
    setError(undefined);
    try {
      const r = await api.publicLandedCostSaveLead<{ prospectId: string }>({
        email: leadEmail.trim(),
        contactName: leadName || undefined,
        companyName: leadCompany || undefined,
        input: buildInput(),
      });
      setLeadSaved(true);
      onLeadSaved?.(r.prospectId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSavingLead(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Form */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="col-span-2">
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
              {Object.entries(MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Origin</span>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Origin country (ISO-2)</span>
            <input value={originCountry} onChange={(e) => setOriginCountry(e.target.value.toUpperCase().slice(0, 2))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs uppercase" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Destination</span>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Destination country</span>
            <input value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value.toUpperCase().slice(0, 2))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs uppercase" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Weight (kg)</span>
            <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Volume (cbm)</span>
            <input value={volumeCbm} onChange={(e) => setVolumeCbm(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Pieces</span>
            <input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Declared value (USD)</span>
            <input value={declaredValueUsd} onChange={(e) => setDeclaredValueUsd(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <label className="col-span-2">
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">HS chapter</span>
            <select value={hsChapter} onChange={(e) => setHsChapter(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
              {HS_CHAPTERS.map((c) => (<option key={c.code} value={c.code}>{c.label}</option>))}
            </select>
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">HS code (optional)</span>
            <input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="e.g. 8471.30" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Incoterm</span>
            <select value={incoterm} onChange={(e) => setIncoterm(e.target.value as typeof incoterm)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
              <option value="EXW">EXW</option>
              <option value="FOB">FOB</option>
              <option value="CIF">CIF</option>
              <option value="DAP">DAP</option>
              <option value="DDP">DDP</option>
            </select>
          </label>
          <label>
            <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Last-mile zip / postal</span>
            <input value={lastMileZip} onChange={(e) => setLastMileZip(e.target.value)} placeholder="Delivery zip" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </label>
          <div className="col-span-2 md:col-span-4 flex flex-wrap gap-3 pt-2">
            <label className="flex items-center gap-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={useUsmcaOrigin} onChange={(e) => setUseUsmcaOrigin(e.target.checked)} />
              Goods qualify under USMCA (drops duty to 0% for most chapters)
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={includeInsurance} onChange={(e) => setIncludeInsurance(e.target.checked)} />
              Include marine cargo insurance
            </label>
            <label className="flex items-center gap-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={isDangerousGoods} onChange={(e) => setIsDangerousGoods(e.target.checked)} />
              Dangerous goods
            </label>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={compute} disabled={loading} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />}
            Calculate landed cost
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {result && (
        <>
          {/* Grand total */}
          <section className="rounded-xl border-2 border-cyan-300 bg-cyan-50/40 p-4 shadow-sm">
            <p className="text-[10px] font-mono uppercase tracking-wide text-cyan-800">Estimated all-in landed cost</p>
            <p className="text-3xl font-bold text-slate-900">${result.totals.grandTotalUsd.toLocaleString()} USD</p>
            <p className="text-[11px] text-slate-600">
              ${result.totals.perKgUsd}/kg
              {result.totals.perPieceUsd !== null ? ` · $${result.totals.perPieceUsd}/piece` : ""}
            </p>
          </section>

          {/* Line-by-line */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3">
              <p className="text-sm font-bold text-slate-900">Line-by-line breakdown</p>
            </div>
            <div className="divide-y divide-slate-100">
              {[
                { title: "Freight", lines: result.freight, total: result.totals.freightUsd },
                { title: "Duty & taxes", lines: result.duties, total: result.totals.dutiesUsd },
                { title: "Brokerage", lines: result.brokerage, total: result.totals.brokerageUsd },
                { title: "Insurance", lines: result.insurance, total: result.totals.insuranceUsd },
                { title: "Last mile", lines: result.lastMile, total: result.totals.lastMileUsd },
              ].filter((s) => s.lines.length > 0).map((s) => (
                <div key={s.title} className="px-5 py-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-900">{s.title}</p>
                    <p className="text-xs font-semibold text-slate-900">${s.total.toLocaleString()}</p>
                  </div>
                  <ul className="space-y-1 pl-3">
                    {s.lines.map((l, i) => (
                      <li key={i} className="flex items-start justify-between gap-3 text-[11px] text-slate-700">
                        <div>
                          <p>{l.label}</p>
                          {l.notes && <p className="italic text-slate-500">{l.notes}</p>}
                        </div>
                        <p className="whitespace-nowrap font-mono">${l.amountUsd.toLocaleString()}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Assumptions */}
          {result.assumptions.length > 0 && (
            <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-[10px] font-mono uppercase tracking-wide text-amber-800">Assumptions</p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-900">
                {result.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </section>
          )}

          {/* Lead capture — public variant only */}
          {variant === "public" && !leadSaved && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-1 text-sm font-bold text-slate-900">Want Roger to walk through this with you?</p>
              <p className="mb-3 text-[11px] text-slate-600">We'll save your quote and follow up within the business day with the real rate — no obligation.</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Your name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} placeholder="Company" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} placeholder="Email *" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              </div>
              <div className="mt-3 flex justify-end">
                <button onClick={saveLead} disabled={savingLead} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
                  {savingLead ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Email me this quote
                </button>
              </div>
            </section>
          )}
          {variant === "public" && leadSaved && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={14} /> Got it — Roger has your quote and will follow up soon.
            </div>
          )}
        </>
      )}
    </div>
  );
}
