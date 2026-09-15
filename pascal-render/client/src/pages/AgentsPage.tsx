// ============================================================================
// AgentsPage
// Operator observability + review surface for every AI agent in the org.
// Grid at top shows all 11 agents (5 client-facing already live + 6
// back-office: Chief of Staff is live, others planned). Chief of Staff
// review inbox below shows drafts awaiting Roger's sign-off — send,
// edit, reject, archive. Includes a small "simulate an inbound email"
// tool so the flow is testable before live inbox integration.
// ============================================================================

import { useEffect, useState } from "react";
import { Cpu, Bot, CheckCircle2, XCircle, Inbox, Loader2, Send, Edit3, Archive, MessageSquarePlus, Sparkles, AlertCircle } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api, ApiError } from "../config/api";

interface AgentRow {
  agentKey: string;
  agentNumber: number;
  name: string;
  role: "Client-facing" | "Back-office";
  description: string;
  status: "active" | "planned" | "paused" | "deprecated";
  humanInLoop: boolean;
  lastRunAtIso?: string;
  lastRunStatus?: string;
  pendingDrafts: number;
}

interface DraftRow {
  id: string;
  agent_key: string;
  kind: string;
  category: string | null;
  subject: string | null;
  source_ref: string | null;
  payload: {
    inbound: { fromEmail: string; fromName?: string; subject: string; body: string };
    output: {
      category: string;
      priority: "urgent" | "normal" | "low";
      summary: string;
      suggestedActions: string[];
      draftResponseSubject: string;
      draftResponseBody: string;
      simulated: boolean;
    };
  };
  status: string;
  created_at: string;
}

const STATUS_CLASS: Record<AgentRow["status"], string> = {
  active: "bg-emerald-100 text-emerald-700",
  planned: "bg-slate-100 text-slate-500",
  paused: "bg-amber-100 text-amber-800",
  deprecated: "bg-rose-100 text-rose-700",
};

