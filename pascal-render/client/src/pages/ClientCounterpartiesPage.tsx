// ============================================================================
// ClientCounterpartiesPage
// Warehouse-day-1 quick reference. All your trucking companies + customs
// brokers of record on one screen: contact info, POA status, integration
// status. Answer to "who do I call about my shipment right now."
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Truck, ShieldCheck, Phone, Mail, Loader2, AlertCircle, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

interface Carrier {
  id: string;
  carrier_name: string;
  carrier_mode: string;
  scac_code: string | null;
  iata_code: string | null;
  fmc_number: string | null;
  account_number: string;
  dispatch_email: string | null;
  integration_status: string;
  on_time_pct: string | null;
  claims_rate_pct: string | null;
  last_verified_at: string | null;
}

interface Broker {
  id: string;
  broker_name: string;
  side: "us" | "ca" | "both";
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  ace_filer_code: string | null;
  cbsa_client_id: string | null;
  poa_status: "not_on_file" | "requested" | "signed" | "expired" | "on_file";
  poa_signed_at: string | null;
  poa_expires_at: string | null;
  notes: string | null;
}

interface Response {
  carriers: Carrier[];
  brokers: Broker[];
}

const POA_LABEL: Record<Broker["poa_status"], string> = {
  not_on_file: "POA not on file",
  requested: "POA requested",
  signed: "POA signed",
  expired: "POA expired",
  on_file: "POA on file",
};
const POA_CLASS: Record<Broker["poa_status"], string> = {
  not_on_file: "bg-rose-100 text-rose-800",
  requested: "bg-amber-100 text-amber-800",
  signed: "bg-emerald-100 text-emerald-800",
  on_file: "bg-emerald-100 text-emerald-800",
  expired: "bg-rose-100 text-rose-800",
};

export function ClientCounterpartiesPage() {
  const [data, setData] = useState<Response | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.counterparties<Response>("client");
      setData(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load counterparties.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">Carriers & Brokers</h1>
        </div>
        <p className="text-sm text-slate-600">Every carrier + customs broker on your account. Contact info + POA status at a glance.</p>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : data && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Truck size={14} className="text-slate-700" />
                  <p className="text-sm font-bold text-slate-900">Trucking companies</p>
                </div>
                <span className="text-[11px] text-slate-500">{data.carriers.length} on file</span>
              </div>
              {data.carriers.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No carriers on file yet — we'll add them as we tender your first loads.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.carriers.map((c) => (
                    <li key={c.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-slate-900">{c.carrier_name}</p>
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-600">{c.carrier_mode}</span>
                        {c.scac_code && <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-500">SCAC {c.scac_code}</span>}
                        {c.iata_code && <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-500">IATA {c.iata_code}</span>}
                        {c.integration_status === "live_api" && <span className="rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-mono uppercase text-emerald-800">Live API</span>}
                      </div>
                      <p className="text-[11px] text-slate-500">Account: {c.account_number}</p>
                      {c.dispatch_email && (
                        <a href={`mailto:${c.dispatch_email}`} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline">
                          <Mail size={10} /> {c.dispatch_email}
                        </a>
                      )}
                      {(c.on_time_pct || c.claims_rate_pct) && (
                        <div className="mt-1 flex gap-3 text-[10px] text-slate-600">
                          {c.on_time_pct && <span>On-time: <strong>{Number(c.on_time_pct).toFixed(1)}%</strong></span>}
                          {c.claims_rate_pct && <span>Claims rate: <strong>{Number(c.claims_rate_pct).toFixed(2)}%</strong></span>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-slate-700" />
                  <p className="text-sm font-bold text-slate-900">Customs brokers of record</p>
                </div>
                <span className="text-[11px] text-slate-500">{data.brokers.length} on file</span>
              </div>
              {data.brokers.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No customs brokers on file — we'll add them as part of your onboarding.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.brokers.map((b) => {
                    const daysToExpiry = b.poa_expires_at
                      ? Math.round((new Date(b.poa_expires_at).getTime() - Date.now()) / 86_400_000)
                      : null;
                    const expiryConcern = daysToExpiry !== null && daysToExpiry < 30;
                    return (
                      <li key={b.id} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-slate-900">{b.broker_name}</p>
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-600">{b.side === "us" ? "US side (CBP)" : b.side === "ca" ? "CA side (CBSA)" : "Both sides"}</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono uppercase font-semibold ${POA_CLASS[b.poa_status]}`}>{POA_LABEL[b.poa_status]}</span>
                          {expiryConcern && <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase text-rose-800 flex items-center gap-1"><AlertTriangle size={10} /> {daysToExpiry}d to expiry</span>}
                        </div>
                        {(b.ace_filer_code || b.cbsa_client_id) && (
                          <p className="text-[10px] font-mono text-slate-500">
                            {b.ace_filer_code && `ACE ${b.ace_filer_code}  `}
                            {b.cbsa_client_id && `CBSA ${b.cbsa_client_id}`}
                          </p>
                        )}
                        <div className="mt-1 space-y-0.5 text-[11px]">
                          {b.contact_name && <p className="text-slate-700">Contact: {b.contact_name}</p>}
                          {b.contact_phone && <a href={`tel:${b.contact_phone}`} className="inline-flex items-center gap-1 text-cyan-700 hover:underline"><Phone size={10} /> {b.contact_phone}</a>}
                          {b.contact_phone && b.contact_email && <span className="text-slate-400"> · </span>}
                          {b.contact_email && <a href={`mailto:${b.contact_email}`} className="inline-flex items-center gap-1 text-cyan-700 hover:underline"><Mail size={10} /> {b.contact_email}</a>}
                        </div>
                        {b.poa_signed_at && (
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                            {b.poa_status === "on_file" || b.poa_status === "signed" ? <CheckCircle2 size={10} className="text-emerald-600" /> : <Clock size={10} />}
                            POA signed {new Date(b.poa_signed_at).toLocaleDateString()}
                            {b.poa_expires_at && ` · expires ${new Date(b.poa_expires_at).toLocaleDateString()}`}
                          </p>
                        )}
                        {b.notes && <p className="mt-1 text-[11px] italic text-slate-600">{b.notes}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
              Missing a carrier or broker? Reach out on <a href="mailto:operations@pascallogistics.com" className="text-cyan-700 hover:underline">operations@pascallogistics.com</a> and we'll add them.
            </div>
          </>
        )}
      </main>
    </div>
  );
}
