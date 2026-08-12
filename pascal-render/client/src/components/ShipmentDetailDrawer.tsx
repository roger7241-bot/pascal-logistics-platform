import { X, Truck, Ship, Plane, FileText, CheckCircle2, Circle, Camera } from "lucide-react";
import type { ClientShipmentSummary } from "../types/shipment";

const MODE_ICON: Record<string, typeof Truck> = { road: Truck, ocean: Ship, air: Plane };

const STATUS_CHIP_LABEL: Record<string, string> = {
  paps_pars_released: "PAPS/PARS Released",
  customs_hold_flagged: "Customs Hold Flagged",
  vessel_en_route: "Vessel En Route",
  flight_departed: "Flight Departed",
  in_transit: "In Transit",
  delivered: "Delivered",
};

const STATUS_CHIP_CLASS: Record<string, string> = {
  paps_pars_released: "bg-emerald-100 text-emerald-700 border-emerald-200",
  customs_hold_flagged: "bg-rose-100 text-rose-700 border-rose-200",
  vessel_en_route: "bg-sky-100 text-sky-700 border-sky-200",
  flight_departed: "bg-violet-100 text-violet-700 border-violet-200",
  in_transit: "bg-cyan-100 text-cyan-700 border-cyan-200",
  delivered: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export interface ShipmentDetailDrawerProps {
  shipment: ClientShipmentSummary;
  onClose: () => void;
}

export function ShipmentDetailDrawer({ shipment, onClose }: ShipmentDetailDrawerProps) {
  const ModeIcon = MODE_ICON[shipment.transportMode];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ModeIcon size={18} className="text-slate-500" />
            <p className="font-mono text-sm font-bold text-slate-900">{shipment.id}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <span className={`mb-4 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CHIP_CLASS[shipment.statusChip]}`}>
          {STATUS_CHIP_LABEL[shipment.statusChip]}
        </span>

        <p className="mb-4 text-sm text-slate-600">{shipment.lane}</p>

        {/* Mode-specific progress tracker */}
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="mb-3 text-xs font-mono uppercase tracking-wide text-slate-500">
            {shipment.transportMode === "road" ? "Road/Border" : shipment.transportMode === "ocean" ? "Ocean" : "Air"} progress —{" "}
            {shipment.tracker.percentComplete}% complete
          </p>
          <div className="space-y-2">
            {shipment.tracker.steps.map((step, i) => {
              const isDone = i < shipment.tracker.currentIndex;
              const isCurrent = i === shipment.tracker.currentIndex;
              return (
                <div key={step.milestone} className="flex items-center gap-2">
                  {isDone ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                  ) : isCurrent ? (
                    <div className="flex h-[15px] w-[15px] shrink-0 items-center justify-center">
                      <div className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
                    </div>
                  ) : (
                    <Circle size={15} className="shrink-0 text-slate-300" />
                  )}
                  <span className={`text-xs ${isCurrent ? "font-semibold text-slate-900" : isDone ? "text-slate-500" : "text-slate-400"}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mode-specific detail fields */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          {shipment.driverName && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Driver</p>
              <p className="text-sm text-slate-900">{shipment.driverName}</p>
              <p className="text-xs text-slate-500">{shipment.driverPhone}</p>
            </div>
          )}
          {shipment.vesselName && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Vessel</p>
              <p className="text-sm text-slate-900">{shipment.vesselName}</p>
            </div>
          )}
          {shipment.flightNumber && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Flight</p>
              <p className="text-sm text-slate-900">{shipment.flightNumber}</p>
            </div>
          )}
          {shipment.htsCode && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">HTS Code</p>
              <p className="font-mono text-sm text-slate-900">{shipment.htsCode}</p>
            </div>
          )}
        </div>

        {shipment.transportMode === "road" && (
          <button className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
            <Camera size={13} /> View live border telemetry &amp; camera feed
          </button>
        )}

        {/* Vault documents */}
        <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Vault documents</p>
        <div className="space-y-1.5">
          {shipment.linkedDocuments.map((doc) => (
            <div key={doc.filename} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <FileText size={13} className="shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-900">{doc.filename}</p>
                <p className="text-xs text-slate-500">{doc.category}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