const PRIORITY_CLASS: Record<DraftRow["payload"]["output"]["priority"], string> = {
  urgent: "bg-rose-100 text-rose-700 border-rose-200",
  normal: "bg-slate-100 text-slate-600 border-slate-200",
  low: "bg-sky-50 text-sky-700 border-sky-200",
};

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [actioning, setActioning] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");

  const [simFromEmail, setSimFromEmail] = useState("prospect@example.com");
  const [simFromName, setSimFromName] = useState("Alicia Ford");
  const [simSubject, setSimSubject] = useState("Interested in Pascal Logistics — Meridian Cold Chain");
  const [simBody, setSimBody] = useState("Hi — we ship about 25 loads a month between Blaine and Surrey, and we're looking at a fractional supply-chain option. Can you tell me more about your Tier 1.5 and whether we'd be a fit?\n\nThanks,\nAlicia");
  const [simulating, setSimulating] = useState(false);

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const [a, d] = await Promise.all([
        api.agents<{ agents: AgentRow[] }>(),
        api.agentDrafts<{ drafts: DraftRow[] }>("pending"),
      ]);
      setAgents(a.agents);
      setDrafts(d.drafts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function respond(id: string, status: "approved" | "rejected" | "sent" | "archived") {
    setActioning(id);
    try {
      const patchPayload: { status: typeof status; payload?: unknown } = { status };
      if (editingId === id) {
        const draft = drafts.find((d) => d.id === id);
        if (draft) {
          patchPayload.payload = {
            ...draft.payload,
            output: { ...draft.payload.output, draftResponseSubject: editedSubject, draftResponseBody: editedBody },
          };
        }
      }
      await api.updateAgentDraft(id, patchPayload);
      setEditingId(undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update draft.");
    } finally {
      setActioning(undefined);
    }
  }

  function beginEdit(d: DraftRow) {
    setEditingId(d.id);
    setEditedSubject(d.payload.output.draftResponseSubject);
    setEditedBody(d.payload.output.draftResponseBody);
  }

  async function simulate() {
    setSimulating(true);
    try {
      await api.chiefOfStaffSimulate({ fromEmail: simFromEmail, fromName: simFromName, subject: simSubject, body: simBody });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-slate-700" />
            <h1 className="text-xl font-bold">AI Agent Registry</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">
              {agents.filter((a) => a.status === "active").length} active · {agents.filter((a) => a.status === "planned").length} planned
            </span>
          </div>
          <button onClick={load} className="text-xs font-medium text-slate-500 hover:text-slate-700">Refresh</button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Agent grid */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {loading && agents.length === 0 ? (
            <div className="col-span-full flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading agents…
            </div>
          ) : agents.map((a) => (
            <div key={a.agentKey} className={`rounded-xl border p-4 shadow-sm ${a.status === "active" ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50/50"}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.status === "active" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500"}`}>
                    <Bot size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400">Agent {a.agentNumber} · {a.role}</p>
                    <p className="text-sm font-semibold text-slate-900">{a.name}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${STATUS_CLASS[a.status]}`}>{a.status}</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{a.description}</p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                <span>{a.humanInLoop ? "Human-in-loop" : "Autonomous"}</span>
                {a.pendingDrafts > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 font-semibold">
                    <Inbox size={10} /> {a.pendingDrafts} draft{a.pendingDrafts === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>

        {/* Chief of Staff — simulate inbound (test-only) */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-slate-700" />
              <p className="text-sm font-bold text-slate-900">Simulate an inbound email (test-only)</p>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">Chief of Staff · Agent 6</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-5">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">From email
              <input value={simFromEmail} onChange={(e) => setSimFromEmail(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
            </label>
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">From name
              <input value={simFromName} onChange={(e) => setSimFromName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
            </label>
            <label className="col-span-2 text-xs font-medium text-slate-600 uppercase tracking-wide">Subject
              <input value={simSubject} onChange={(e) => setSimSubject(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
            </label>
            <label className="col-span-2 text-xs font-medium text-slate-600 uppercase tracking-wide">Body
              <textarea value={simBody} onChange={(e) => setSimBody(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
            </label>
            <div className="col-span-2 flex justify-end">
              <button onClick={simulate} disabled={simulating} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                {simulating ? <Loader2 size={12} className="animate-spin" /> : <MessageSquarePlus size={12} />}
                Categorize + draft response
              </button>
            </div>
          </div>
        </section>

        {/* Draft review queue */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Inbox size={14} className="text-slate-700" />
              <p className="text-sm font-bold text-slate-900">Draft review queue</p>
              {drafts.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-amber-800">{drafts.length} pending</span>}
            </div>
          </div>
          {drafts.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-500">No drafts waiting on your review.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {drafts.map((d) => (
                <div key={d.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide ${PRIORITY_CLASS[d.payload.output.priority]}`}>{d.payload.output.priority}</span>
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">{d.category?.replace(/_/g, " ") ?? "—"}</span>
                        {d.payload.output.simulated && <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-mono text-violet-700">simulated</span>}
                        <span className="text-[11px] text-slate-500">from {d.payload.inbound.fromName ? `${d.payload.inbound.fromName} <${d.payload.inbound.fromEmail}>` : d.payload.inbound.fromEmail}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{d.payload.inbound.subject}</p>
                      <p className="mt-1 text-[11px] text-slate-500 italic">Agent 6 summary: {d.payload.output.summary}</p>
                      {d.payload.output.suggestedActions.length > 0 && (
                        <ul className="mt-1 list-disc list-inside text-[11px] text-slate-600 space-y-0.5">
                          {d.payload.output.suggestedActions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500 mb-2">Draft response</p>
                    {editingId === d.id ? (
                      <>
                        <input value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} className="mb-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" placeholder="Subject" />
                        <textarea value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={6} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" placeholder="Body" />
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-slate-800 mb-1">{d.payload.output.draftResponseSubject}</p>
                        <pre className="whitespace-pre-wrap text-xs text-slate-700 font-sans leading-relaxed">{d.payload.output.draftResponseBody}</pre>
                      </>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {editingId === d.id ? (
                      <button onClick={() => setEditingId(undefined)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel edit</button>
                    ) : (
                      <button onClick={() => beginEdit(d)} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        <Edit3 size={12} /> Edit
                      </button>
                    )}
                    <button onClick={() => respond(d.id, "archived")} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                      <Archive size={12} /> Archive
                    </button>
                    <button onClick={() => respond(d.id, "rejected")} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                      <XCircle size={12} /> Reject
                    </button>
                    <button onClick={() => respond(d.id, "sent")} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                      {actioning === d.id ? <Loader2 size={12} className="animate-spin" /> : editingId === d.id ? <><Send size={12} /> Send edited</> : <><CheckCircle2 size={12} /> Send as drafted</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
