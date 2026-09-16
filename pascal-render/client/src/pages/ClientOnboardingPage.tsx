// ============================================================================
// ClientOnboardingPage
// Guided day-1 experience — client sees exactly where they are in the
// onboarding checklist Roger's team is running behind the scenes. Read-only
// for the client (operators mark completion on their end). Progress bar +
// per-step status + notes if any.
// ============================================================================

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, AlertCircle, Clock, Ban, MinusCircle } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

interface Step {
  step_key: string;
  step_label: string;
  status: "pending" | "in_progress" | "completed" | "blocked" | "not_applicable";
  notes: string | null;
  completed_at: string | null;
  ordered_position: number;
}

interface OnboardingResponse {
  orgId: string;
  steps: Step[];
  completedCount: number;
  totalCount: number;
  progressPct: number;
}

function statusIcon(status: Step["status"]) {
  if (status === "completed") return <CheckCircle2 size={16} className="text-emerald-600" />;
  if (status === "in_progress") return <Loader2 size={16} className="animate-spin text-cyan-600" />;
  if (status === "blocked") return <Ban size={16} className="text-rose-600" />;
  if (status === "not_applicable") return <MinusCircle size={16} className="text-slate-400" />;
  return <Circle size={16} className="text-slate-300" />;
}

const STATUS_LABEL: Record<Step["status"], string> = {
  pending: "Waiting on us or you",
  in_progress: "In progress",
  completed: "Done",
  blocked: "Blocked — we'll reach out",
  not_applicable: "Not applicable",
};

export function ClientOnboardingPage() {
  const [data, setData] = useState<OnboardingResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      try {
        const d = await api.onboardingStatus<OnboardingResponse>("client");
        setData(d);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load onboarding status.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">Getting you set up</h1>
        </div>
        <p className="text-sm text-slate-600">Your onboarding checklist. We're running it in the background — POA and W9 usually take the longest because they need signatures from your side. Reach out on <a className="text-cyan-700 hover:underline" href="mailto:operations@pascallogistics.com">operations@pascallogistics.com</a> if anything blocks progress.</p>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : data && (
          <>
            {/* Progress bar */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Progress</p>
                <p className="text-sm font-semibold text-slate-900">{data.completedCount} of {data.totalCount} complete · {data.progressPct}%</p>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${data.progressPct}%` }} />
              </div>
            </div>

            {/* Steps */}
            <ol className="space-y-2">
              {data.steps.map((s) => (
                <li key={s.step_key} className={`flex items-start gap-3 rounded-lg border p-3 shadow-sm ${s.status === "completed" ? "border-emerald-200 bg-emerald-50/40" : s.status === "blocked" ? "border-rose-200 bg-rose-50/40" : "border-slate-200 bg-white"}`}>
                  <div className="mt-0.5 flex-shrink-0">{statusIcon(s.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={`text-sm font-medium ${s.status === "completed" ? "text-slate-500 line-through" : "text-slate-900"}`}>{s.step_label}</p>
                      <span className="text-[11px] text-slate-500">{STATUS_LABEL[s.status]}</span>
                    </div>
                    {s.notes && <p className="mt-1 text-[11px] italic text-slate-600">{s.notes}</p>}
                    {s.completed_at && <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700"><Clock size={10} /> Done {new Date(s.completed_at).toLocaleDateString()}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
