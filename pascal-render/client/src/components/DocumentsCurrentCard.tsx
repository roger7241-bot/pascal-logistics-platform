// ============================================================================
// DocumentsCurrentCard
// Rolls up the compliance state a supply-chain manager would monitor
// weekly: POA status, USMCA certificate count, and any docs expiring
// in the next 30 days. Signals the desk is watching so the client
// doesn't have to. Should be shown for cross-border clients (parent
// component gates on isCrossBorder(caps)) — POA / USMCA aren't
// relevant for domestic-only shippers.
// ============================================================================

import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "../config/api";

interface Summary {
  documentsCurrent?: {
    poaStatus?: string;
    poaRefreshedAt?: string | null;
    usmcaCertCount?: number;
    usmcaNextExpiry?: string | null;
    expiringSoonCount?: number;
  };
}

const POA_LABEL: Record<string, { label: string; ok: boolean }> = {
  active_in_ace_aci: { label: "Active in ACE / ACI", ok: true },
  uploaded_pending_broker_review: { label: "Pending broker review", ok: false },
  pending_upload: { label: "Awaiting upload", ok: false },
  expired_needs_renewal: { label: "Expired — needs renewal", ok: false },
};

export function DocumentsCurrentCard() {
  const [state, setState] = useState<Summary["documentsCurrent"] | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.clientPortalSummary<Summary>();
        if (cancelled) return;
        setState(result.documentsCurrent);
      } catch {
        // Non-fatal — card shows a placeholder if the fetch fails.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const poa = state?.poaStatus ? POA_LABEL[state.poaStatus] ?? { label: state.poaStatus, ok: false } : undefined;
  const expiringSoon = state?.expiringSoonCount ?? 0;
  const allOk = poa?.ok && expiringSoon === 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={14} className={allOk ? "text-emerald-600" : "text-slate-700"} />
        <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Documents current</p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          <p className={`text-lg font-semibold leading-tight ${allOk ? "text-emerald-700" : "text-slate-900"}`}>
            {allOk ? "All clear" : expiringSoon > 0 ? `${expiringSoon} expiring` : poa?.label ?? "—"}
          </p>
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
            {poa && <p><span className="font-mono">POA</span> · {poa.label}</p>}
            {state?.usmcaCertCount !== undefined && <p><span className="font-mono">USMCA</span> · {state.usmcaCertCount} on file</p>}
            {expiringSoon > 0 && (
              <p className="inline-flex items-center gap-1 text-amber-700">
                <AlertTriangle size={10} /> {expiringSoon} doc{expiringSoon === 1 ? "" : "s"} expire within 30 days
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
