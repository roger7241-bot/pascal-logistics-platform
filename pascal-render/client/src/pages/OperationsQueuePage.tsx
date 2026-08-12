import { useEffect, useState, useMemo } from "react";
import {
  Inbox,
  Truck,
  Ship,
  Plane,
  Search,
  CheckSquare,
  Square,
  MessageSquare,
  AlertTriangle,
  X,
  Loader2,
  RefreshCcw,
  UploadCloud,
  ShieldAlert,
} from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";
import { pascalSocket, type WsEnvelope } from "../config/api";

interface ShipmentRow {
  id: string;
  transportMode: string;
  currentMilestone: string;
  statusChip: string;
  lane: string;
  clientOrg?: string;
  driverName?: string;
  driverPhone?: string;
  poeId?: string;
  liveWaitMinutes?: number;
  htsCode?: string;
  equipmentType?: string;
  carrierName?: string;
  commercialInvoiceValueUsd?: number;
  aiRationale?: string;
  dispatchStage?: string;
  dispatchStageLabels?: string[];
  tracker: { currentIndex: number; percentComplete: number };
}

const MODE_ICON: Record<string, typeof Truck> = { road: Truck, ocean: Ship, air: Plane };

const STATUS_CLASS: Record<string, string> = {
  paps_pars_released: "bg-emerald-100 text-emerald-700",
  customs_hold_flagged: "bg-rose-100 text-rose-700",
  vessel_en_route: "bg-sky-100 text-sky-700",
  flight_departed: "bg-violet-100 text-violet-700",
  in_transit: "bg-cyan-100 text-cyan-700",
  delivered: "bg-emerald-100 text-emerald-700",
};

const MODE_TABS = [
  { key: "all", label: "All Modes" },
  { key: "road", label: "Road / Cross-Border" },
  { key: "ocean", label: "Ocean Freight" },
  { key: "air", label: "Air Cargo" },
] as const;

const STATUS_TABS = [
  { key: "all", label: "All Statuses" },
  { key: "customs_hold_flagged", label: "Customs Holds / Action Required" },
  { key: "paps_pars_released", label: "PAPS/PARS Released" },
  { key: "in_transit", label: "In Transit" },
] as const;

