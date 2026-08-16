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
    ])
      .then(([m, a, act, corridor, border]) => {
        setMetrics(m);
        setAlerts(a);
        setActivity(act.activity);
        setCorridorShipments(corridor.shipments);
        setBorderReadings(border.readings);
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
    </div>
  );
}
