import { ArrowRightLeft, Mail, CheckCircle2, XCircle, Truck } from "lucide-react";
import { api } from "../config/api";
import type { RerouteAdvisory } from "../types/reroute";

const POE_LABELS: Record<string, string> = {
  peace_arch: "Peace Arch",
  pacific_highway: "Pacific Highway",
  aldergrove: "Aldergrove",
  sumas: "Sumas",
  point_roberts: "Point Roberts",
};

const STATUS_META: Record<RerouteAdvisory["status"], { label: string; className: string }> = {
  pending_client_signoff: { label: "Awaiting client sign-off", className: "border-amber-200 bg-amber-50 text-amber-700" },
  client_approved: { label: "Client approved", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  client_declined: { label: "Client declined", className: "border-rose-200 bg-rose-50 text-rose-700" },
  pending_broker_confirmation: { label: "Dispatch held — awaiting broker confirmation", className: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  broker_confirmed: { label: "Broker confirmed", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  dispatch_released: { label: "Dispatch released", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

export interface RerouteAdvisoryPanelProps {
  advisories: RerouteAdvisory[];
  onUpdated: (advisory: RerouteAdvisory) => void;
}

/** Operator view: read-only status tracking + broker-confirm action once a
 * broker has actually confirmed back (out-of-band, e.g. phone/email — no
 * broker portal integration exists, so this is a manual operator
 * acknowledgment, not an automated confirmation). Sign-off itself only
 * happens on the Client Portal side — the operator cannot approve on the
 * client's behalf, by design. */
export function RerouteAdvisoryPanel({ advisories, onUpdated }: RerouteAdvisoryPanelProps) {
  async function handleBrokerConfirm(advisory: RerouteAdvisory) {
    const updated = await api.rerouteBrokerConfirm<RerouteAdvisory>(advisory.id);
    onUpdated(updated);
  }

  if (advisories.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {advisories.map((a) => {
        const meta = STATUS_META[a.status];
        return (
          <div key={a.id} className={`flex items-start gap-2 rounded-lg border p-3 ${meta.className}`}>
            <ArrowRightLeft size={15} className="mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold">
                Advisory: {POE_LABELS[a.fromPoeId]} → {POE_LABELS[a.toPoeId]} — {a.shipmentId}
              </p>
              <p className="text-xs">
                {a.fromWaitMinutes}m vs {a.toWaitMinutes}m ({a.deltaMinutes}m delta) — net ${a.netValueUsd} value, {a.netTimeSavedMinutes}m saved
              </p>
              <p className="mt-1 text-xs font-medium">{meta.label}</p>
              {a.clientSignoffName && <p className="text-xs">Signed off by {a.clientSignoffName}</p>}
              {a.amendedPortCode && (
                <p className="flex items-center gap-1 text-xs">
                  <Mail size={10} /> Broker notified — port {a.originalPortCode} → {a.amendedPortCode}
                </p>
              )}
            </div>
            {a.status === "pending_client_signoff" && <span className="text-xs italic">Waiting on Client Portal sign-off — no operator override</span>}
            {a.status === "pending_broker_confirmation" && (
              <button onClick={() => handleBrokerConfirm(a)} className="flex items-center gap-1 rounded-md border border-cyan-300 bg-white px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50">
                <Truck size={11} /> Broker confirmed — release dispatch
              </button>
            )}
            {a.status === "dispatch_released" && <CheckCircle2 size={15} className="mt-0.5 text-emerald-600" />}
            {a.status === "client_declined" && <XCircle size={15} className="mt-0.5 text-rose-500" />}
          </div>
        );
      })}
    </div>
  );
}
