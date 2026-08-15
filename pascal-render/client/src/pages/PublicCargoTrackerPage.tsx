import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Package, MapPin, Truck, CheckCircle2, Search } from "lucide-react";
import type { PublicTrackingPayload } from "../types/cx";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

const MILESTONE_LABEL: Record<string, string> = {
  pickup: "Picked Up",
  export_manifest: "Export Manifest Filed",
  poe_inspection: "Border Inspection",
  paps_pars_release: "Cleared for Crossing",
  delivery: "Delivered",
  rail_ramp_origin_gate_in: "Rail Ramp Origin Gate-In",
  rail_transit: "Rail Transit",
  rail_ramp_destination_arrival: "Rail Ramp Destination Arrival",
  container_loaded: "Container Loaded",
  port_origin_gate_in: "Origin Port Gate-In",
  vessel_departure: "Vessel Departed",
  transshipment: "Transshipment",
  port_destination_arrival: "Destination Port Arrival",
  customs_clearance: "Customs Cleared",
  drayage_delivery: "Drayage Delivery",
  acceptance_at_terminal: "Accepted at Terminal",
  customs_export_release: "Export Customs Release",
  flight_departure: "Flight Departed",
  import_airport_arrival: "Import Airport Arrival",
  pga_customs_clearance: "PGA Customs Clearance",
  final_mile_delivery: "Final Mile Delivery",
};

export function PublicCargoTrackerPage() {
  const { shipmentId: routeShipmentId } = useParams<{ shipmentId: string }>();
  const [inputValue, setInputValue] = useState(routeShipmentId ?? "");
  const [tracking, setTracking] = useState<PublicTrackingPayload | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function lookup(id: string) {
    if (!id.trim()) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/track/${encodeURIComponent(id.trim())}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Shipment not found.");
      }
      setTracking(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
      setTracking(undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (routeShipmentId) lookup(routeShipmentId);
  }, [routeShipmentId]);

  const progressIndex = tracking ? tracking.milestoneSequence.indexOf(tracking.currentMilestone) : -1;
  const progressPct = tracking && progressIndex >= 0 ? Math.round(((progressIndex + 1) / tracking.milestoneSequence.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center gap-2">
          <Package size={20} className="text-slate-500" />
          <h1 className="text-xl font-bold">Track Your Shipment</h1>
        </div>

        <div className="mb-6 flex gap-2">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup(inputValue)}
            placeholder="Enter tracking number (e.g. SHIP-2026-8801)"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-400"
          />
          <button onClick={() => lookup(inputValue)} disabled={loading} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            <Search size={14} /> {loading ? "Searching…" : "Track"}
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

        {tracking && (
          <>
            {/* ============================================================
                ISOLATED SNIPPET 1: Milestone Progress Bar
                ============================================================ */}
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">{tracking.statusLabel}</p>
                <span className="text-xs text-slate-400">{progressPct}% complete</span>
              </div>
              <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between">
                {tracking.milestoneSequence.map((milestone, i) => (
                  <div key={milestone} className="flex flex-col items-center" style={{ width: `${100 / tracking.milestoneSequence.length}%` }}>
                    {i <= progressIndex ? (
                      <CheckCircle2 size={14} className="text-emerald-500" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-slate-200" />
                    )}
                    <p className={`mt-1 text-center text-[10px] leading-tight ${i <= progressIndex ? "font-semibold text-slate-700" : "text-slate-400"}`}>
                      {MILESTONE_LABEL[milestone] ?? milestone}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            {/* ======================== END SNIPPET 1 ======================== */}

            {/* ============================================================
                ISOLATED SNIPPET 2: Public Map/ETA Card
                ============================================================ */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <MapPin size={15} className="text-slate-400" />
                <p className="text-sm font-semibold text-slate-900">{tracking.lane}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Carrier</p>
                  <p className="flex items-center gap-1 font-semibold text-slate-800">
                    <Truck size={13} /> {tracking.carrierName ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Estimated Arrival</p>
                  <p className="font-semibold text-slate-800">{tracking.etaIso ? new Date(tracking.etaIso).toLocaleString() : "—"}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">Last updated {new Date(tracking.lastUpdatedIso).toLocaleString()}</p>
            </div>
            {/* ======================== END SNIPPET 2 ======================== */}
          </>
        )}
      </div>
    </div>
  );
}
