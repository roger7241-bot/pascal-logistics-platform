// ============================================================================
// CurrentCarrierRates
// CRM-side table + form for managing incumbent carrier rates on file for
// a given client (org_id). Drop into a client detail page or CRM account
// drawer. Real backend calls — no mock rows. Adding a rate does not
// overwrite prior rates on the same lane; the newest effective_date wins
// during quote comparisons, so you can keep rate history rather than
// blowing it away every time a contract renews.
// ============================================================================

import { useEffect, useState } from "react";
import { DollarSign, Plus, Trash2, AlertCircle, Loader2 } from "lucide-react";
import { api, ApiError } from "../config/api";

interface ClientCarrierRate {
  id: string;
  orgId: string;
  originZip: string;
  destinationZip: string;
  carrierName: string;
  serviceLevel?: string;
  transitDays?: number;
  totalRateUsd: number;
  rateSource: string;
  effectiveDateIso?: string;
  notes?: string;
  updatedAtIso?: string;
}

interface Props {
  orgId: string;
  title?: string;
}

const RATE_SOURCES = ["manual", "contract", "last invoice", "extracted from PDF"];

export function CurrentCarrierRates({ orgId, title = "Current carrier rates on file" }: Props) {
  const [rates, setRates] = useState<ClientCarrierRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const [showAdd, setShowAdd] = useState(false);
  const [originZip, setOriginZip] = useState("");
  const [destinationZip, setDestinationZip] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [serviceLevel, setServiceLevel] = useState("Standard LTL");
  const [transitDays, setTransitDays] = useState("");
  const [totalRateUsd, setTotalRateUsd] = useState("");
  const [rateSource, setRateSource] = useState("manual");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadRates() {
    setLoading(true);
    setError(undefined);
    try {
      const result = await api.clientCarrierRates<{ rates: ClientCarrierRate[] }>(orgId);
      setRates(result.rates);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load rates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRates();
  }, [orgId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!originZip || !destinationZip || !carrierName || !totalRateUsd) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.createClientCarrierRate({
        orgId,
        originZip: originZip.trim(),
        destinationZip: destinationZip.trim(),
        carrierName: carrierName.trim(),
        serviceLevel: serviceLevel.trim() || undefined,
        transitDays: transitDays ? Number(transitDays) : undefined,
        totalRateUsd: Number(totalRateUsd),
        rateSource,
        effectiveDate,
        notes: notes.trim() || undefined,
      });
      setOriginZip("");
      setDestinationZip("");
      setCarrierName("");
      setTransitDays("");
      setTotalRateUsd("");
      setNotes("");
      setShowAdd(false);
      await loadRates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save rate.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rate? This is permanent.")) return;
    try {
      await api.deleteClientCarrierRate(id);
      setRates((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete rate.");
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" />
          {showAdd ? "Cancel" : "Add rate"}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="mb-5 p-4 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Origin ZIP
            <input value={originZip} onChange={(e) => setOriginZip(e.target.value)} required maxLength={10} placeholder="98230" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Destination ZIP
            <input value={destinationZip} onChange={(e) => setDestinationZip(e.target.value)} required maxLength={10} placeholder="V4A 9V4" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Carrier
            <input value={carrierName} onChange={(e) => setCarrierName(e.target.value)} required placeholder="ODFL" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Service level
            <input value={serviceLevel} onChange={(e) => setServiceLevel(e.target.value)} placeholder="Standard LTL" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Transit days
            <input value={transitDays} onChange={(e) => setTransitDays(e.target.value)} type="number" min="1" placeholder="3" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Total rate (USD)
            <input value={totalRateUsd} onChange={(e) => setTotalRateUsd(e.target.value)} required type="number" step="0.01" min="0" placeholder="1250.00" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Rate source
            <select value={rateSource} onChange={(e) => setRateSource(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none">
              {RATE_SOURCES.map((src) => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
            Effective date
            <input value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} type="date" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <label className="md:col-span-2 text-xs font-medium text-slate-600 uppercase tracking-wide">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Contract ref, quote #, etc." className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none" />
          </label>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save rate
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-slate-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading rates…
        </div>
      ) : rates.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          No rates on file yet. Add the first lane so quote comparisons can compute savings.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 pr-3">Lane</th>
                <th className="text-left py-2 pr-3">Carrier</th>
                <th className="text-left py-2 pr-3">Service</th>
                <th className="text-right py-2 pr-3">Transit</th>
                <th className="text-right py-2 pr-3">Rate</th>
                <th className="text-left py-2 pr-3">Source</th>
                <th className="text-left py-2 pr-3">Effective</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-3 font-mono text-xs text-slate-700">{rate.originZip} → {rate.destinationZip}</td>
                  <td className="py-2 pr-3 font-medium text-slate-900">{rate.carrierName}</td>
                  <td className="py-2 pr-3 text-slate-600">{rate.serviceLevel ?? "—"}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{rate.transitDays ? `${rate.transitDays}d` : "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono font-medium text-slate-900">${rate.totalRateUsd.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{rate.rateSource}</td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{rate.effectiveDateIso ?? "—"}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => handleDelete(rate.id)} className="text-slate-400 hover:text-rose-600" aria-label="Delete rate">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
