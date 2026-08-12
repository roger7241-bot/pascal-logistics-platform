import { useEffect, useState } from "react";
import {
  Truck,
  Plus,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Ship,
  Plane,
  Building2,
  Zap,
  Loader2,
  TrendingDown,
  ShieldCheck,
  X,
  Info,
} from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface Carrier {
  id: string;
  carrierName: string;
  carrierMode: string;
  accountNumber: string;
  accountFormatValid: boolean | null;
  scacCode?: string;
  iataCode?: string;
  fmcNumber?: string;
  integrationStatus: string;
  emergencyPhone?: string;
  dispatchEmail?: string;
  accountExecName?: string;
  coiExpiresAtIso?: string;
  dotMcRating?: string;
  twicCtpatCert?: boolean;
  onTimePct?: number;
  claimsRatePct?: number;
}

interface SavingsRow {
  clientOrg: string;
  mtdSavingsUsd: number;
}

interface Velocity {
  poeId: string;
  waitMinutes?: number;
}

const MODE_TABS = [
  { key: "road", label: "Cross-Border Road & LTL", icon: Truck },
  { key: "ocean", label: "Ocean Freight & Drayage", icon: Ship },
  { key: "air", label: "Air Freight Carriers", icon: Plane },
  { key: "broker", label: "Customs Brokers & Partners", icon: Building2 },
] as const;

const INTEGRATION_LABEL: Record<string, string> = { live_api: "Live API Connected", edi_ftp: "EDI/FTP Active", legacy_scraper: "Legacy WebScraper Active" };
const INTEGRATION_CLASS: Record<string, string> = { live_api: "bg-emerald-100 text-emerald-700", edi_ftp: "bg-sky-100 text-sky-700", legacy_scraper: "bg-amber-100 text-amber-700" };
const POE_LABELS: Record<string, string> = { pacific_highway: "Blaine (Pacific Highway)", sumas: "Sumas / Abbotsford", aldergrove: "Aldergrove / Lynden" };

