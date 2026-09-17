// ============================================================================
// OperatorInboxPage
// Roger's one-screen morning read. Merges pending drafts, gated tasks,
// recent client document uploads, cron failures, and unhandled tracking
// exceptions into a single prioritized feed. This is the operator inbox
// — everything that needs Roger's attention lives here first.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, AlertCircle, FileText, MapPin, Bot, GitBranch, AlertTriangle, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { OperatorHeader } from "../components/OperatorHeader";
import { api, ApiError } from "../config/api";

interface InboxResponse {
  pendingDrafts: {
    id: string; agent_key: string; agent_name: string | null;
    category: string | null; subject: string | null; status: string;
    created_at: string; priority: string | null; summary: string | null;
  }[];
  gatedTasks: {
    id: string; task_type: string; subject: string; current_agent_key: string;
    human_gate_reason: string | null; created_at: string; updated_at: string;
    client_org_id: string | null;
  }[];
  recentDocuments: {
    id: string; filename: string; category: string; uploaded_at: string;
    company_name: string | null; org_id: string | null;
  }[];
  cronFailures: {
    event_type: string; message: string; occurred_at: string;
    metadata: Record<string, unknown>;
  }[];
  trackingExceptions: {
    id: string; event_type: string; location: string | null; occurred_at: string;
    tracking_number: string; mode: string; reference: string | null;
    company_name: string | null;
  }[];
  counts: {
    pendingDrafts: number; gatedTasks: number; recentDocuments: number;
    cronFailures: number; trackingExceptions: number;
  };
}

const PRIORITY_CLASS: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700 border-rose-200",
  normal: "bg-slate-100 text-slate-600 border-slate-200",
  low: "bg-sky-50 text-sky-700 border-sky-200",
};

export function OperatorInboxPage() {
  const [data, setData] = useState<InboxResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const d = await api.operatorInbox<InboxResponse>();
      setData(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load inbox.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalCount = data
    ? data.counts.pendingDrafts + data.counts.gatedTasks + data.counts.recentDocuments + data.counts.cronFailures + data.counts.trackingExceptions
    : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox size={18} className="text-slate-700" />
            <h1 className="text-xl font-bold">Operator Inbox</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">
              {totalCount} item{totalCount === 1 ? "" : "s"} across your desk
            </span>
          </div>
          <button onClick={load} className="text-xs font-medium text-slate-500 hover:text-slate-700">Refresh</button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : data && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Gated tasks — highest priority */}
            <section className="rounded-xl border-2 border-rose-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-5 py-3">
                <div className="flex items-center gap-2">
                  <GitBranch size={14} className="text-rose-700" />
                  <p className="text-sm font-bold text-rose-900">Gated tasks — awaiting your review</p>
                </div>
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-rose-800">{data.counts.gatedTasks}</span>
              </div>
              {data.gatedTasks.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">Nothing gated. Clear desk.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.gatedTasks.map((t) => (
                    <li key={t.id} className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900 truncate">{t.subject}</p>
                      {t.human_gate_reason && <p className="mt-0.5 text-[11px] text-rose-700">Gate: {t.human_gate_reason}</p>}
                      <p className="mt-1 text-[10px] text-slate-500">{t.task_type.replace(/^playbook:/, "")} · {new Date(t.updated_at).toLocaleString()}</p>
                      <Link to="/operator/agents" className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline">
                        Open in AI Agents <ChevronRight size={11} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Pending drafts */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Bot size={14} className="text-slate-700" />
                  <p className="text-sm font-bold text-slate-900">Pending drafts</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-amber-800">{data.counts.pendingDrafts}</span>
              </div>
              {data.pendingDrafts.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No drafts waiting.</p>
              ) : (
                <ul className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto">
                  {data.pendingDrafts.map((d) => (
                    <li key={d.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 mb-0.5">
                        {d.priority && <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${PRIORITY_CLASS[d.priority] ?? PRIORITY_CLASS.normal}`}>{d.priority}</span>}
                        <span className="text-[10px] font-mono uppercase text-slate-500">{d.agent_name ?? d.agent_key}</span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 truncate">{d.subject ?? "(no subject)"}</p>
                      {d.summary && <p className="mt-0.5 text-[11px] italic text-slate-500 line-clamp-2">{d.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-slate-100 px-4 py-2 text-right">
                <Link to="/operator/agents" className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline">
                  Review queue <ChevronRight size={11} />
                </Link>
              </div>
            </section>

            {/* Tracking exceptions */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-700" />
                  <p className="text-sm font-bold text-slate-900">Recent shipment exceptions</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-amber-800">{data.counts.trackingExceptions}</span>
              </div>
              {data.trackingExceptions.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No exceptions in the last 48h.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.trackingExceptions.map((m) => (
                    <li key={m.id} className="flex items-start gap-2 px-4 py-2">
                      <MapPin size={12} className="mt-0.5 flex-shrink-0 text-amber-700" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900">{m.event_type.replace(/_/g, " ")} · {m.tracking_number}</p>
                        <p className="text-[10px] text-slate-500">{m.company_name ?? "unknown client"} · {m.mode} · {m.location ?? "en route"} · {new Date(m.occurred_at).toLocaleString()}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Client documents received */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-slate-700" />
                  <p className="text-sm font-bold text-slate-900">Client docs — last 7 days</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-slate-600">{data.counts.recentDocuments}</span>
              </div>
              {data.recentDocuments.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No client uploads this week.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.recentDocuments.map((d) => (
                    <li key={d.id} className="px-4 py-2">
                      <p className="truncate text-xs font-semibold text-slate-900">{d.filename}</p>
                      <p className="text-[10px] text-slate-500">{d.company_name ?? d.org_id ?? "unknown"} · {d.category.replace(/_/g, " ")} · {new Date(d.uploaded_at).toLocaleDateString()}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Cron failures — full width when present */}
            {data.cronFailures.length > 0 && (
              <section className="lg:col-span-2 rounded-xl border-2 border-rose-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="text-rose-700" />
                    <p className="text-sm font-bold text-rose-900">Cron failures — investigate</p>
                  </div>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-rose-800">{data.counts.cronFailures}</span>
                </div>
                <ul className="divide-y divide-rose-100">
                  {data.cronFailures.map((e, i) => (
                    <li key={i} className="px-4 py-2">
                      <p className="text-xs font-semibold text-rose-900">{e.event_type.replace(/^cron_failure:/, "")}</p>
                      <p className="text-[11px] text-rose-800">{e.message}</p>
                      <p className="text-[10px] text-slate-500">{new Date(e.occurred_at).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
