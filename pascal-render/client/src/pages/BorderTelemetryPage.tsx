import { useEffect, useState } from "react";
import { RefreshCw, ArrowUp, ArrowDown, Truck, CreditCard, Camera, ArrowRightLeft } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { BorderCameraGrid } from "../components/BorderCameraGrid";
import { RerouteAdvisoryPanel } from "../components/RerouteAdvisoryPanel";
import { api } from "../config/api";
import { pascalSocket, type WsEnvelope } from "../config/api";
import type { RerouteAdvisory } from "../types/reroute";

type Direction = "northbound" | "southbound";
type LaneType = "commercial" | "passenger_nexus";

interface BorderWaitReading {
  poeId: string;
  direction: Direction;
  laneType: LaneType;
  waitMinutes: number;
  status: "green" | "amber" | "red";
  observedAtIso: string;
}

interface RerouteRecommendation {
  fromPoeId: string;
  toPoeId: string;
  fromWaitMinutes: number;
  toWaitMinutes: number;
  netValueUsd: number;
  netTimeSavedMinutes: number;
}

const POE_LABELS: Record<string, string> = {
  peace_arch: "Peace Arch",
  pacific_highway: "Pacific Highway",
  aldergrove: "Aldergrove",
  sumas: "Sumas",
  point_roberts: "Point Roberts",
};

const STATUS_DOT: Record<string, string> = { green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-rose-400" };
const STATUS_TEXT: Record<string, string> = { green: "text-emerald-300", amber: "text-amber-300", red: "text-rose-300" };

export function BorderTelemetryPage() {
  const [readings, setReadings] = useState<BorderWaitReading[]>([]);
  const [triggers, setTriggers] = useState<{ direction: Direction; recommendation: RerouteRecommendation }[]>([]);
  const [loading, setLoading] = useState(true);
  const [camerasOpen, setCamerasOpen] = useState(false);
  const [liveUpdateCount, setLiveUpdateCount] = useState(0);
  const [advisories, setAdvisories] = useState<RerouteAdvisory[]>([]);
  const [requestingSignoff, setRequestingSignoff] = useState<string | undefined>();

  const loadAdvisories = () => api.rerouteAdvisories<{ advisories: RerouteAdvisory[] }>().then((d) => setAdvisories(d.advisories));

  async function handleRequestClientSignoff(recommendation: RerouteRecommendation, shipmentId: string) {
    setRequestingSignoff(recommendation.toPoeId);
    try {
      const advisory = await api.createRerouteAdvisory<RerouteAdvisory>({
        shipmentId,
        fromPoeId: recommendation.fromPoeId,
        toPoeId: recommendation.toPoeId,
        fromWaitMinutes: recommendation.fromWaitMinutes,
        toWaitMinutes: recommendation.toWaitMinutes,
        netTimeSavedMinutes: recommendation.netTimeSavedMinutes,
        netValueUsd: recommendation.netValueUsd,
      });
      setAdvisories((prev) => [advisory, ...prev]);
      // Real notification to the client that sign-off is needed — the actual
      // approve/decline action only happens on the Client Portal side.
      // (Email dispatch to the client's Logistics Manager would go here once
      // a per-org contact-of-record field exists; sign-off is still
      // reachable directly via the Client Portal in the meantime.)
    } finally {
      setRequestingSignoff(undefined);
    }
  }

  const loadSnapshot = () => {
    setLoading(true);
    api
      .borderTelemetry<{ readings: BorderWaitReading[]; triggers: { direction: Direction; recommendation: RerouteRecommendation }[] }>()
      .then((data) => {
        setReadings(data.readings ?? []);
        setTriggers(data.triggers ?? []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSnapshot();
    loadAdvisories();

    pascalSocket.connect();
    const unsubscribe = pascalSocket.subscribe((envelope: WsEnvelope) => {
      if (envelope.channel === "border_telemetry" && envelope.type === "wait_time_update") {
        setLiveUpdateCount((c) => c + 1);
      }
    });

    return () => {
      unsubscribe();
      pascalSocket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedByPoe = readings.reduce<Record<string, BorderWaitReading[]>>((acc, r) => {
    (acc[r.poeId] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Lower Mainland Border Monitor</h1>
            <p className="text-xs text-slate-500">
              {liveUpdateCount > 0 ? `${liveUpdateCount} live update(s) received over WebSocket` : "Connecting to live feed..."}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadSnapshot}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              onClick={() => setCamerasOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
            >
              <Camera size={13} /> View Live Cams
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {Object.entries(groupedByPoe).map(([poeId, poeReadings]) => (
            <div key={poeId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-sm font-semibold text-slate-900">{POE_LABELS[poeId] ?? poeId}</p>
              <div className="grid grid-cols-2 gap-4">
                {(["northbound", "southbound"] as Direction[]).map((direction) => (
                  <div key={direction}>
                    <p className="mb-1 flex items-center gap-1 text-xs text-slate-500">
                      {direction === "northbound" ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                      {direction === "northbound" ? "Northbound (CBSA)" : "Southbound (CBP)"}
                    </p>
                    {poeReadings
                      .filter((r) => r.direction === direction)
                      .map((r) => (
                        <div key={r.laneType} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1 text-slate-600">
                            {r.laneType === "commercial" ? <Truck size={10} /> : <CreditCard size={10} />}
                            {r.laneType === "commercial" ? "Commercial" : "Passenger/NEXUS"}
                          </span>
                          <span className={`flex items-center gap-1 font-mono font-semibold ${STATUS_TEXT[r.status]}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[r.status]}`} />
                            {r.waitMinutes}m
                          </span>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {triggers.map(({ direction, recommendation }) => (
          <div key={direction} className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <ArrowRightLeft size={15} className="mt-0.5 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">
                {direction} advisory — {POE_LABELS[recommendation.fromPoeId]} → {POE_LABELS[recommendation.toPoeId]}
              </p>
              <p className="text-xs text-amber-700">
                {recommendation.fromWaitMinutes}m vs {recommendation.toWaitMinutes}m — net ${recommendation.netValueUsd} value, {recommendation.netTimeSavedMinutes}m saved. Not auto-applied — requires client sign-off.
              </p>
            </div>
            <button
              onClick={() => handleRequestClientSignoff(recommendation, "SHIP-2026-8801")}
              disabled={requestingSignoff === recommendation.toPoeId}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {requestingSignoff === recommendation.toPoeId ? "Requesting…" : "Request client sign-off"}
            </button>
          </div>
        ))}

        <RerouteAdvisoryPanel advisories={advisories} onUpdated={(updated) => setAdvisories((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))} />
      </main>

      {camerasOpen && (
        <BorderCameraGrid
          onClose={() => setCamerasOpen(false)}
          onBroadcastSnapshot={(poeId, channel) => console.log(`Broadcast requested: ${poeId} via ${channel}`)}
        />
      )}
    </div>
  );
}
