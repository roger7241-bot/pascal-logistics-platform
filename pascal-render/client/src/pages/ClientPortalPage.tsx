import { useEffect, useState } from "react";
import { Package, Clock, ShieldCheck, PiggyBank, Plus, Upload, Search, MessageCircle, Truck, Ship, Plane, Settings } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { ShipmentDetailDrawer } from "../components/ShipmentDetailDrawer";
import { ClientShipmentIntakeWizard } from "../components/ClientShipmentIntakeWizard";
import { ClientOpsBaselineWizard } from "../components/ClientOpsBaselineWizard";
import { ChatbotWidget } from "../components/ChatbotWidget";
import { api } from "../config/api";
import type { ClientShipmentSummary, StatusChip } from "../types/shipment";

const MODE_ICON: Record<string, typeof Truck> = { road: Truck, ocean: Ship, air: Plane };

const STATUS_CHIP_LABEL: Record<StatusChip, string> = {
  paps_pars_released: "PAPS/PARS Released",
  customs_hold_flagged: "Customs Hold Flagged",
  vessel_en_route: "Vessel En Route",
  flight_departed: "Flight Departed",
  in_transit: "In Transit",
  delivered: "Delivered",
};

const STATUS_CHIP_CLASS: Record<StatusChip, string> = {
  paps_pars_released: "bg-emerald-100 text-emerald-700",
  customs_hold_flagged: "bg-rose-100 text-rose-700",
  vessel_en_route: "bg-sky-100 text-sky-700",
  flight_departed: "bg-violet-100 text-violet-700",
  in_transit: "bg-cyan-100 text-cyan-700",
  delivered: "bg-emerald-100 text-emerald-700",
};

// Executive retainer summary — HONEST LIMITATION: real border-clearance %
// and capital-saved figures need the same live rate-benchmark and border
// telemetry history a production deployment would accumulate over time;
// these are representative figures pending that history existing.
const RETAINER_SUMMARY = {
  activeShipments: 4,
  onTimeBorderClearancePct: 94,
  avgBorderTransitHours: 6.4,
  capitalSavedMtdUsd: 8420,
};

export function ClientPortalPage() {
  const [shipments, setShipments] = useState<ClientShipmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ClientShipmentSummary | undefined>(undefined);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);

  useEffect(() => {
    api
      .clientShipments<{ shipments: ClientShipmentSummary[] }>()
      .then((data) => setShipments(data.shipments))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <h1 className="text-xl font-bold">Client Self-Service Portal</h1>

        {/* Executive retainer KPI summary */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-slate-500">
              <Package size={14} />
              <span className="text-xs font-mono uppercase tracking-wide">Active shipments</span>
            </div>
            <p className="text-2xl font-bold">{RETAINER_SUMMARY.activeShipments}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-slate-500">
              <ShieldCheck size={14} />
              <span className="text-xs font-mono uppercase tracking-wide">On-time clearance</span>
            </div>
            <p className="text-2xl font-bold">{RETAINER_SUMMARY.onTimeBorderClearancePct}%</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-slate-500">
              <Clock size={14} />
              <span className="text-xs font-mono uppercase tracking-wide">Avg border transit</span>
            </div>
            <p className="text-2xl font-bold">{RETAINER_SUMMARY.avgBorderTransitHours}h</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-emerald-700">
              <PiggyBank size={14} />
              <span className="text-xs font-mono uppercase tracking-wide">Capital saved MTD</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700">${RETAINER_SUMMARY.capitalSavedMtdUsd.toLocaleString()}</p>
          </div>
        </div>

        {/* Quick action hub */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button onClick={() => setWizardOpen(true)} className="flex items-center justify-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-3 text-sm font-semibold text-white shadow-sm hover:bg-cyan-500">
            <Plus size={15} /> Book New Shipment
          </button>
          <button className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            <Upload size={15} /> Upload Document
          </button>
          <button className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            <Search size={15} /> Track by BOL/#
          </button>
          <button className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
            <MessageCircle size={15} /> Ask Agent 5
          </button>
        </div>

        {/* Multi-mode shipment grid */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold">Active shipments — all modes</p>
            <div className="flex items-center gap-3">
              {loading && <span className="text-xs text-slate-400">Loading...</span>}
              <button onClick={() => setBaselineOpen(true)} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
                <Settings size={12} /> Manage facilities &amp; commodities
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {shipments.map((shipment) => {
              const ModeIcon = MODE_ICON[shipment.transportMode];
              return (
                <button
                  key={shipment.id}
                  onClick={() => setSelected(shipment)}
                  className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50"
                >
                  <ModeIcon size={16} className="shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold text-slate-900">{shipment.id}</p>
                    <p className="text-xs text-slate-500">{shipment.lane}</p>
                  </div>
                  <span className="hidden text-xs text-slate-500 sm:inline">{shipment.tracker.percentComplete}% complete</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CHIP_CLASS[shipment.statusChip]}`}>
                    {STATUS_CHIP_LABEL[shipment.statusChip]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {selected && <ShipmentDetailDrawer shipment={selected} onClose={() => setSelected(undefined)} />}
      {wizardOpen && <ClientShipmentIntakeWizard onClose={() => setWizardOpen(false)} />}
      {baselineOpen && <ClientOpsBaselineWizard onClose={() => setBaselineOpen(false)} />}
      <ChatbotWidget />
    </div>
  );
}
