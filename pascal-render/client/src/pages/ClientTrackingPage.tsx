// ============================================================================
// ClientTrackingPage
// The ocean container + air waybill visibility surface for the client. Left
// column: subscriptions list (their containers / AWBs). Right column: the
// milestone timeline for the selected one. Add-subscription form at top.
// Every shipment tells the same story regardless of mode or carrier.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Ship, Plane, Plus, Loader2, RefreshCw, MapPin, AlertTriangle, AlertCircle, CheckCircle2, Clock, Truck, Train } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

type Mode = "ocean" | "air" | "ltl" | "tl" | "rail";

interface Subscription {
  id: string;
  mode: Mode;
  provider: string;
  tracking_number: string;
  carrier_scac_or_iata: string | null;
  reference: string | null;
  origin: string | null;
  destination: string | null;
  status: string;
  demo_mode: boolean;
  milestone_count: number;
  latest_event_at: string | null;
  updated_at: string;
}

interface Milestone {
  event_type: string;
  event_code: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  occurred_at: string;
  is_exception: boolean;
  details: Record<string, unknown>;
  source: string;
}

interface Detail {
  subscription: Subscription;
  milestones: Milestone[];
}

const EVENT_LABEL: Record<string, string> = {
  booking_confirmed: "Booking confirmed",
  gate_in: "Gated in",
  loaded: "Loaded",
  sailed: "Departed",
  picked_up: "Picked up",
  at_origin_terminal: "At origin terminal",
  linehaul: "Linehaul",
  at_destination_terminal: "At destination terminal",
  out_for_delivery: "Out for delivery",
  in_transit: "In transit",
  arrived: "Arrived",
  discharged: "Discharged",
  customs_hold: "Customs hold",
  customs_released: "Customs released",
  gated_out: "Gated out",
  delivered: "Delivered",
  exception: "Exception",
  hold: "Hold",
  rolled: "Rolled",
  released: "Released",
};

const MODE_ICON: Record<Mode, typeof Ship> = {
  ocean: Ship, air: Plane, ltl: Truck, tl: Truck, rail: Train,
};

function eventIcon(evt: string, isException: boolean) {
  if (isException || evt === "exception" || evt === "customs_hold" || evt === "hold" || evt === "rolled") return <AlertTriangle size={12} className="text-rose-700" />;
  if (evt === "delivered" || evt === "gated_out" || evt === "customs_released" || evt === "released") return <CheckCircle2 size={12} className="text-emerald-700" />;
  return <Clock size={12} className="text-slate-500" />;
}

export function ClientTrackingPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [detail, setDetail] = useState<Detail | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<Mode>("ocean");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [reference, setReference] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");

  const scope = "client" as const;

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const s = await api.trackingSubscriptions<{ subscriptions: Subscription[] }>(scope);
      setSubs(s.subscriptions);
      if (s.subscriptions.length > 0 && !detail) {
        const d = await api.trackingSubscription<Detail>(scope, s.subscriptions[0].id);
        setDetail(d);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tracking.");
    } finally {
      setLoading(false);
    }
  }, [detail]);

  useEffect(() => { void load(); }, [load]);

  async function loadDetail(id: string) {
    setBusy(true);
    try {
      const d = await api.trackingSubscription<Detail>(scope, id);
      setDetail(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load timeline.");
    } finally {
      setBusy(false);
    }
  }

  async function subscribe() {
    if (!trackingNumber.trim()) {
      setError("Tracking number is required.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.trackingSubscribe(scope, {
        mode,
        trackingNumber: trackingNumber.trim(),
        reference: reference || undefined,
        origin: origin || undefined,
        destination: destination || undefined,
      });
      setTrackingNumber("");
      setReference("");
      setOrigin("");
      setDestination("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Subscribe failed.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshOne() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.trackingRefresh(scope, detail.subscription.id);
      await loadDetail(detail.subscription.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center gap-2">
          <MapPin size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">Ocean & Air Tracking</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">Live milestones</span>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {/* Add subscription */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-bold text-slate-900">Add a container or air waybill</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
              <option value="ltl">LTL (Less-than-truckload)</option>
              <option value="tl">Truckload (TL)</option>
              <option value="ocean">Ocean container</option>
              <option value="air">Air waybill</option>
              <option value="rail">Intermodal rail</option>
            </select>
            <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder={mode === "ocean" ? "Container # (e.g. MSCU7123456)" : mode === "air" ? "AWB # (e.g. 020-12345678)" : mode === "ltl" ? "PRO # (e.g. 123456789)" : mode === "tl" ? "Load # / BOL" : "Rail waybill / Container #"} className="col-span-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Your PO / ref" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Origin (optional)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Destination (optional)" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={subscribe} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Subscribe & pull first milestones
            </button>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Subscriptions list */}
          <section className="lg:col-span-1 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-bold text-slate-900">Your shipments</p>
              <p className="text-[11px] text-slate-500">{subs.length} tracked</p>
            </div>
            {loading && subs.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> Loading…</div>
            ) : subs.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">No shipments yet — add a container or AWB above to start tracking.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {subs.map((s) => {
                  const Icon = MODE_ICON[s.mode as Mode] ?? Truck;
                  return (
                  <button key={s.id} onClick={() => loadDetail(s.id)} className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${detail?.subscription.id === s.id ? "bg-cyan-50" : ""}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={12} className="text-slate-500" />
                      <span className="text-xs font-semibold text-slate-900">{s.tracking_number}</span>
                      {s.demo_mode && <span className="rounded-md border border-violet-200 bg-violet-50 px-1 text-[9px] font-mono uppercase text-violet-800">demo</span>}
                    </div>
                    <p className="text-[11px] text-slate-500">{s.reference ? `Ref: ${s.reference} · ` : ""}{s.milestone_count} events</p>
                    {s.origin && s.destination && (
                      <p className="text-[11px] text-slate-500">{s.origin} → {s.destination}</p>
                    )}
                  </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Timeline */}
          <section className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                {detail && (() => {
                  const Icon = MODE_ICON[detail.subscription.mode as Mode] ?? Truck;
                  return <Icon size={14} />;
                })()}
                <p className="text-sm font-bold text-slate-900">{detail ? detail.subscription.tracking_number : "Timeline"}</p>
                {detail && <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">{detail.subscription.provider}</span>}
              </div>
              {detail && (
                <button onClick={refreshOne} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Refresh
                </button>
              )}
            </div>
            {!detail ? (
              <p className="p-8 text-center text-xs text-slate-500">Select a shipment to see its milestone timeline.</p>
            ) : detail.milestones.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-500">No milestones yet — try Refresh.</p>
            ) : (
              <ol className="space-y-2 p-4">
                {detail.milestones.map((m, i) => (
                  <li key={i} className={`flex items-start gap-3 rounded-md border p-3 ${m.is_exception ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
                    <div className="mt-0.5 flex-shrink-0">{eventIcon(m.event_type, m.is_exception)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-slate-900">{EVENT_LABEL[m.event_type] ?? m.event_type}</span>
                        {m.event_code && <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">{m.event_code}</span>}
                        {m.is_exception && <span className="rounded-md border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-rose-800">exception</span>}
                      </div>
                      <p className="text-[11px] text-slate-600">{m.location ?? "—"} · <span className="text-slate-500">{new Date(m.occurred_at).toLocaleString()}</span></p>
                      {typeof m.details?.reason === "string" && (
                        <p className="mt-1 text-[11px] text-slate-700 italic">{String(m.details.reason)}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
