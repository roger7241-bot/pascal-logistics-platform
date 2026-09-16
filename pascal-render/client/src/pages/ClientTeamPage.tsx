// ============================================================================
// ClientTeamPage
// Multi-user access management. Owner invites teammates with role
// (owner / ops / finance / viewer). Pending invites listed with revoke.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Users, Plus, Loader2, AlertCircle, X, Mail, Shield, CheckCircle2, Clock } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

interface AccountUser {
  id: string;
  email: string;
  display_name: string | null;
  client_sub_role: string | null;
  invited_by: string | null;
  accepted_at: string | null;
  last_login_at: string | null;
  created_at: string;
  has_google_sso: boolean;
}
interface PendingInvite {
  id: string;
  invited_email: string;
  invited_sub_role: string;
  invited_by: string;
  invited_at: string;
  expires_at: string;
  status: string;
}
interface Response {
  users: AccountUser[];
  pendingInvites: PendingInvite[];
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Full access. Only owner can invite / remove teammates.",
  ops: "Operational access. Can upload docs, view shipments, respond to WISMO.",
  finance: "Finance-only. Invoices, payments, notification prefs.",
  viewer: "Read-only. Dashboards + activity, no changes.",
};

export function ClientTeamPage() {
  const [data, setData] = useState<Response | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.accountUsers<Response>("client");
      setData(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load team.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function invite() {
    if (!inviteEmail.trim()) return;
    setSending(true);
    setError(undefined);
    try {
      await api.inviteAccountUser("client", { email: inviteEmail.trim(), subRole: inviteRole });
      setModalOpen(false);
      setInviteEmail("");
      setInviteRole("viewer");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invite failed.");
    } finally {
      setSending(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeAccountInvite("client", id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Revoke failed.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-slate-700" />
            <h1 className="text-xl font-bold">Team access</h1>
          </div>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
            <Plus size={12} /> Invite teammate
          </button>
        </div>
        <p className="text-sm text-slate-600">Invite your warehouse manager, receiving clerk, CFO, or anyone else who should see this portal. Each teammate gets their own login with the role you assign.</p>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : data && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3">
                <p className="text-sm font-bold text-slate-900">Active teammates</p>
                <p className="text-[11px] text-slate-500">{data.users.length} on your team</p>
              </div>
              {data.users.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No teammates yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-900 truncate">{u.display_name ?? u.email}</p>
                          {u.has_google_sso && <span className="rounded bg-blue-100 px-1 py-0.5 text-[9px] text-blue-800">SSO</span>}
                        </div>
                        <p className="text-[10px] text-slate-500 truncate">{u.email}</p>
                        {u.last_login_at && <p className="text-[10px] text-slate-400">Last login {new Date(u.last_login_at).toLocaleDateString()}</p>}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-600">
                          <Shield size={10} className="inline -mt-0.5 mr-1" />
                          {u.client_sub_role ?? "unset"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.pendingInvites.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm">
                <div className="border-b border-amber-100 px-5 py-3">
                  <p className="text-sm font-bold text-slate-900">Pending invites</p>
                </div>
                <ul className="divide-y divide-amber-100">
                  {data.pendingInvites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Mail size={12} className="text-slate-500" />
                          <p className="text-xs font-semibold text-slate-900 truncate">{i.invited_email}</p>
                          <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-600">{i.invited_sub_role}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Clock size={10} /> Sent {new Date(i.invited_at).toLocaleDateString()} · expires {new Date(i.expires_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button onClick={() => revoke(i.id)} className="text-[11px] text-rose-600 hover:text-rose-700">Revoke</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Role explainer */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Roles</p>
              <ul className="space-y-1 text-[11px] text-slate-700">
                {Object.entries(ROLE_DESCRIPTIONS).map(([role, desc]) => (
                  <li key={role} className="flex items-start gap-2">
                    <CheckCircle2 size={11} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                    <span><span className="font-semibold uppercase">{role}</span> — {desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
            <div className="w-full max-w-md rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-bold">Invite teammate</p>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
              </div>
              <div className="space-y-2">
                <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  {Object.entries(ROLE_DESCRIPTIONS).map(([r]) => (<option key={r} value={r}>{r}</option>))}
                </select>
                <p className="text-[11px] text-slate-500">{ROLE_DESCRIPTIONS[inviteRole]}</p>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setModalOpen(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">Cancel</button>
                  <button onClick={invite} disabled={!inviteEmail.trim() || sending} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                    {sending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                    Send invite
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
