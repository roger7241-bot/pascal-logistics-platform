// ============================================================================
// AcceptInvitePage
// Public page. Reached from Sprint 4's invite email link
// (/accept-invite?token=…). Shows who invited them, has them pick a
// password, and creates the users row with the correct sub_role.
// ============================================================================

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Compass, Loader2, AlertCircle, CheckCircle2, Users } from "lucide-react";

interface InvitePreview {
  companyName: string | null;
  invitedEmail: string;
  invitedSubRole: string;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [preview, setPreview] = useState<InvitePreview | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("No invite token in the link. Ask for a fresh invite.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/public/invites/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Invite lookup failed.");
        } else {
          setPreview(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function accept() {
    if (password.length < 10) {
      setError("Password needs to be at least 10 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setAccepting(true);
    setError(undefined);
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, displayName: displayName || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Accept failed.");
      } else {
        setAccepted(true);
        setTimeout(() => navigate("/login"), 2500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-6 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
            <Compass size={18} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">Pascal Logistics</p>
            <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Accept invitation</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Verifying invite…</div>
        ) : accepted ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-600" />
            <p className="text-lg font-bold text-emerald-900">You're in.</p>
            <p className="mt-1 text-sm text-emerald-800">Redirecting to the login page…</p>
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 flex items-start gap-2 text-sm text-rose-800">
            <AlertCircle size={16} className="mt-0.5" />
            <div>
              <p className="font-semibold">Couldn't verify this invite.</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-xs">Reach out to whoever invited you — they can send a fresh link.</p>
            </div>
          </div>
        ) : preview && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <Users size={18} className="mt-0.5 text-slate-700" />
              <div>
                <p className="text-lg font-bold text-slate-900">You've been invited</p>
                <p className="mt-1 text-sm text-slate-600">
                  {preview.invitedBy} added you to <span className="font-semibold">{preview.companyName ?? "their Pascal Logistics account"}</span> as <span className="font-semibold uppercase">{preview.invitedSubRole}</span>.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Signing up as {preview.invitedEmail} · expires {new Date(preview.expiresAt).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block">
                <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Your name (optional)</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="First Last" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Password (10+ characters)</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Confirm password</span>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <button onClick={accept} disabled={accepting} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                {accepting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Accept & set password
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
