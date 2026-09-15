// ============================================================================
// BookingRequestsQueue
// Operator-side view of the pending client booking requests generated
// by the Spot Rate Explorer's "Request booking" button. Accept moves
// the row to 'accepted' (operator should confirm capacity, PARS/PAPS,
// DG etc. before dispatch — this queue signals intent, not autobook).
// Decline is a terminal state; operator writes an optional note. The
// component refetches after every action so the queue stays consistent
// without a page reload.
// ============================================================================

import { useEffect, useState } from "react";
import { Inbox, CheckCircle2, XCircle, Loader2, ArrowRight, Truck } from "lucide-react";
import { api, ApiError } from "../config/api";

interface BookingRequest {
  id: string;
  org_id: string;
  requested_by_email: string | null;
  carrier_name: string;
  service_level: string | null;
  mode: "LTL" | "FTL";
  origin_zip: string;
  destination_zip: string;
  pickup_date_iso: string;
  total_usd: string; // pg NUMERIC returns as string
  transit_days: number | null;
  metadata: Record<string, unknown> | null;
  status: "pending" | "accepted" | "declined" | "expired";
  operator_notes: string | null;
  created_at: string;
}

export function BookingRequestsQueue() {
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [noteFor, setNoteFor] = useState<string | undefined>();
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const result = await api.bookingRequests<{ bookingRequests: BookingRequest[] }>("pending");
      setRequests(result.bookingRequests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load booking requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function respond(id: string, status: "accepted" | "declined") {
    setActioning(id);
    try {
      await api.updateBookingRequest(id, status, status === "declined" ? note : undefined);
      setNoteFor(undefined);
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update booking request.");
    } finally {
      setActioning(undefined);
    }
  }

  if (!loading && requests.length === 0 && !error) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-slate-700" />
          <p className="text-sm font-bold text-slate-900">Pending client booking requests</p>
          {requests.length > 0 && (
            <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-cyan-700">{requests.length} pending</span>
          )}
        </div>
        <button onClick={load} className="text-xs font-medium text-slate-500 hover:text-slate-700">Refresh</button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-sm text-slate-500 gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {requests.map((r) => {
            const pickup = new Date(r.pickup_date_iso).toLocaleDateString();
            const created = new Date(r.created_at).toLocaleString();
            const total = Number(r.total_usd);
            return (
              <div key={r.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Truck size={12} className="text-slate-400" />
                      <p className="text-sm font-semibold text-slate-900">{r.carrier_name}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-slate-500">{r.mode}</span>
                      {r.service_level && <span className="text-xs text-slate-500">{r.service_level}</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-mono">{r.origin_zip}</span> <ArrowRight size={10} className="inline text-slate-400" /> <span className="font-mono">{r.destination_zip}</span>
                      {" · "}Pickup {pickup}
                      {r.transit_days !== null && ` · ${r.transit_days}d transit`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Requested by <span className="text-slate-700">{r.requested_by_email ?? "—"}</span> · org <span className="font-mono">{r.org_id}</span> · {created}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-base font-semibold text-slate-900">${total.toFixed(2)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">quoted</p>
                  </div>
                </div>

                {noteFor === r.id ? (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Why declining? (Optional — sent to the client as context)"
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={() => { setNoteFor(undefined); setNote(""); }} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
                      <button onClick={() => respond(r.id, "declined")} disabled={actioning === r.id} className="flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60">
                        {actioning === r.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                        Confirm decline
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button onClick={() => setNoteFor(r.id)} disabled={actioning === r.id} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-rose-50 hover:border-rose-300 disabled:opacity-60">
                      <XCircle size={12} />
                      Decline
                    </button>
                    <button onClick={() => respond(r.id, "accepted")} disabled={actioning === r.id} className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                      {actioning === r.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Accept — I&rsquo;ll book this
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
