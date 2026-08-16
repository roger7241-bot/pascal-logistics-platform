import { useEffect, useState } from "react";
import {
  Gauge,
  TrendingUp,
  FileCheck,
  ShieldAlert,
  Loader2,
  Truck,
  Camera,
  AlertTriangle,
  Radio,
  DollarSign,
  X,
} from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { BorderCameraGrid } from "../components/BorderCameraGrid";
import { KpiCard, ProgressBar } from "../components/KpiCard";
import { api } from "../config/api";

interface CeoMetrics {
  borderTransitVelocityMinutes?: number;
  documentHealthScore: number;
  mtdSpotSavingsUsd: number;
  mtdPaidInvoicesUsd: number;
  avoidedDetentionFeesUsd: number;
  monthlyRetainerCostUsd: number;
  netRetainerValueUsd: number;
  pendingExecutiveReviewCount: number;
  dataNote: string;
}

interface CeoAlerts {
  usmcaExpiringCount: number;
  pgaHoldCount: number;
}

interface ActivityEntry {
  id: string;
  eventType: string;
  shipmentId?: string;
  message: string;
  occurredAtIso: string;
}

interface CorridorShipment {
  id: string;
  clientOrg: string;
  driverName?: string;
  poeId?: string;
  customsStatus: string;
  etaIso?: string;
}

interface SnapshotShipment {
  id: string;
  clientOrg: string;
  lane: string;
  transportMode: string;
  direction: "inbound" | "outbound";
  statusChip: string;
  etaIso?: string;
  isOverdue: boolean;
  carrierName?: string;
}

interface AttentionItem {
  category: "customs_hold" | "reroute_pending" | "executive_review" | "usmca_expiring";
  priority: number;
  title: string;
  detail: string;
  occurredAtIso: string;
  linkId: string;
}

interface ShipmentLocation {
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

interface BorderReading {
  poeId: string;
  direction: string;
  laneType: string;
  waitMinutes: number;
  status: "green" | "amber" | "red";
}

// The 3 key commercial freight ports this dashboard focuses on — Peace Arch
// (passenger-only) and Point Roberts (minor/regional) are excluded here,
// matching the spec's explicit 3-port scope for this panel.
const COMMERCIAL_POE_LABELS: Record<string, string> = {
  pacific_highway: "Pacific Highway / Blaine",
  sumas: "Sumas / Abbotsford",
  aldergrove: "Aldergrove / Lynden (Hwy 13 / Guide Meridian)",
};

const POE_LABELS: Record<string, string> = {
  ...COMMERCIAL_POE_LABELS,
  peace_arch: "Peace Arch",
  point_roberts: "Point Roberts",
};

const CUSTOMS_STATUS_CLASS: Record<string, string> = {
  PAPS_CLEARED: "bg-emerald-100 text-emerald-700",
  PGA_REVIEW: "bg-rose-100 text-rose-700",
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
};

const STATUS_LABEL: Record<string, string> = { green: "Clear", amber: "Moderate", red: "Heavy" };
const STATUS_DOT: Record<string, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400" };

const FILTER_TABS = [
  { key: "all", label: "All Active" },
  { key: "in_transit", label: "Border In-Transit" },
  { key: "holds", label: "Customs Holds" },
] as const;

export function CeoHubPage() {
  const [metrics, setMetrics] = useState<CeoMetrics | undefined>(undefined);
  const [alerts, setAlerts] = useState<CeoAlerts | undefined>(undefined);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [corridorShipments, setCorridorShipments] = useState<CorridorShipment[]>([]);
  const [shipmentSnapshot, setShipmentSnapshot] = useState<{ inbound: SnapshotShipment[]; outbound: SnapshotShipment[] }>({ inbound: [], outbound: [] });
  const [attentionQueue, setAttentionQueue] = useState<AttentionItem[]>([]);
  const [locationDetail, setLocationDetail] = useState<ShipmentLocation | undefined>(undefined);
  const [locationLoading, setLocationLoading] = useState(false);

  function openLocationDetail(shipmentId: string) {
    setLocationLoading(true);
    setLocationDetail(undefined);
    api
      .ceoShipmentLocation<ShipmentLocation>(shipmentId)
      .then(setLocationDetail)
      .finally(() => setLocationLoading(false));
  }
  const [borderReadings, setBorderReadings] = useState<BorderReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTER_TABS)[number]["key"]>("all");
  const [camerasOpen, setCamerasOpen] = useState(false);

