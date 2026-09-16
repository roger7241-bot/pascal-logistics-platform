// ============================================================================
// ClientActivityPage
// "What Pascal has done for you." Client-facing activity timeline — the
// answer to the question every retainer client asks: "what am I paying for?"
//
// NEVER names internal agents. Translates task_type + task status into
// plain-English descriptions. Sent briefs, tasks worked, exceptions
// handled, documents received. Grouped by category, filterable by window.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, AlertCircle, CheckCircle2, FileText, MapPin, Mail, AlertTriangle } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

interface ActivityResponse {
  days: number;
  tasksCompleted: number;
  totalTasks: number;
  briefsSent: number;
  documentsUploaded: number;
  milestonesReceived: number;
  exceptionsHandled: number;
  tasks: {
    id: string; task_type: string; subject: string; status: string;
    created_at: string; updated_at: string;
  }[];
  briefsSentList: {
    id: string; category: string; subject: string;
    reviewed_at: string; summary: string | null;
  }[];
  documents: {
    id: string; filename: string; category: string; uploaded_at: string;
  }[];
  milestones: {
    id: string; event_type: string; location: string | null;
    occurred_at: string; is_exception: boolean;
    tracking_number: string; mode: string; reference: string | null;
  }[];
}

// Translate internal task_type → client-friendly label. Never leak agent keys.
function taskLabel(taskType: string): string {
  const map: Record<string, string> = {
    "playbook:usmca_missing": "Prevented duty overpayment on a missing USMCA cert",
    "playbook:rate_spike": "Investigated a carrier rate spike on your behalf",
    "playbook:transit_exception": "Managed an in-transit shipment exception",
    "playbook:tariff_change_affecting_client": "Analyzed a tariff change affecting your goods",
    "playbook:past_due_escalation": "Followed up on outstanding invoice",
    "playbook:new_client_onboarding": "Set up your onboarding sequence",
    "playbook:inbound_prospect_intro": "Handled inbound inquiry",
    "usmca_missing_alert": "Flagged missing USMCA cert",
  };
  return map[taskType] ?? taskType.replace(/^playbook:/, "").replace(/_/g, " ");
}

export function ClientActivityPage() {
  const [data, setData] = useState<ActivityResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const d = await api.clientActivity<ActivityResponse>(days);
      setData(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load activity.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-slate-700" />
            <h1 className="text-xl font-bold">What we've done for you</h1>
          </div>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        <p className="text-sm text-slate-600">A rolling summary of what Pascal has been doing behind the scenes. Every task counts.</p>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : data && (
          <>
            {/* Summary tiles */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                { label: "Tasks completed", val: data.tasksCompleted, icon: CheckCircle2 },
                { label: "Tasks in progress", val: data.totalTasks - data.tasksCompleted, icon: Loader2 },
                { label: "Briefs sent", val: data.briefsSent, icon: Mail },
                { label: "Milestones logged", val: data.milestonesReceived, icon: MapPin },
                { label: "Exceptions handled", val: data.exceptionsHandled, icon: AlertTriangle },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <div key={t.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <Icon size={14} className="text-slate-500 mb-1" />
                    <p className="text-2xl font-bold text-slate-900">{t.val}</p>
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">{t.label}</p>
                  </div>
                );
              })}
            </section>

            {/* Tasks — the main content */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3">
                <p className="text-sm font-bold text-slate-900">Work we did</p>
                <p className="text-[11px] text-slate-500">Every task we ran on your behalf.</p>
              </div>
              {data.tasks.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">Nothing yet in this window.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.tasks.map((t) => (
                    <li key={t.id} className="px-5 py-3">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 flex-shrink-0">
                          {t.status === "completed" ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Loader2 size={14} className="text-cyan-600" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-900">{taskLabel(t.task_type)}</p>
                          <p className="mt-0.5 text-[11px] text-slate-600">{t.subject}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500">{t.status.replace(/_/g, " ")} · {new Date(t.updated_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Briefs sent */}
            {data.briefsSentList.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-3">
                  <p className="text-sm font-bold text-slate-900">Communications sent</p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {data.briefsSentList.map((b) => (
                    <li key={b.id} className="flex items-start gap-2 px-5 py-3">
                      <Mail size={12} className="mt-0.5 flex-shrink-0 text-slate-500" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">{b.subject}</p>
                        <p className="text-[10px] text-slate-500">{b.category.replace(/_/g, " ")} · {new Date(b.reviewed_at).toLocaleDateString()}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Documents received */}
            {data.documents.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-3">
                  <p className="text-sm font-bold text-slate-900">Documents we received from you</p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {data.documents.map((d) => (
                    <li key={d.id} className="flex items-start gap-2 px-5 py-3">
                      <FileText size={12} className="mt-0.5 flex-shrink-0 text-slate-500" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">{d.filename}</p>
                        <p className="text-[10px] text-slate-500">{d.category.replace(/_/g, " ")} · {new Date(d.uploaded_at).toLocaleDateString()}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
