import { useState } from "react";
import { X, Building2, Package, Bell, ChevronLeft, ChevronRight, Plus, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

type WizardStep = 1 | 2 | 3 | 4;
const PPE_OPTIONS = ["Hard hat", "Steel-toe boots", "Hi-vis vest"];

interface FacilityForm {
  name: string;
  role: "shipper" | "consignee" | "both";
  street: string;
  city: string;
  stateOrProvince: string;
  countryCode: string;
  postalCode: string;
  dockHeight: boolean;
  driveInRamp: boolean;
  liftgateRequired: boolean;
  forkliftOnSite: boolean;
  maxTrailerLength: "53ft" | "48ft" | "straight_truck";
  receivingHoursStart: string;
  receivingHoursEnd: string;
  appointmentRequired: boolean;
  pickupLeadTimeHours: string;
  driverPPE: string[];
  twicCardRequired: boolean;
}

interface CommodityForm {
  productName: string;
  htsCode: string;
  countryOfOrigin: string;
  isHazmat: boolean;
  preferredPoe: string;
}

function emptyFacility(): FacilityForm {
  return {
    name: "",
    role: "both",
    street: "",
    city: "",
    stateOrProvince: "",
    countryCode: "US",
    postalCode: "",
    dockHeight: false,
    driveInRamp: false,
    liftgateRequired: false,
    forkliftOnSite: false,
    maxTrailerLength: "53ft",
    receivingHoursStart: "08:00",
    receivingHoursEnd: "16:00",
    appointmentRequired: false,
    pickupLeadTimeHours: "24",
    driverPPE: [],
    twicCardRequired: false,
  };
}

function emptyCommodity(): CommodityForm {
  return { productName: "", htsCode: "", countryOfOrigin: "CA", isHazmat: false, preferredPoe: "" };
}

export interface ClientOpsBaselineWizardProps {
  onClose: () => void;
  onComplete?: () => void;
}

export function ClientOpsBaselineWizard({ onClose, onComplete }: ClientOpsBaselineWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);

  const [facilities, setFacilities] = useState<FacilityForm[]>([emptyFacility()]);
  const [commodities, setCommodities] = useState<CommodityForm[]>([emptyCommodity()]);
  const [brokerPreference, setBrokerPreference] = useState<"pascal_direct" | "third_party">("pascal_direct");
  const [alertRoles, setAlertRoles] = useState({
    ceo: { email: true, sms: false, whatsapp: false },
    logistics_manager: { email: true, sms: true, whatsapp: false },
    driver: { email: false, sms: true, whatsapp: true },
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);

  const updateFacility = (i: number, patch: Partial<FacilityForm>) => setFacilities((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const togglePPE = (i: number, item: string) =>
    setFacilities((prev) => prev.map((f, idx) => (idx === i ? { ...f, driverPPE: f.driverPPE.includes(item) ? f.driverPPE.filter((p) => p !== item) : [...f.driverPPE, item] } : f)));
  const updateCommodity = (i: number, patch: Partial<CommodityForm>) => setCommodities((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const handleSubmit = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      // Real sequential submission — a real deployment would batch this,
      // but sequential keeps the error path attributable to a specific row.
      for (const f of facilities.filter((f) => f.name.trim())) {
        await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/client/facilities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ...f, pickupLeadTimeHours: Number(f.pickupLeadTimeHours) }),
        }).then((r) => {
          if (!r.ok) throw new Error(`Failed to save facility "${f.name}"`);
        });
      }
      for (const c of commodities.filter((c) => c.productName.trim() && c.htsCode.trim())) {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/client/commodities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(c),
        });
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? `Failed to save commodity "${c.productName}"`);
        }
      }

      const alertPreferences = (Object.keys(alertRoles) as (keyof typeof alertRoles)[]).map((role) => ({
        role,
        channels: (Object.keys(alertRoles[role]) as ("email" | "sms" | "whatsapp")[]).filter((ch) => alertRoles[role][ch]),
      }));
      await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/client/alert-preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ alertPreferences }),
      });

      setDone(true);
      onComplete?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save operational baseline.");
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-xl">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={24} />
          </div>
          <h2 className="mb-1 text-lg font-bold text-slate-900">Operational baseline saved</h2>
          <p className="mb-4 text-sm text-slate-600">
            {facilities.filter((f) => f.name.trim()).length} facility profile(s) and {commodities.filter((c) => c.productName.trim()).length} commodity profile(s)
            are now on file — future bookings will auto-fill from these.
          </p>
          <button onClick={onClose} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-slate-900">Operational Baseline Setup</p>
            <p className="text-xs text-slate-500">Step {step} of 4</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="h-1 bg-slate-100">
          <div className="h-1 bg-cyan-500 transition-all" style={{ width: `${(step / 4) * 100}%` }} />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-slate-500">
                  <Building2 size={12} /> Facility directory
                </p>
                <button onClick={() => setFacilities((prev) => [...prev, emptyFacility()])} className="flex items-center gap-1 text-xs font-semibold text-cyan-600">
                  <Plus size={12} /> Add facility
                </button>
              </div>
              {facilities.map((f, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={f.name} onChange={(e) => updateFacility(i, { name: e.target.value })} placeholder="Surrey Main Manufacturing Plant" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" />
                    <select value={f.role} onChange={(e) => updateFacility(i, { role: e.target.value as FacilityForm["role"] })} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs">
                      <option value="both">Shipper &amp; Consignee</option>
                      <option value="shipper">Shipper only</option>
                      <option value="consignee">Consignee only</option>
                    </select>
                  </div>
                  <input value={f.street} onChange={(e) => updateFacility(i, { street: e.target.value })} placeholder="Street address" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" />
                  <div className="grid grid-cols-3 gap-2">
                    <input value={f.city} onChange={(e) => updateFacility(i, { city: e.target.value })} placeholder="City" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" />
                    <input value={f.stateOrProvince} onChange={(e) => updateFacility(i, { stateOrProvince: e.target.value })} placeholder="State/Prov" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" />
                    <input value={f.postalCode} onChange={(e) => updateFacility(i, { postalCode: e.target.value })} placeholder="Postal/ZIP" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.dockHeight} onChange={(e) => updateFacility(i, { dockHeight: e.target.checked })} /> Dock height</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.driveInRamp} onChange={(e) => updateFacility(i, { driveInRamp: e.target.checked })} /> Drive-in ramp</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.liftgateRequired} onChange={(e) => updateFacility(i, { liftgateRequired: e.target.checked })} /> Liftgate required</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.forkliftOnSite} onChange={(e) => updateFacility(i, { forkliftOnSite: e.target.checked })} /> Forklift on-site</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.appointmentRequired} onChange={(e) => updateFacility(i, { appointmentRequired: e.target.checked })} /> Appointment required</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.twicCardRequired} onChange={(e) => updateFacility(i, { twicCardRequired: e.target.checked })} /> TWIC card required</label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select value={f.maxTrailerLength} onChange={(e) => updateFacility(i, { maxTrailerLength: e.target.value as FacilityForm["maxTrailerLength"] })} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs">
                      <option value="53ft">53ft trailer</option>
                      <option value="48ft">48ft trailer</option>
                      <option value="straight_truck">Straight truck</option>
                    </select>
                    <input type="time" value={f.receivingHoursStart} onChange={(e) => updateFacility(i, { receivingHoursStart: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
                    <input type="time" value={f.receivingHoursEnd} onChange={(e) => updateFacility(i, { receivingHoursEnd: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PPE_OPTIONS.map((item) => (
                      <button key={item} onClick={() => togglePPE(i, item)} className={`rounded-full border px-2 py-0.5 text-xs ${f.driverPPE.includes(item) ? "border-cyan-400 bg-cyan-50 text-cyan-700" : "border-slate-200 text-slate-500"}`}>
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-slate-500">
                  <Package size={12} /> Frequent commodities
                </p>
                <button onClick={() => setCommodities((prev) => [...prev, emptyCommodity()])} className="flex items-center gap-1 text-xs font-semibold text-cyan-600">
                  <Plus size={12} /> Add commodity
                </button>
              </div>
              {commodities.map((c, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3">
                  <input value={c.productName} onChange={(e) => updateCommodity(i, { productName: e.target.value })} placeholder="Product name" className="col-span-2 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" />
                  <input value={c.htsCode} onChange={(e) => updateCommodity(i, { htsCode: e.target.value })} placeholder="HTS/HS code" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs" />
                  <input value={c.countryOfOrigin} onChange={(e) => updateCommodity(i, { countryOfOrigin: e.target.value.toUpperCase() })} maxLength={2} placeholder="Origin" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs uppercase" />
                  <label className="col-span-2 flex items-center gap-1.5 text-xs"><input type="checkbox" checked={c.isHazmat} onChange={(e) => updateCommodity(i, { isHazmat: e.target.checked })} /> Hazardous material</label>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Customs broker preference</p>
              <div className="flex gap-2">
                <button onClick={() => setBrokerPreference("pascal_direct")} className={`flex-1 rounded-lg border p-3 text-left text-xs ${brokerPreference === "pascal_direct" ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}>
                  <p className="font-semibold text-slate-800">Pascal handles clearance directly</p>
                </button>
                <button onClick={() => setBrokerPreference("third_party")} className={`flex-1 rounded-lg border p-3 text-left text-xs ${brokerPreference === "third_party" ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}>
                  <p className="font-semibold text-slate-800">Hand off to third-party broker</p>
                </button>
              </div>

              <p className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wide text-slate-500">
                <Bell size={12} /> Alert preferences
              </p>
              <div className="space-y-2">
                {(["ceo", "logistics_manager", "driver"] as const).map((role) => (
                  <div key={role} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                    <span className="text-xs font-semibold capitalize text-slate-700">{role.replace("_", " ")}</span>
                    <div className="flex gap-3 text-xs">
                      {(["email", "sms", "whatsapp"] as const).map((channel) => (
                        <label key={channel} className="flex items-center gap-1 capitalize">
                          <input
                            type="checkbox"
                            checked={alertRoles[role][channel]}
                            onChange={(e) => setAlertRoles((prev) => ({ ...prev, [role]: { ...prev[role], [channel]: e.target.checked } }))}
                          />
                          {channel}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Review &amp; submit</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p>{facilities.filter((f) => f.name.trim()).length} facility profile(s)</p>
                <p>{commodities.filter((c) => c.productName.trim()).length} commodity profile(s)</p>
                <p>Broker: {brokerPreference === "pascal_direct" ? "Pascal direct" : "Third-party"}</p>
              </div>
              {saveError && (
                <p className="flex items-center gap-1.5 text-xs text-rose-600">
                  <AlertTriangle size={13} /> {saveError}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <button onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as WizardStep))} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
            <ChevronLeft size={13} /> {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 4 ? (
            <button onClick={() => setStep((s) => (s + 1) as WizardStep)} className="flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">
              Continue <ChevronRight size={13} />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} {saving ? "Saving..." : "Save baseline"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