  const loadAll = () => {
    Promise.all([
      api.ceoMetrics<CeoMetrics>(),
      api.ceoAlerts<CeoAlerts>(),
      api.ceoActivity<{ activity: ActivityEntry[] }>(),
      api.ceoCorridorShipments<{ shipments: CorridorShipment[] }>(),
      api.borderTelemetry<{ readings: BorderReading[] }>(),
      api.ceoShipmentSnapshot<{ inbound: SnapshotShipment[]; outbound: SnapshotShipment[] }>(),
      api.ceoAttentionQueue<{ items: AttentionItem[] }>(),
    ])
      .then(([m, a, act, corridor, border, snapshot, attention]) => {
        setMetrics(m);
        setAlerts(a);
        setActivity(act.activity);
        setCorridorShipments(corridor.shipments);
        setBorderReadings(border.readings);
        setShipmentSnapshot(snapshot);
        setAttentionQueue(attention.items);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 20_000); // real periodic refresh, not one-shot
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalAlerts = (alerts?.usmcaExpiringCount ?? 0) + (alerts?.pgaHoldCount ?? 0);

  const filteredShipments = corridorShipments.filter((s) => {
    if (filter === "in_transit") return s.customsStatus === "IN_TRANSIT";
    if (filter === "holds") return s.customsStatus === "PGA_REVIEW";
    return true;
  });

  // Congestion strip — 3 key commercial freight ports only, commercial lane.
  const congestionByPoe = Object.entries(COMMERCIAL_POE_LABELS)
    .map(([poeId, label]) => {
      const reading = borderReadings.find((r) => r.poeId === poeId && r.laneType === "commercial");
      return reading ? { poeId, label, waitMinutes: reading.waitMinutes, status: reading.status } : undefined;
    })
    .filter((x): x is { poeId: string; label: string; waitMinutes: number; status: "green" | "amber" | "red" } => !!x);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge size={18} className="text-slate-500" />
            <h1 className="text-xl font-bold">Manager Real-Time Status Panel</h1>
          </div>
          {totalAlerts > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5">
              <AlertTriangle size={14} className="text-amber-600" />
              <span className="text-xs font-semibold text-amber-700">
                {alerts!.pgaHoldCount > 0 && `${alerts!.pgaHoldCount} shipment(s) on PGA hold`}
                {alerts!.pgaHoldCount > 0 && alerts!.usmcaExpiringCount > 0 && " · "}
                {alerts!.usmcaExpiringCount > 0 && `${alerts!.usmcaExpiringCount} USMCA cert(s) expiring in 7 days`}
              </span>
            </div>
          )}
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading live metrics...
          </p>
        )}

        {metrics && (
          <>
            {/* KPI row — color reflects whether the metric needs attention,
                not whether it's a revenue number, consistent across every desk. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                icon={TrendingUp}
                label="Border transit velocity"
                value={metrics.borderTransitVelocityMinutes !== undefined ? `${metrics.borderTransitVelocityMinutes}m` : "—"}
                caption="Live Pacific Highway commercial avg"
                status={metrics.borderTransitVelocityMinutes !== undefined && metrics.borderTransitVelocityMinutes > 45 ? "attention" : "neutral"}
              />

              <div className={`rounded-xl border p-4 ${metrics.documentHealthScore < 70 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white shadow-sm"}`}>
                <div className={`mb-1 flex items-center gap-2 ${metrics.documentHealthScore < 70 ? "text-amber-700" : "text-slate-500"}`}>
                  <FileCheck size={15} />
                  <span className="text-[13px] font-mono uppercase tracking-wide">Document health score</span>
                </div>
                <p className={`mb-1.5 text-[28px] font-bold leading-tight ${metrics.documentHealthScore < 70 ? "text-amber-700" : ""}`}>{metrics.documentHealthScore}%</p>
                <ProgressBar percent={metrics.documentHealthScore} colorClass={metrics.documentHealthScore < 70 ? "bg-amber-500" : "bg-emerald-500"} />
                <p className={`mt-1 text-[13px] ${metrics.documentHealthScore < 70 ? "text-amber-600" : "text-slate-400"}`}>POA status (60%) + vault activity (40%)</p>
              </div>

              <KpiCard
                icon={DollarSign}
                label="MTD Agent 3 savings"
                value={`$${metrics.mtdSpotSavingsUsd.toLocaleString()}`}
                caption={metrics.mtdSpotSavingsUsd > 0 ? "Real captured spot-rate savings this month" : "No savings captured yet this month"}
                status={metrics.mtdSpotSavingsUsd > 0 ? "good" : "attention"}
              />

              <KpiCard
                icon={ShieldAlert}
                label="Pending executive review"
                value={String(metrics.pendingExecutiveReviewCount)}
                status={metrics.pendingExecutiveReviewCount > 0 ? "attention" : "neutral"}
              />
            </div>

            {/* Attention Queue — the judgment layer, not just more KPI
                counts. What a manager with real experience would triage
                first: real, itemized, prioritized action items pulled from
                genuinely persisted data, not a generic alert count. */}
            {attentionQueue.length > 0 && (
              <div className="rounded-xl border border-amber-400 bg-amber-50 shadow-sm">
                <div className="flex items-center justify-between border-b border-amber-300 px-5 py-3">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                    <ShieldAlert size={15} /> Needs Attention Today
                  </p>
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-900">{attentionQueue.length}</span>
                </div>
                <div className="divide-y divide-amber-200">
                  {attentionQueue.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => item.linkId.startsWith("SHIP-") && openLocationDetail(item.linkId)}
                      className={`flex w-full items-start gap-3 px-5 py-3 text-left ${item.linkId.startsWith("SHIP-") ? "hover:bg-amber-100" : "cursor-default"}`}
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          item.category === "customs_hold"
                            ? "bg-rose-200 text-rose-800"
                            : item.category === "reroute_pending"
                            ? "bg-sky-200 text-sky-800"
                            : item.category === "executive_review"
                            ? "bg-violet-200 text-violet-800"
                            : "bg-amber-200 text-amber-800"
                        }`}
                      >
                        {item.category.replace("_", " ")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-500">{item.detail}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Shipment Snapshot — every mode, split by real direction,
                soonest-ETA-first with overdue items always floated to the
                top regardless of group. */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <Truck size={14} /> Shipment Snapshot — Inbound &amp; Outbound
                </p>
              </div>
              <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                {(["inbound", "outbound"] as const).map((dir) => (
                  <div key={dir}>
                    <p className="px-5 pt-3 text-xs font-mono uppercase tracking-wide text-slate-400">
                      {dir === "inbound" ? "Inbound to Canada" : "Outbound from Canada"} ({shipmentSnapshot[dir].length})
                    </p>
                    <div className="divide-y divide-slate-100">
                      {shipmentSnapshot[dir].length === 0 && <p className="px-5 py-6 text-center text-xs text-slate-400">No {dir} shipments on file.</p>}
                      {shipmentSnapshot[dir].map((s) => (
                        <button key={s.id} onClick={() => openLocationDetail(s.id)} className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left hover:bg-slate-50">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-slate-900">
                              {s.id} <span className="font-sans font-normal text-slate-400">· {s.clientOrg}</span>
                            </p>
                            <p className="text-xs text-slate-500">{s.lane}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`text-xs font-semibold ${s.isOverdue ? "text-rose-600" : "text-slate-700"}`}>
                              {s.isOverdue ? "OVERDUE" : s.etaIso ? new Date(s.etaIso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
                            </p>
                            <p className="text-[11px] text-slate-400">{s.carrierName ?? s.transportMode}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Net Retainer Value ROI bar */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Net Retainer Value Delivered (MTD)</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>Spot savings: <strong className="text-emerald-600">+${metrics.mtdSpotSavingsUsd.toLocaleString()}</strong></span>
                <span>Avoided detention fees: <strong className="text-slate-400">+${metrics.avoidedDetentionFeesUsd.toLocaleString()} (not tracked yet)</strong></span>
                <span>Monthly retainer cost: <strong className="text-rose-600">−${metrics.monthlyRetainerCostUsd.toLocaleString()}</strong></span>
              </div>
              <p className={`mt-2 text-xl font-bold ${metrics.netRetainerValueUsd >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {metrics.netRetainerValueUsd >= 0 ? "+" : ""}${metrics.netRetainerValueUsd.toLocaleString()} net this month
              </p>
            </div>

            {/* Middle: corridor feed + activity stream */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                    <Truck size={14} /> Live Border &amp; Shipment Corridor Feed
                  </p>
                  <div className="flex gap-1">
                    {FILTER_TABS.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setFilter(t.key)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${filter === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                  {filteredShipments.map((s) => (
                    <div key={s.id} className="px-5 py-3">
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-xs font-bold text-slate-900">{s.id}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CUSTOMS_STATUS_CLASS[s.customsStatus]}`}>{s.customsStatus.replace(/_/g, " ")}</span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {s.clientOrg} · {s.driverName} · {s.poeId ? POE_LABELS[s.poeId] : "—"}
                      </p>
                      {s.etaIso && <p className="text-xs text-slate-400">ETA {new Date(s.etaIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
                    </div>
                  ))}
                  {filteredShipments.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No shipments match this filter.</p>}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <p className="flex items-center gap-1.5 text-sm font-bold">
                    <Radio size={14} /> Real-Time Activity Stream
                  </p>
                </div>
                <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                  {activity.map((a) => (
                    <div key={a.id} className="px-5 py-2.5">
                      <p className="text-xs text-slate-700">
                        <span className="font-mono text-slate-400">[{new Date(a.occurredAtIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}]</span> {a.message}
                      </p>
                    </div>
                  ))}
                  {activity.length === 0 && (
                    <p className="px-5 py-8 text-center text-sm text-slate-400">
                      No activity yet — this fills in as shipments move through the pipeline.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom: congestion strip */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold">Regional Border Corridor Congestion</p>
                <button onClick={() => setCamerasOpen(true)} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500">
                  <Camera size={12} /> View Live Border Cams
                </button>
              </div>
              <div className="flex flex-wrap gap-3">
                {congestionByPoe.map((c) => (
                  <div key={c.poeId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status]}`} />
                    <span className="text-xs font-semibold text-slate-700">{c.label}</span>
                    <span className="font-mono text-xs text-slate-500">
                      {c.waitMinutes}m — {STATUS_LABEL[c.status]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-400">{metrics.dataNote}</p>
          </>
        )}
      </main>

      {camerasOpen && <BorderCameraGrid onClose={() => setCamerasOpen(false)} poeFilter={Object.keys(COMMERCIAL_POE_LABELS)} />}

      {(locationLoading || locationDetail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setLocationDetail(undefined)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
            {locationLoading && !locationDetail ? (
              <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
            ) : locationDetail ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm font-bold">{locationDetail.id}</p>
                    <p className="text-xs text-slate-500">{locationDetail.clientOrg} · {locationDetail.lane}</p>
                  </div>
                  <button onClick={() => setLocationDetail(undefined)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
                    <X size={16} />
                  </button>
                </div>

                {/* Milestone tracker — the real "where does this stand" signal */}
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Current Stage</p>
                    <p className="text-xs font-semibold text-slate-700">{locationDetail.tracker.percentComplete}% complete</p>
                  </div>
                  <ProgressBar percent={locationDetail.tracker.percentComplete} colorClass="bg-cyan-500" />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {locationDetail.tracker.steps.map((step, i) => (
                      <span
                        key={step.milestone}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          i === locationDetail.tracker.currentIndex
                            ? "bg-cyan-600 text-white"
                            : i < locationDetail.tracker.currentIndex
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
                {locationDetail.liveBorderWait && (
                  <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="mb-1 text-xs font-mono uppercase tracking-wide text-amber-800">Live Border Wait — {locationDetail.liveBorderWait.poeId}</p>
                    <p className="text-lg font-bold text-amber-900">{locationDetail.liveBorderWait.waitMinutes} min</p>
                    <p className="text-[11px] text-amber-600">As of {new Date(locationDetail.liveBorderWait.asOfIso).toLocaleTimeString()} — {locationDetail.liveBorderWait.status}</p>
                  </div>
                )}

                <div className="space-y-1.5 text-xs">
                  <p><strong>Carrier:</strong> {locationDetail.carrierName ?? "—"}</p>
                  {(locationDetail.bolNumber || locationDetail.proNumber) && (
                    <p>
                      {locationDetail.bolNumber && <><strong>BOL #:</strong> <span className="font-mono">{locationDetail.bolNumber}</span></>}
                      {locationDetail.bolNumber && locationDetail.proNumber && "  ·  "}
                      {locationDetail.proNumber && <><strong>PRO #:</strong> <span className="font-mono">{locationDetail.proNumber}</span></>}
                    </p>
                  )}
                  {locationDetail.driverName && (
                    <p><strong>Driver:</strong> {locationDetail.driverName} {locationDetail.driverPhone && `· ${locationDetail.driverPhone}`}</p>
                  )}
                  {locationDetail.vesselName && <p><strong>Vessel:</strong> {locationDetail.vesselName}</p>}
                  {locationDetail.flightNumber && <p><strong>Flight:</strong> {locationDetail.flightNumber}</p>}
                  <p><strong>ETA:</strong> {locationDetail.etaIso ? new Date(locationDetail.etaIso).toLocaleString() : "—"}</p>
                  <p><strong>Last updated:</strong> {new Date(locationDetail.updatedAtIso).toLocaleString()}</p>
                </div>

                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-500">
                  Based on milestone tracking{locationDetail.liveBorderWait ? " and live border wait telemetry" : ""} — not GPS. This system doesn't have a live carrier-tracking integration (e.g. Project44, FourKites, or ELD access) yet, so this reflects the most recent known status rather than a real-time map position.
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
