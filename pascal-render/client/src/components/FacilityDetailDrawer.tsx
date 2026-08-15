import { useEffect, useState } from "react";
import { X, MapPin, Truck, Clock, ShieldAlert, MessageSquareText, Pencil, Trash2, ExternalLink, Timer } from "lucide-react";
import { api } from "../config/api";
import type { BoundShipmentSummary, FacilityProfile } from "../types/facility";

const CAPABILITY_LABEL: Record<string, string> = {
  cold_storage: "Cold Storage / Reefer",
  cross_dock: "Cross-Dock",
  hazmat_approved: "Hazmat Approved",
  overhead_crane: "Overhead Crane",
};

export interface FacilityDetailDrawerProps {
  facility: FacilityProfile;
  onClose: () => void;
  onEdit: (facility: FacilityProfile) => void;
  onArchived: (facilityId: string) => void;
}

/** Real detention math against the facility's own free-time/rate policy —
 * not a placeholder. Runs client-side off each bound shipment's ETA since
 * there's no live dock-arrival timestamp feed in this build yet. */
function estimateDetentionExposure(etaIso: string | undefined, freeTimeMinutes: number, rateUsdPerHour: number): { atDockMinutes: number; billableUsd: number } | undefined {
  if (!etaIso) return undefined;
  const minutesSinceEta = Math.max(0, Math.round((Date.now() - new Date(etaIso).getTime()) / 60_000));
  const billableMinutes = Math.max(0, minutesSinceEta - freeTimeMinutes);
  return { atDockMinutes: minutesSinceEta, billableUsd: Math.round((billableMinutes / 60) * rateUsdPerHour * 100) / 100 };
}

export function FacilityDetailDrawer({ facility, onClose, onEdit, onArchived }: FacilityDetailDrawerProps) {
  const [boundShipments, setBoundShipments] = useState<BoundShipmentSummary[]>([]);
  const [loadingShipments, setLoadingShipments] = useState(true);
  const [smsStatus, setSmsStatus] = useState<Record<string, "sending" | "sent" | "error">>({});
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    setLoadingShipments(true);
    api
      .facilityBoundShipments<{ boundShipments: BoundShipmentSummary[] }>(facility.id)
      .then((d) => setBoundShipments(d.boundShipments))
      .finally(() => setLoadingShipments(false));
  }, [facility.id]);

  async function handleSendStaging(shipment: BoundShipmentSummary) {
    if (!shipment.driverPhone) return;
    setSmsStatus((prev) => ({ ...prev, [shipment.id]: "sending" }));
    try {
      await api.sendStagingSms(facility.id, { driverPhone: shipment.driverPhone, driverName: shipment.driverName, shipmentId: shipment.id });
      setSmsStatus((prev) => ({ ...prev, [shipment.id]: "sent" }));
    } catch {
      setSmsStatus((prev) => ({ ...prev, [shipment.id]: "error" }));
    }
  }

  async function handleArchive() {
    if (!confirm(`Archive "${facility.name}"? It will be hidden from the active directory but not permanently deleted.`)) return;
    setArchiving(true);
    try {
      await api.archiveOperatorFacility(facility.id, true);
      onArchived(facility.id);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-slate-500" />
            <p className="text-sm font-bold text-slate-900">{facility.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          {facility.street}, {facility.city}, {facility.stateOrProvince} {facility.postalCode}
        </p>

        <div className="mb-5 flex flex-wrap gap-1.5">
          {facility.capabilities.map((c) => (
            <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {CAPABILITY_LABEL[c] ?? c}
            </span>
          ))}
          {facility.twicCardRequired && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">TWIC required</span>}
          {facility.addedBy === "operator" && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">Added by operator</span>}
        </div>

        {/* Gate instructions */}
        <section className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Truck size={13} /> Driver Gate Instructions
          </p>
          <p className="mb-2 text-sm text-slate-700">{facility.driverStagingNotes || "No staging notes on file yet."}</p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Clock size={11} /> {facility.receivingHoursStart}–{facility.receivingHoursEnd}
              {facility.breakWindow ? ` (break ${facility.breakWindow})` : ""}
            </span>
            {facility.dockDoorCount !== undefined && <span>{facility.dockDoorCount} dock doors</span>}
          </div>
          {facility.stagingMapUrl && (
            <a href={facility.stagingMapUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 text-xs font-medium text-cyan-700 hover:underline">
              Staging map <ExternalLink size={11} />
            </a>
          )}
        </section>

        {/* Detention policy */}
        <section className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Timer size={13} /> Free-Time & Detention Policy
          </p>
          <p className="text-sm text-slate-700">
            <strong>{facility.freeTimeMinutes} min</strong> free, then <strong>${facility.detentionRateUsdPerHour.toFixed(2)}/hr</strong>
          </p>
        </section>

        {/* Bound shipments */}
        <section className="mb-5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Truck size={13} /> Active Bound Shipments
          </p>
          {loadingShipments && <p className="text-xs text-slate-400">Loading…</p>}
          {!loadingShipments && boundShipments.length === 0 && <p className="text-xs text-slate-400">No shipments currently en route to this facility.</p>}
          <div className="space-y-2">
            {boundShipments.map((s) => {
              const exposure = estimateDetentionExposure(s.etaIso, facility.freeTimeMinutes, facility.detentionRateUsdPerHour);
              const status = smsStatus[s.id];
              return (
                <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="font-mono text-xs font-bold text-slate-900">{s.id}</p>
                    <span className="text-xs text-slate-400">{s.carrierName}</span>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">
                    {s.driverName} · {s.lane}
                  </p>
                  {exposure && exposure.billableUsd > 0 && (
                    <p className="mb-2 flex items-center gap-1 text-xs font-medium text-amber-700">
                      <ShieldAlert size={11} /> ~{exposure.atDockMinutes} min since ETA — est. ${exposure.billableUsd.toFixed(2)} detention exposure
                    </p>
                  )}
                  <button
                    onClick={() => handleSendStaging(s)}
                    disabled={!s.driverPhone || status === "sending"}
                    className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <MessageSquareText size={11} />
                    {status === "sending" ? "Sending…" : status === "sent" ? "Sent" : status === "error" ? "Failed — retry" : "Send Staging Instructions via SMS"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Quick actions */}
        <div className="flex gap-2 border-t border-slate-200 pt-4">
          <button onClick={() => onEdit(facility)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <Pencil size={13} /> Edit SOP
          </button>
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 size={13} /> {archiving ? "Archiving…" : "Delete Facility"}
          </button>
        </div>
      </div>
    </div>
  );
}
