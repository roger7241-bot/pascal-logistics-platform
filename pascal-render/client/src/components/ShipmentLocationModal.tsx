import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../config/api";
import { ProgressBar } from "./KpiCard";

export interface ShipmentLocation {
  id: string;
  clientOrg?: string;
  lane: string;
  transportMode: string;
  statusChip: string;
  tracker: { steps: { milestone: string; label: string }[]; currentIndex: number; percentComplete: number };
  carrierName?: string;
  bolNumber?: string;
  proNumber?: string;
  driverName?: string;
  driverPhone?: string;
  vesselName?: string;
  flightNumber?: string;
  etaIso?: string;
  updatedAtIso: string;
  liveBorderWait?: { poeId: string; waitMinutes: number; status: string; asOfIso: string };
  locationBasis: string;
}

interface ShipmentLocationModalProps {
  shipmentId: string;
  onClose: () => void;
}

/** Real "where does this stand right now" view — milestone tracking + live
 * border wait telemetry, explicitly not GPS (this system has no live
 * carrier-tracking integration). Shared between the Manager Hub's
 * attention queue/snapshot and the Executive Review page, so a reviewer
 * deciding whether to approve a shipment doesn't have to jump to a
 * different tab to see its actual status first. */
export function ShipmentLocationModal({ shipmentId, onClose }: ShipmentLocationModalProps) {
  const [detail, setDetail] = useState<ShipmentLocation | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setDetail(undefined);
    api
      .ceoShipmentLocation<ShipmentLocation>(shipmentId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [shipmentId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
        {loading && !detail ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : detail ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-mono text-sm font-bold">{detail.id}</p>
                <p className="text-xs text-slate-500">{detail.clientOrg} · {detail.lane}</p>
              </div>
              <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>

            {/* Milestone tracker — the real "where does this stand" signal */}
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Current Stage</p>
                <p className="text-xs font-semibold text-slate-700">{detail.tracker.percentComplete}% complete</p>
              </div>
              <ProgressBar percent={detail.tracker.percentComplete} colorClass="bg-cyan-500" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.tracker.steps.map((step, i) => (
                  <span
                    key={step.milestone}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      i === detail.tracker.currentIndex
                        ? "bg-cyan-600 text-white"
                        : i < detail.tracker.currentIndex
                        ? "bg-cyan-100 text-cyan-700"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {step.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Live border wait, when applicable — genuinely live, not a static number */}
            {detail.liveBorderWait && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="mb-1 text-xs font-mono uppercase tracking-wide text-amber-800">Live Border Wait — {detail.liveBorderWait.poeId}</p>
                <p className="text-lg font-bold text-amber-900">{detail.liveBorderWait.waitMinutes} min</p>
                <p className="text-[11px] text-amber-600">As of {new Date(detail.liveBorderWait.asOfIso).toLocaleTimeString()} — {detail.liveBorderWait.status}</p>
              </div>
            )}

            <div className="space-y-1.5 text-xs">
              <p><strong>Carrier:</strong> {detail.carrierName ?? "—"}</p>
              {(detail.bolNumber || detail.proNumber) && (
                <p>
                  {detail.bolNumber && <><strong>BOL #:</strong> <span className="font-mono">{detail.bolNumber}</span></>}
                  {detail.bolNumber && detail.proNumber && "  ·  "}
                  {detail.proNumber && <><strong>PRO #:</strong> <span className="font-mono">{detail.proNumber}</span></>}
                </p>
              )}
              {detail.driverName && (
                <p><strong>Driver:</strong> {detail.driverName} {detail.driverPhone && `· ${detail.driverPhone}`}</p>
              )}
              {detail.vesselName && <p><strong>Vessel:</strong> {detail.vesselName}</p>}
              {detail.flightNumber && <p><strong>Flight:</strong> {detail.flightNumber}</p>}
              <p><strong>ETA:</strong> {detail.etaIso ? new Date(detail.etaIso).toLocaleString() : "—"}</p>
              <p><strong>Last updated:</strong> {new Date(detail.updatedAtIso).toLocaleString()}</p>
            </div>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-500">
              Based on milestone tracking{detail.liveBorderWait ? " and live border wait telemetry" : ""} — not GPS. This system doesn't have a live carrier-tracking integration (e.g. Project44, FourKites, or ELD access) yet, so this reflects the most recent known status rather than a real-time map position.
            </div>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-rose-500">No shipment found with that ID.</p>
        )}
      </div>
    </div>
  );
}
