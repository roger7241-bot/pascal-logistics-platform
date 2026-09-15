// ============================================================================
// ClientCapabilitiesEditor
// The shipping-profile form the operator fills out during account
// onboarding (and edits later). What the client actually ships drives
// which portal features render for them — tariff monitoring, USMCA
// optimizer, and Section 321 panels are only shown for cross-border
// profiles; domestic-only clients get the leaner freight-management view.
// ============================================================================

import { useState, useEffect } from "react";
import { Save, Loader2, Globe2, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../config/api";
import type { ClientCapabilities } from "../lib/clientCapabilities";
import { capabilityLabel, capabilityBadgeClass } from "../lib/clientCapabilities";

interface Props {
  accountId: string;
  initial: ClientCapabilities;
  onSaved?: (next: ClientCapabilities) => void;
}

export function ClientCapabilitiesEditor({ accountId, initial, onSaved }: Props) {
  const [caps, setCaps] = useState<ClientCapabilities>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState<number | undefined>();
  const [hsInput, setHsInput] = useState((initial.trackedHsCodes ?? []).join(", "));

  useEffect(() => {
    setCaps(initial);
    setHsInput((initial.trackedHsCodes ?? []).join(", "));
  }, [accountId, initial]);

  function setFlag<K extends keyof ClientCapabilities>(key: K, value: ClientCapabilities[K]) {
    setCaps((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(undefined);
    try {
      const hsCodes = hsInput.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const payload: ClientCapabilities = { ...caps, trackedHsCodes: hsCodes };
      await api.updateAccountCapabilities(accountId, payload);
      setSavedAt(Date.now());
      onSaved?.(payload);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save capabilities.");
    } finally {
      setSaving(false);
    }
  }

  const label = capabilityLabel(caps);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe2 size={14} className="text-slate-700" />
          <p className="text-sm font-bold text-slate-900">Shipping profile</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${capabilityBadgeClass(label)}`}>{label}</span>
        </div>
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={12} /> Saved</span>
        )}
      </div>

      <p className="mb-3 text-xs text-slate-500">Determines which features render for this client. Domestic-only clients don&rsquo;t see tariff, USMCA, or border-wait panels.</p>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ToggleRow label="Ships US → Canada" checked={!!caps.shipsUSToCanada} onChange={(v) => setFlag("shipsUSToCanada", v)} />
        <ToggleRow label="Ships Canada → US" checked={!!caps.shipsCanadaToUS} onChange={(v) => setFlag("shipsCanadaToUS", v)} />
        <ToggleRow label="Domestic only (never crosses border)" checked={!!caps.shipsDomesticOnly} onChange={(v) => setFlag("shipsDomesticOnly", v)} />
        <ToggleRow label="International (ocean/air non-USMCA)" checked={!!caps.shipsInternational} onChange={(v) => setFlag("shipsInternational", v)} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
          Broker of record
          <input value={caps.brokerOfRecord ?? ""} onChange={(e) => setFlag("brokerOfRecord", e.target.value || undefined)} placeholder="e.g. A&A Customs Contract Brokers" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
        </label>
        <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
          Current freight forwarder
          <input value={caps.currentForwarder ?? ""} onChange={(e) => setFlag("currentForwarder", e.target.value || undefined)} placeholder="e.g. DB Schenker, CEVA, or None" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
        </label>
      </div>

      <label className="mb-3 block text-xs font-medium text-slate-600 uppercase tracking-wide">
        Tracked HS codes
        <textarea value={hsInput} onChange={(e) => setHsInput(e.target.value)} rows={2} placeholder="e.g. 8703.23, 7208.10, 0201.20" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none" />
        <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-slate-400">Comma-separated. Drives which tariff-change alerts this client receives.</span>
      </label>

      <label className="mb-4 block text-xs font-medium text-slate-600 uppercase tracking-wide">
        Estimated loads / month
        <select value={caps.monthlyLoadsEstimate ?? ""} onChange={(e) => setFlag("monthlyLoadsEstimate", e.target.value || undefined)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none">
          <option value="">—</option>
          <option value="fewer_than_4">Fewer than 4</option>
          <option value="4-10">4 – 10</option>
          <option value="10-20">10 – 20</option>
          <option value="20-50">20 – 50</option>
          <option value="50+">50+</option>
        </select>
      </label>

      {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        Save shipping profile
      </button>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-slate-300" />
      {label}
    </label>
  );
}