export function CarrierDeskPage() {
  const [mode, setMode] = useState<(typeof MODE_TABS)[number]["key"]>("road");
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [savings, setSavings] = useState<SavingsRow[]>([]);
  const [velocities, setVelocities] = useState<Velocity[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [quoteWeight, setQuoteWeight] = useState("8000");
  const [quoteValue, setQuoteValue] = useState("20000");
  const [quoteMode, setQuoteMode] = useState("FTL");
  const [quoting, setQuoting] = useState(false);
  const [quoteResult, setQuoteResult] = useState<{ contractedRateUsd: number; benchmarkSpotRateUsd: number; savingsPct: number; savingsFlagged: boolean } | undefined>(undefined);

  const [newOrgId, setNewOrgId] = useState("org_meridian");
  const [newCarrierName, setNewCarrierName] = useState("ODFL");
  const [newAccountNumber, setNewAccountNumber] = useState("");
  const [newIntegration, setNewIntegration] = useState("legacy_scraper");
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.carriers<{ carriers: Carrier[] }>(mode), api.savingsByAccount<{ savingsByAccount: SavingsRow[] }>(), api.carrierBorderVelocity<{ velocities: Velocity[] }>()])
      .then(([c, s, v]) => {
        setCarriers(c.carriers);
        setSavings(s.savingsByAccount);
        setVelocities(v.velocities);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [mode]);

  const handleAddCarrier = async () => {
    if (!newAccountNumber.trim()) return;
    setAdding(true);
    try {
      await api.createCarrier({ orgId: newOrgId, carrierName: newCarrierName, carrierMode: mode, accountNumber: newAccountNumber, integrationStatus: newIntegration });
      setNewAccountNumber("");
      setDrawerOpen(false);
      load();
    } finally {
      setAdding(false);
    }
  };

  const handleQuote = async () => {
    setQuoting(true);
    try {
      const result = await api.requestRateQuote<{ quote: typeof quoteResult }>({ totalWeightLbs: Number(quoteWeight), commercialInvoiceValue: Number(quoteValue), mode: quoteMode });
      setQuoteResult(result.quote);
    } finally {
      setQuoting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck size={18} className="text-slate-500" />
            <h1 className="text-xl font-bold">Carrier Management &amp; Rate Optimization Hub</h1>
          </div>
          <button onClick={() => setDrawerOpen(true)} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">
            <Plus size={14} /> Add New Carrier Partner
          </button>
        </div>

        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {MODE_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setMode(t.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold ${mode === t.key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                <Icon size={13} /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-sm font-bold">Carrier accounts {loading && <span className="text-slate-400">(loading...)</span>}</p>
            </div>
            <div className="divide-y divide-slate-100">
              {carriers.map((c) => (
                <div key={c.id} className="px-5 py-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-900">{c.carrierName}</p>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${INTEGRATION_CLASS[c.integrationStatus]}`}>{INTEGRATION_LABEL[c.integrationStatus]}</span>
                  </div>
                  <p className="font-mono text-xs text-slate-500">
                    Acct {c.accountNumber} {c.scacCode && `· SCAC ${c.scacCode}`} {c.iataCode && `· IATA ${c.iataCode}`} {c.fmcNumber && `· FMC ${c.fmcNumber}`}
                  </p>
                  {(c.emergencyPhone || c.dispatchEmail || c.accountExecName) && (
                    <p className="mt-1 text-xs text-slate-500">
                      {c.accountExecName && `${c.accountExecName} · `}
                      {c.emergencyPhone} {c.dispatchEmail && `· ${c.dispatchEmail}`}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                    {c.accountFormatValid === true && (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 size={11} /> Format verified
                      </span>
                    )}
                    {c.accountFormatValid === false && (
                      <span className="flex items-center gap-1 text-rose-600">
                        <XCircle size={11} /> Format invalid
                      </span>
                    )}
                    {c.accountFormatValid === null && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <HelpCircle size={11} /> Needs verification
                      </span>
                    )}
                    {c.onTimePct !== undefined && <span>On-time: {c.onTimePct}%</span>}
                    {c.claimsRatePct !== undefined && <span>Claims/OS&amp;D: {c.claimsRatePct}%</span>}
                    {c.twicCtpatCert && (
                      <span className="flex items-center gap-1 text-cyan-600">
                        <ShieldCheck size={11} /> TWIC/C-TPAT
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {!loading && carriers.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No carrier accounts on file for this mode yet.</p>}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-slate-500">
              <Zap size={12} /> Spot Rate Quote Launcher
            </p>
            <input value={quoteWeight} onChange={(e) => setQuoteWeight(e.target.value)} placeholder="Weight (lbs)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <input value={quoteValue} onChange={(e) => setQuoteValue(e.target.value)} placeholder="Invoice value (USD)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            <select value={quoteMode} onChange={(e) => setQuoteMode(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option>LTL</option>
              <option>FTL</option>
              <option>FCL Ocean</option>
              <option>Air Priority</option>
            </select>
            <button onClick={handleQuote} disabled={quoting} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {quoting ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Get instant spot quote
            </button>
            {quoteResult && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5">
                <p className="text-xs text-emerald-700">
                  Contracted: <strong>${quoteResult.contractedRateUsd.toLocaleString()}</strong> vs Spot: <strong>${quoteResult.benchmarkSpotRateUsd.toLocaleString()}</strong>
                </p>
                {quoteResult.savingsFlagged && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <TrendingDown size={11} /> {quoteResult.savingsPct}% savings opportunity
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-sm font-bold">MTD Capital Saved per Client Account</p>
            </div>
            <div className="divide-y divide-slate-100">
              {savings.map((s) => (
                <div key={s.clientOrg} className="flex items-center justify-between px-5 py-3">
                  <p className="text-sm text-slate-700">{s.clientOrg}</p>
                  <p className="text-sm font-bold text-emerald-600">${s.mtdSavingsUsd.toLocaleString()}</p>
                </div>
              ))}
              {savings.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No savings captured this month yet.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-sm font-bold">Average Border Clearance Velocity</p>
            </div>
            <div className="divide-y divide-slate-100">
              {velocities.map((v) => (
                <div key={v.poeId} className="flex items-center justify-between px-5 py-3">
                  <p className="text-sm text-slate-700">{POE_LABELS[v.poeId]}</p>
                  <p className="font-mono text-sm font-semibold text-slate-900">{v.waitMinutes !== undefined ? `${v.waitMinutes}m` : "—"}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDrawerOpen(false)}>
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">Add New Carrier Partner</p>
              <button onClick={() => setDrawerOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <div className="mb-4 flex gap-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3">
              <Info size={14} className="mt-0.5 shrink-0 text-cyan-600" />
              <p className="text-xs text-cyan-800">
                API keys and OAuth tokens aren't entered here — they're configured as environment variables on the server, the same secure way every other credential in this platform is handled. This form
                only records account metadata.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Client org</label>
                <input value={newOrgId} onChange={(e) => setNewOrgId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Carrier name</label>
                <input value={newCarrierName} onChange={(e) => setNewCarrierName(e.target.value)} placeholder="e.g. CMA CGM, Air Canada Cargo" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Account number / SCAC / IATA</label>
                <input value={newAccountNumber} onChange={(e) => setNewAccountNumber(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-mono uppercase tracking-wide text-slate-500">Integration status</label>
                <select value={newIntegration} onChange={(e) => setNewIntegration(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="legacy_scraper">Legacy WebScraper Active</option>
                  <option value="edi_ftp">EDI/FTP Active</option>
                  <option value="live_api">Live API Connected</option>
                </select>
              </div>
              <button onClick={handleAddCarrier} disabled={adding} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add carrier partner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