export function OperationsQueuePage() {
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<(typeof MODE_TABS)[number]["key"]>("all");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_TABS)[number]["key"]>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerShipmentId, setDrawerShipmentId] = useState<string | undefined>(undefined);
  const [actionBusy, setActionBusy] = useState(false);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [batchMessage, setBatchMessage] = useState("");
  const [batchSending, setBatchSending] = useState(false);
  const [batchResultNote, setBatchResultNote] = useState<string | undefined>(undefined);

  const load = () => {
    setLoading(true);
    api
      .clientShipments<{ shipments: ShipmentRow[] }>()
      .then((d) => setShipments(d.shipments))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    pascalSocket.connect();
    const unsubscribe = pascalSocket.subscribe((envelope: WsEnvelope) => {
      if (envelope.channel === "shipment_status") {
        const payload = envelope.payload as { shipmentId: string };
        setFlashIds((prev) => new Set(prev).add(payload.shipmentId));
        load();
        setTimeout(() => {
          setFlashIds((prev) => {
            const next = new Set(prev);
            next.delete(payload.shipmentId);
            return next;
          });
        }, 1500);
      }
    });
    return () => {
      unsubscribe();
      pascalSocket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return shipments.filter((s) => {
      if (modeFilter !== "all" && s.transportMode !== modeFilter) return false;
      if (statusFilter !== "all" && s.statusChip !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = `${s.id} ${s.clientOrg ?? ""} ${s.driverName ?? ""} ${s.htsCode ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [shipments, modeFilter, statusFilter, search]);

  const drawerShipment = shipments.find((s) => s.id === drawerShipmentId);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleOverridePaps = async (id: string) => {
    setActionBusy(true);
    try {
      await api.overridePaps(id);
      load();
      setDrawerShipmentId(undefined);
    } finally {
      setActionBusy(false);
    }
  };

  const handleReroute = async (id: string, poeId: string) => {
    setActionBusy(true);
    try {
      await api.rerouteShipment(id, poeId);
      load();
      setDrawerShipmentId(undefined);
    } finally {
      setActionBusy(false);
    }
  };

  const handleRequestVault = async (id: string) => {
    setActionBusy(true);
    try {
      await api.requestVaultUpload(id);
      setDrawerShipmentId(undefined);
    } finally {
      setActionBusy(false);
    }
  };

  const handleEscalate = async (id: string) => {
    setActionBusy(true);
    try {
      await api.escalateShipment(id);
      setDrawerShipmentId(undefined);
    } finally {
      setActionBusy(false);
    }
  };

  const handleBatchSms = async () => {
    if (selected.size === 0 || !batchMessage.trim()) return;
    setBatchSending(true);
    setBatchResultNote(undefined);
    try {
      const result = await api.batchSms<{ results: { shipmentId: string; sent: boolean }[] }>(Array.from(selected), batchMessage);
      const sentCount = result.results.filter((r) => r.sent).length;
      setBatchResultNote(`Sent to ${sentCount}/${result.results.length} driver(s).`);
      setBatchMessage("");
      setSelected(new Set());
    } finally {
      setBatchSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-3 p-6">
        <div className="flex items-center gap-2">
          <Inbox size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Operations Queue</h1>
          <span className="ml-2 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Agent 6 Desk</span>
          <button onClick={load} className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <RefreshCcw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {/* Search, filter & batch bar */}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Shipment ID, Client Org, Driver Name, or HTS Code..."
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {MODE_TABS.map((t) => (
              <button key={t.key} onClick={() => setModeFilter(t.key)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${modeFilter === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_TABS.map((t) => (
              <button key={t.key} onClick={() => setStatusFilter(t.key)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusFilter === t.key ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 p-2.5">
              <span className="text-xs font-semibold text-cyan-700">{selected.size} selected</span>
              <input
                value={batchMessage}
                onChange={(e) => setBatchMessage(e.target.value)}
                placeholder="Batch SMS message to drivers..."
                className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button onClick={handleBatchSms} disabled={batchSending || !batchMessage.trim()} className="flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
                {batchSending ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Send batch SMS
              </button>
              {batchResultNote && <span className="text-xs text-emerald-600">{batchResultNote}</span>}
            </div>
          )}
        </div>

        {/* Dispatch grid */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {filtered.map((s) => {
              const ModeIcon = MODE_ICON[s.transportMode];
              const isFlashing = flashIds.has(s.id);
              return (
                <div key={s.id} className={`flex items-start gap-3 px-5 py-4 transition-colors ${isFlashing ? "bg-emerald-50" : ""}`}>
                  <button onClick={() => toggleSelect(s.id)} className="mt-1 shrink-0 text-slate-400 hover:text-cyan-600">
                    {selected.has(s.id) ? <CheckSquare size={16} className="text-cyan-600" /> : <Square size={16} />}
                  </button>
                  <ModeIcon size={16} className="mt-1 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-bold text-slate-900">{s.id}</p>
                      <button
                        onClick={() => setDrawerShipmentId(s.id)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[s.statusChip]} ${s.statusChip === "customs_hold_flagged" ? "ring-2 ring-rose-300" : ""}`}
                      >
                        {s.statusChip.replace(/_/g, " ")}
                      </button>
                      {s.clientOrg && <span className="text-xs text-slate-400">{s.clientOrg}</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.equipmentType} {s.carrierName && `· ${s.carrierName}`} {s.commercialInvoiceValueUsd && `· $${s.commercialInvoiceValueUsd.toLocaleString()}`} {s.htsCode && `· HTS ${s.htsCode}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      {s.driverName} {s.driverPhone && `(${s.driverPhone})`} {s.poeId && `· ${s.poeId.replace(/_/g, " ")}`} {s.liveWaitMinutes !== undefined && `· ${s.liveWaitMinutes}m wait`}
                    </p>

                    {s.dispatchStageLabels && (
                      <div className="mt-2 flex items-center gap-1">
                        {s.dispatchStageLabels.map((label, i) => (
                          <div key={label} className="flex items-center gap-1">
                            <span className={`h-1.5 w-8 rounded-full ${i <= s.tracker.currentIndex ? "bg-cyan-500" : "bg-slate-200"}`} />
                            {i === s.tracker.currentIndex && <span className="text-[10px] font-semibold text-cyan-700">{label}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {s.statusChip === "customs_hold_flagged" && <AlertTriangle size={16} className="mt-1 shrink-0 text-rose-500" />}
                </div>
              );
            })}
            {!loading && filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No shipments match these filters.</p>}
          </div>
        </div>
      </main>

      {/* Inline HITL Exception Drawer */}
      {drawerShipment && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDrawerShipmentId(undefined)}>
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 font-mono text-sm font-bold text-slate-900">
                <ShieldAlert size={15} className="text-rose-500" /> {drawerShipment.id}
              </p>
              <button onClick={() => setDrawerShipmentId(undefined)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            {drawerShipment.aiRationale && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="mb-1 text-xs font-mono uppercase tracking-wide text-rose-500">AI rationale (Agent 2/4)</p>
                <p className="text-sm text-rose-800">{drawerShipment.aiRationale}</p>
              </div>
            )}

            <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Actions</p>
            <div className="space-y-2">
              <button
                onClick={() => handleOverridePaps(drawerShipment.id)}
                disabled={actionBusy}
                className="flex w-full items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                {actionBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckSquare size={14} />} Override &amp; Re-file PAPS
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleReroute(drawerShipment.id, "sumas")}
                  disabled={actionBusy}
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Re-Route to Sumas
                </button>
                <button
                  onClick={() => handleReroute(drawerShipment.id, "aldergrove")}
                  disabled={actionBusy}
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Re-Route to Aldergrove
                </button>
              </div>
              <button
                onClick={() => handleRequestVault(drawerShipment.id)}
                disabled={actionBusy}
                className="flex w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <UploadCloud size={14} /> Request Client Vault Upload
              </button>
              <button
                onClick={() => handleEscalate(drawerShipment.id)}
                disabled={actionBusy}
                className="flex w-full items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                <ShieldAlert size={14} /> Escalate to Agent 9
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
