// ============================================================================
// OperatorProspectsPage
// Six-stage kanban board for the prospect pipeline. Marketing produces cold
// email drafts against these rows; EA schedules intro calls off replied
// prospects; when signed, one click converts to an account.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus, Loader2, AlertCircle, X, ChevronDown } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api, ApiError } from "../config/api";

interface Prospect {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_role: string | null;
  industry: string | null;
  freight_volume_monthly: number | null;
  current_3pl_or_broker: string | null;
  pain_signal: string | null;
  source: string | null;
  stage: string;
  next_action: string | null;
  next_action_at: string | null;
  notes: string | null;
  updated_at: string;
}

interface BoardResponse {
  prospects: Prospect[];
  board: Record<string, Prospect[]>;
}

const STAGES: { key: string; label: string; color: string }[] = [
  { key: "contacted",       label: "Contacted",       color: "border-slate-300 bg-slate-50" },
  { key: "replied",         label: "Replied",         color: "border-cyan-300 bg-cyan-50" },
  { key: "meeting_booked",  label: "Meeting booked",  color: "border-blue-300 bg-blue-50" },
  { key: "proposal_sent",   label: "Proposal sent",   color: "border-violet-300 bg-violet-50" },
  { key: "signed",          label: "Signed",          color: "border-emerald-300 bg-emerald-50" },
  { key: "lost",            label: "Lost",            color: "border-rose-200 bg-rose-50" },
];

export function OperatorProspectsPage() {
  const [board, setBoard] = useState<Record<string, Prospect[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    companyName: "", contactName: "", contactEmail: "", contactRole: "",
    industry: "", freightVolumeMonthly: "", current3plOrBroker: "",
    painSignal: "", source: "", stage: "contacted", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const b = await api.prospects<BoardResponse>();
      setBoard(b.board);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load prospects.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createProspect() {
    if (!form.companyName.trim()) return;
    setCreating(true);
    setError(undefined);
    try {
      await api.createProspect({
        companyName: form.companyName,
        contactName: form.contactName || undefined,
        contactEmail: form.contactEmail || undefined,
        contactRole: form.contactRole || undefined,
        industry: form.industry || undefined,
        freightVolumeMonthly: form.freightVolumeMonthly ? Number(form.freightVolumeMonthly) : undefined,
        current3plOrBroker: form.current3plOrBroker || undefined,
        painSignal: form.painSignal || undefined,
        source: form.source || undefined,
        stage: form.stage,
        notes: form.notes || undefined,
      });
      setModalOpen(false);
      setForm({ companyName: "", contactName: "", contactEmail: "", contactRole: "", industry: "", freightVolumeMonthly: "", current3plOrBroker: "", painSignal: "", source: "", stage: "contacted", notes: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create prospect.");
    } finally {
      setCreating(false);
    }
  }

  async function moveStage(id: string, newStage: string) {
    try {
      await api.updateProspect(id, { stage: newStage });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Move failed.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <OperatorHeader />
      <main className="mx-auto max-w-[1600px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-slate-700" />
            <h1 className="text-xl font-bold">Prospect pipeline</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">
              {Object.values(board).reduce((sum, arr) => sum + arr.length, 0)} total
            </span>
          </div>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
            <Plus size={12} /> Add prospect
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {STAGES.map((s) => {
              const items = board[s.key] ?? [];
              return (
                <section key={s.key} className={`rounded-lg border-2 ${s.color} p-2`}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-800">{s.label}</p>
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-mono text-slate-600">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.length === 0 ? (
                      <p className="py-6 text-center text-[10px] text-slate-400">—</p>
                    ) : items.map((p) => (
                      <div key={p.id} className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
                        <p className="text-xs font-semibold text-slate-900 truncate">{p.company_name}</p>
                        {p.contact_name && <p className="text-[10px] text-slate-600 truncate">{p.contact_name}{p.contact_role ? ` · ${p.contact_role}` : ""}</p>}
                        {p.freight_volume_monthly && <p className="text-[10px] text-slate-500">{p.freight_volume_monthly} loads/mo</p>}
                        {p.pain_signal && <p className="mt-1 text-[10px] italic text-slate-600 line-clamp-2">{p.pain_signal}</p>}
                        <select
                          value={p.stage}
                          onChange={(e) => moveStage(p.id, e.target.value)}
                          className="mt-1.5 w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px]"
                        >
                          {STAGES.map((st) => (<option key={st.key} value={st.key}>Move → {st.label}</option>))}
                        </select>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* Modal */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
            <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-bold">Add prospect</p>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
              </div>
              <div className="space-y-2">
                <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Company name *" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Contact name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={form.contactRole} onChange={(e) => setForm({ ...form, contactRole: e.target.value })} placeholder="Contact role" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Contact email" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Industry" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={form.freightVolumeMonthly} onChange={(e) => setForm({ ...form, freightVolumeMonthly: e.target.value })} placeholder="Loads/month" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <input value={form.current3plOrBroker} onChange={(e) => setForm({ ...form, current3plOrBroker: e.target.value })} placeholder="Current 3PL / broker" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={form.painSignal} onChange={(e) => setForm({ ...form, painSignal: e.target.value })} placeholder="Pain signal (what triggered outreach)" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Source (LinkedIn, referral, etc)" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  {STAGES.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
                </select>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Notes" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setModalOpen(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">Cancel</button>
                  <button onClick={createProspect} disabled={!form.companyName.trim() || creating} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                    {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
