import { useState } from "react";
import { ArrowRightLeft, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../config/api";
import type { RerouteAdvisory } from "../types/reroute";

const POE_LABELS: Record<string, string> = {
  peace_arch: "Peace Arch",
  pacific_highway: "Pacific Highway",
  aldergrove: "Aldergrove",
  sumas: "Sumas",
  point_roberts: "Point Roberts",
};

export interface ClientRerouteSignoffCardProps {
  advisory: RerouteAdvisory;
  onDecided: (advisory: RerouteAdvisory) => void;
}

/** The ONLY place a reroute advisory can actually be approved — by design,
 * this never renders in the Operator Control Tower. Requires a named
 * Client Logistics Manager; there is no anonymous or operator-issued
 * sign-off path. */
export function ClientRerouteSignoffCard({ advisory, onDecided }: ClientRerouteSignoffCardProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "decline" | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function handleDecision(approved: boolean) {
    if (!name.trim()) {
      setError("Enter your name to sign off — this cannot be submitted anonymously.");
      return;
    }
    setSubmitting(approved ? "approve" : "decline");
    setError(undefined);
    try {
      const result = await api.rerouteClientSignoff<{ advisory: RerouteAdvisory } | RerouteAdvisory>(advisory.id, { approved, clientSignoffName: name });
      onDecided("advisory" in result ? result.advisory : result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit sign-off.");
    } finally {
      setSubmitting(undefined);
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <ArrowRightLeft size={15} className="text-amber-600" />
        <p className="text-sm font-bold text-amber-900">Reroute Advisory — Sign-off Required</p>
      </div>
      <p className="mb-1 text-sm text-amber-800">
        Shipment {advisory.shipmentId}: {POE_LABELS[advisory.fromPoeId]} → {POE_LABELS[advisory.toPoeId]}
      </p>
      <p className="mb-3 text-xs text-amber-700">
        Current wait {advisory.fromWaitMinutes}min vs {advisory.toWaitMinutes}min at the alternate ({advisory.deltaMinutes}min faster) — net {advisory.netTimeSavedMinutes}min saved, ${advisory.netValueUsd} value.
        Pascal Logistics will not reroute this shipment without your approval.
      </p>

      {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (Logistics Manager)"
          className="flex-1 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs"
        />
        <button
          onClick={() => handleDecision(true)}
          disabled={!!submitting}
          className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          <CheckCircle2 size={12} /> {submitting === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => handleDecision(false)}
          disabled={!!submitting}
          className="flex items-center gap-1 rounded-md border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          <XCircle size={12} /> {submitting === "decline" ? "Declining…" : "Decline"}
        </button>
      </div>
    </div>
  );
}
