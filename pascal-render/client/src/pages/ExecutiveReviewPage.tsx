import { useEffect, useState } from "react";
import { ShieldCheck, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface ExecutiveDraft {
  id: string;
  shipmentId: string;
  draftType: string;
  subject: string;
  body: string;
  rationale: string;
  confidenceScore?: number;
  status: string;
}

export function ExecutiveReviewPage() {
  const [drafts, setDrafts] = useState<ExecutiveDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | undefined>(undefined);

  const load = () => {
    setLoading(true);
    api
      .executiveDrafts<{ drafts: ExecutiveDraft[] }>("pending")
      .then((d) => setDrafts(d.drafts))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDecide = async (id: string, decision: "approved" | "rejected") => {
    setDeciding(id);
    try {
      await api.decideExecutiveDraft(id, decision);
      load();
    } finally {
      setDeciding(undefined);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Executive Review Drawer</h1>
          <span className="ml-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Roger Jervis Desk</span>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading pending drafts...
          </p>
        )}

        {!loading && drafts.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-500" />
            <p className="text-sm text-slate-500">No pending approvals — all shipments are either auto-dispatched or already decided.</p>
          </div>
        )}

        <div className="space-y-3">
          {drafts.map((draft) => (
            <div key={draft.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-sm font-bold text-slate-900">{draft.shipmentId}</p>
                {draft.confidenceScore !== undefined && (
                  <span className="font-mono text-xs font-semibold text-amber-700">confidence {draft.confidenceScore.toFixed(2)}</span>
                )}
              </div>
              <p className="mb-1 text-sm font-semibold text-slate-800">{draft.subject}</p>
              <p className="mb-3 text-xs text-slate-600">{draft.body}</p>
              <p className="mb-3 rounded-md bg-white/60 p-2 text-xs text-slate-500">
                <span className="font-semibold">AI rationale:</span> {draft.rationale}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDecide(draft.id, "approved")}
                  disabled={deciding === draft.id}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  <CheckCircle2 size={13} /> Approve
                </button>
                <button
                  onClick={() => handleDecide(draft.id, "rejected")}
                  disabled={deciding === draft.id}
                  className="flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                >
                  <XCircle size={13} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
