import { useState } from "react";
import { Camera, ExternalLink, Smartphone, MessageCircle, X } from "lucide-react";

// HONEST LIMITATION: WSDOT and DriveBC both publish live camera imagery,
// but their still-image endpoints require authenticated API access this
// environment doesn't have — embedding guessed image URLs would just show
// broken images. What's real here: the highway names, the crossing
// geography (Peace Arch has no commercial lane — traffic is I-5/Hwy 99;
// Pacific Highway is BC Hwy 15/WA SR 543, carrying the actual truck
// traffic), and verified deep-links to WSDOT's real camera viewer pages.
// Coverage is marked honestly where no verified page exists rather than
// invented.
interface CameraSource {
  label: string;
  approach: string;
  url?: string; // omitted when no verified public camera page exists
}

interface PoeCameraInfo {
  poeId: string;
  label: string;
  sources: CameraSource[];
}

const POE_CAMERAS: PoeCameraInfo[] = [
  {
    poeId: "pacific_highway",
    label: "Pacific Highway",
    sources: [
      { label: "WSDOT — I-5 near Blaine", approach: "I-5 Northbound approach", url: "https://wsdot.com/travel/real-time/cameras/road/005/Blaine" },
      { label: "DriveBC — Hwy 15 Surrey", approach: "BC Hwy 15 southbound approach", url: "https://www.drivebc.ca" },
    ],
  },
  {
    poeId: "peace_arch",
    label: "Peace Arch",
    sources: [
      { label: "WSDOT — I-5 Bellingham to Blaine", approach: "I-5 Northbound approach (passenger/NEXUS only — no commercial lane)", url: "https://wsdot.com/travel/real-time/cameras/road/005/Bellingham/Blaine" },
      { label: "DriveBC — Hwy 99 Surrey", approach: "BC Hwy 99 southbound approach" },
    ],
  },
  {
    poeId: "aldergrove",
    label: "Aldergrove",
    sources: [
      { label: "WSDOT — Whatcom County cameras", approach: "SR 539 corridor toward Lynden (no verified camera page for this specific crossing)" },
      { label: "DriveBC — Hwy 13 Langley", approach: "BC Hwy 13 southbound approach" },
    ],
  },
  {
    poeId: "sumas",
    label: "Sumas",
    sources: [
      { label: "WSDOT — I-5 Bellingham to Blaine corridor", approach: "Nearest verified WSDOT coverage (SR 9 direct camera not confirmed)", url: "https://wsdot.com/travel/real-time/cameras/road/005/Bellingham/Blaine" },
      { label: "DriveBC — Hwy 11 Abbotsford", approach: "BC Hwy 11 southbound approach" },
    ],
  },
  {
    poeId: "point_roberts",
    label: "Point Roberts",
    sources: [{ label: "No verified camera coverage", approach: "Remote crossing — neither WSDOT nor DriveBC publish a confirmed camera page for this route" }],
  },
];

export interface BorderCameraGridProps {
  onClose: () => void;
  onBroadcastSnapshot?: (poeId: string, channel: "sms" | "whatsapp") => void;
  /** Optional — limits the grid to specific crossings (e.g. the 3 commercial freight ports from the CEO Hub's congestion strip). Shows all 5 when omitted. */
  poeFilter?: string[];
}

export function BorderCameraGrid({ onClose, onBroadcastSnapshot, poeFilter }: BorderCameraGridProps) {
  const [broadcastSent, setBroadcastSent] = useState<Record<string, boolean>>({});
  const visiblePoes = poeFilter ? POE_CAMERAS.filter((poe) => poeFilter.includes(poe.poeId)) : POE_CAMERAS;

  const handleBroadcast = (poeId: string, channel: "sms" | "whatsapp") => {
    setBroadcastSent((prev) => ({ ...prev, [poeId]: true }));
    onBroadcastSnapshot?.(poeId, channel);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-cyan-400" />
            <p className="text-sm font-bold text-slate-50">Live Border Camera Grid</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-900 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          {visiblePoes.map((poe) => (
            <div key={poe.poeId} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="mb-2 text-sm font-semibold text-slate-100">{poe.label}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {poe.sources.map((source) => (
                  <div key={source.label} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                    <p className="mb-1 text-xs font-semibold text-slate-200">{source.label}</p>
                    <p className="mb-2 text-xs text-slate-500">{source.approach}</p>
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300"
                      >
                        <ExternalLink size={11} /> Open live camera
                      </a>
                    ) : (
                      <span className="text-xs text-slate-600">No verified live feed available</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleBroadcast(poe.poeId, "sms")}
                  disabled={broadcastSent[poe.poeId]}
                  className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Smartphone size={12} /> {broadcastSent[poe.poeId] ? "Sent" : "Broadcast snapshot & reroute (SMS)"}
                </button>
                <button
                  onClick={() => handleBroadcast(poe.poeId, "whatsapp")}
                  disabled={broadcastSent[poe.poeId]}
                  className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <MessageCircle size={12} /> WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
