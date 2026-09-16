// ============================================================================
// ClientSettingsPage
// Client-facing settings — currently the notification opt-in switches.
// The daily brief cron reads these on each run; opted-in clients get the
// draft auto-sent to their primary contact email instead of waiting for
// Roger's manual review click.
// ============================================================================

import { useEffect, useState } from "react";
import { Bell, Save, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api, ApiError } from "../config/api";

interface Prefs {
  dailyBriefEmail?: boolean;
  weeklyPackEmail?: boolean;
  exceptionAlertsEmail?: boolean;
  tariffAlertsEmail?: boolean;
  onboardingRemindersEmail?: boolean;
}

interface PrefsResponse {
  preferences: Prefs;
  branding: { companyName: string; brandColor: string | null; logoUrl: string | null };
}

const SWITCHES: { key: keyof Prefs; label: string; description: string }[] = [
  { key: "dailyBriefEmail", label: "Daily brief", description: "Every morning: overnight freight events, tariff moves affecting you, what needs your input." },
  { key: "weeklyPackEmail", label: "Weekly Executive Pack (Tier 3)", description: "Monday morning: full KPI dashboard, week-over-week trends, what to focus on." },
  { key: "exceptionAlertsEmail", label: "Exception alerts", description: "As they happen: rolled containers, customs holds, breakdowns, damage." },
  { key: "tariffAlertsEmail", label: "Tariff alerts", description: "Same day: Federal Register / CBSA changes on HS codes you import." },
  { key: "onboardingRemindersEmail", label: "Onboarding reminders", description: "Gentle nudges from your EA if a step stalls." },
];

export function ClientSettingsPage() {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      try {
        const p = await api.notificationPreferences<PrefsResponse>("client");
        setPrefs(p.preferences ?? {});
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      // Send explicit booleans — the server filters non-boolean values.
      const explicit: Record<string, boolean> = {};
      for (const s of SWITCHES) explicit[s.key] = prefs[s.key] === true;
      await api.updateNotificationPreferences("client", explicit);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">Notification preferences</h1>
        </div>
        <p className="text-sm text-slate-600">Which emails should we send to your primary contact? Unchecked items still land as drafts we review — you just don't get the email push.</p>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            <ul className="space-y-2">
              {SWITCHES.map((s) => (
                <li key={s.key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs[s.key] === true}
                      onChange={(e) => setPrefs({ ...prefs, [s.key]: e.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{s.label}</p>
                      <p className="text-[11px] text-slate-600">{s.description}</p>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-3">
              {saved && <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={12} /> Saved</span>}
              <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save preferences
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
