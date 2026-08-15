import { useState } from "react";
import { X, Building2, User, Clock, Truck as TruckIcon, HardHat, Timer } from "lucide-react";
import { api } from "../config/api";
import type { FacilityCapability, FacilityProfile } from "../types/facility";

const CAPABILITY_OPTIONS: { key: FacilityCapability; label: string }[] = [
  { key: "cold_storage", label: "Cold Storage / Reefer" },
  { key: "cross_dock", label: "Cross-Dock" },
  { key: "hazmat_approved", label: "Hazmat Approved" },
  { key: "overhead_crane", label: "Overhead Crane" },
];

export interface AddFacilityModalProps {
  /** When provided, the modal opens in edit mode: fields are pre-filled and Save issues a PATCH instead of a POST. */
  facility?: FacilityProfile;
  onClose: () => void;
  onSaved: (facility: FacilityProfile) => void;
}

export function AddFacilityModal({ facility, onClose, onSaved }: AddFacilityModalProps) {
  const isEditing = Boolean(facility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [name, setName] = useState(facility?.name ?? "");
  const [orgId, setOrgId] = useState(facility?.orgId ?? "org_meridian");
  const [street, setStreet] = useState(facility?.street ?? "");
  const [city, setCity] = useState(facility?.city ?? "");
  const [stateOrProvince, setStateOrProvince] = useState(facility?.stateOrProvince ?? "");
  const [countryCode, setCountryCode] = useState<"US" | "CA">((facility?.countryCode as "US" | "CA") ?? "CA");
  const [postalCode, setPostalCode] = useState(facility?.postalCode ?? "");

  const [dockContactName, setDockContactName] = useState(facility?.dockContactName ?? "");
  const [dockContactPhone, setDockContactPhone] = useState(facility?.dockContactPhone ?? "");
  const [receivingEmail, setReceivingEmail] = useState(facility?.receivingEmail ?? "");

  const [receivingHoursStart, setReceivingHoursStart] = useState(facility?.receivingHoursStart ?? "08:00");
  const [receivingHoursEnd, setReceivingHoursEnd] = useState(facility?.receivingHoursEnd ?? "16:00");
  const [breakWindow, setBreakWindow] = useState(facility?.breakWindow ?? "");

  const [maxTrailerLength, setMaxTrailerLength] = useState<"53ft" | "48ft" | "straight_truck">(facility?.maxTrailerLength ?? "53ft");
  const [isoContainerCapable, setIsoContainerCapable] = useState(facility?.isoContainerCapable ?? false);
  const [dockDoorCount, setDockDoorCount] = useState<number | "">(facility?.dockDoorCount ?? "");
  const [liftgateRequired, setLiftgateRequired] = useState(facility?.liftgateRequired ?? false);
  const [scaleOnSite, setScaleOnSite] = useState(facility?.scaleOnSite ?? false);

  const [hardHatRequired, setHardHatRequired] = useState(facility?.hardHatRequired ?? false);
  const [steelToeRequired, setSteelToeRequired] = useState(facility?.steelToeRequired ?? false);
  const [twicCardRequired, setTwicCardRequired] = useState(facility?.twicCardRequired ?? false);
  const [driverStagingNotes, setDriverStagingNotes] = useState(facility?.driverStagingNotes ?? "");

  const [freeTimeMinutes, setFreeTimeMinutes] = useState(facility?.freeTimeMinutes ?? 120);
  const [detentionRateUsdPerHour, setDetentionRateUsdPerHour] = useState(facility?.detentionRateUsdPerHour ?? 75);

  const [capabilities, setCapabilities] = useState<FacilityCapability[]>(facility?.capabilities ?? []);

  function toggleCapability(key: FacilityCapability) {
    setCapabilities((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  }

  async function handleSubmit() {
    if (!name || !street || !city || !countryCode) {
      setError("Facility name, street, city, and country are required.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const payload = {
        orgId,
        name,
        street,
        city,
        stateOrProvince,
        countryCode,
        postalCode,
        dockContactName: dockContactName || undefined,
        dockContactPhone: dockContactPhone || undefined,
        receivingEmail: receivingEmail || undefined,
        receivingHoursStart,
        receivingHoursEnd,
        breakWindow: breakWindow || undefined,
        maxTrailerLength,
        isoContainerCapable,
        dockDoorCount: dockDoorCount === "" ? undefined : Number(dockDoorCount),
        liftgateRequired,
        scaleOnSite,
        hardHatRequired,
        steelToeRequired,
        twicCardRequired,
        driverStagingNotes: driverStagingNotes || undefined,
        freeTimeMinutes,
        detentionRateUsdPerHour,
        capabilities,
      };
      const saved = isEditing
        ? await api.updateOperatorFacility<FacilityProfile>(facility!.id, payload)
        : await api.createOperatorFacility<FacilityProfile>(payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save facility.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-slate-500" />
            <h2 className="text-base font-bold text-slate-900">{isEditing ? "Edit Facility SOP" : "Add Facility SOP"}</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

          {/* Identity & address */}
          <Section icon={Building2} title="Facility & Address">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Facility Name" required span2>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Surrey Main Manufacturing Plant" />
              </Field>
              <Field label="Client Org ID" required>
                <input className={inputCls} value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org_meridian" />
              </Field>
              <Field label="Country">
                <select className={inputCls} value={countryCode} onChange={(e) => setCountryCode(e.target.value as "US" | "CA")}>
                  <option value="CA">Canada</option>
                  <option value="US">United States</option>
                </select>
              </Field>
              <Field label="Street" required span2>
                <input className={inputCls} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="18800 96 Ave" />
              </Field>
              <Field label="City" required>
                <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Surrey / Blaine / Abbotsford / Ferndale" />
              </Field>
              <Field label="State / Province">
                <input className={inputCls} value={stateOrProvince} onChange={(e) => setStateOrProvince(e.target.value)} placeholder="BC / WA" />
              </Field>
              <Field label="Postal / ZIP">
                <input className={inputCls} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
              </Field>
            </div>
          </Section>

          {/* Dock contact */}
          <Section icon={User} title="Primary Dock Contact">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact Name">
                <input className={inputCls} value={dockContactName} onChange={(e) => setDockContactName(e.target.value)} />
              </Field>
              <Field label="Direct Phone">
                <input className={inputCls} value={dockContactPhone} onChange={(e) => setDockContactPhone(e.target.value)} placeholder="+16045551234" />
              </Field>
              <Field label="Receiving Email" span2>
                <input className={inputCls} value={receivingEmail} onChange={(e) => setReceivingEmail(e.target.value)} placeholder="dock@facility.com" />
              </Field>
            </div>
          </Section>

          {/* Hours */}
          <Section icon={Clock} title="Shipping & Receiving Hours">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Opens">
                <input type="time" className={inputCls} value={receivingHoursStart} onChange={(e) => setReceivingHoursStart(e.target.value)} />
              </Field>
              <Field label="Closes">
                <input type="time" className={inputCls} value={receivingHoursEnd} onChange={(e) => setReceivingHoursEnd(e.target.value)} />
              </Field>
              <Field label="Break Window">
                <input className={inputCls} value={breakWindow} onChange={(e) => setBreakWindow(e.target.value)} placeholder="12:00-12:30" />
              </Field>
            </div>
          </Section>

          {/* Equipment & dock constraints */}
          <Section icon={TruckIcon} title="Equipment & Dock Constraints">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max Trailer Length">
                <select className={inputCls} value={maxTrailerLength} onChange={(e) => setMaxTrailerLength(e.target.value as typeof maxTrailerLength)}>
                  <option value="53ft">53' Dry Van</option>
                  <option value="48ft">48'</option>
                  <option value="straight_truck">Straight Truck</option>
                </select>
              </Field>
              <Field label="Dock Door Count">
                <input type="number" min={0} className={inputCls} value={dockDoorCount} onChange={(e) => setDockDoorCount(e.target.value === "" ? "" : Number(e.target.value))} />
              </Field>
              <Checkbox label="40' ISO container capable" checked={isoContainerCapable} onChange={setIsoContainerCapable} />
              <Checkbox label="Liftgate required" checked={liftgateRequired} onChange={setLiftgateRequired} />
              <Checkbox label="Scale on site" checked={scaleOnSite} onChange={setScaleOnSite} />
            </div>
          </Section>

          {/* Safety & PPE */}
          <Section icon={HardHat} title="Safety & PPE Protocols">
            <div className="grid grid-cols-3 gap-3">
              <Checkbox label="Hard hat required" checked={hardHatRequired} onChange={setHardHatRequired} />
              <Checkbox label="Steel-toe boots required" checked={steelToeRequired} onChange={setSteelToeRequired} />
              <Checkbox label="TWIC card required" checked={twicCardRequired} onChange={setTwicCardRequired} />
              <Field label="Driver Staging Location Rules" span2>
                <textarea className={inputCls} rows={2} value={driverStagingNotes} onChange={(e) => setDriverStagingNotes(e.target.value)} placeholder="Stage in Lane 3, check in at guard shack before backing to a door." />
              </Field>
            </div>
          </Section>

          {/* Free time & detention */}
          <Section icon={Timer} title="Free-Time & Detention Policy">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Free Wait Time (minutes)">
                <input type="number" min={0} className={inputCls} value={freeTimeMinutes} onChange={(e) => setFreeTimeMinutes(Number(e.target.value))} />
              </Field>
              <Field label="Detention Rate (USD/hr)">
                <input type="number" min={0} step="0.01" className={inputCls} value={detentionRateUsdPerHour} onChange={(e) => setDetentionRateUsdPerHour(Number(e.target.value))} />
              </Field>
            </div>
          </Section>

          {/* Capability tags */}
          <Section icon={Building2} title="Capability Tags">
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleCapability(opt.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    capabilities.includes(opt.key) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Section>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : isEditing ? "Save Changes" : "Save Facility SOP"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400";

function Section({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Icon size={13} />
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, required, span2, children }: { label: string; required?: boolean; span2?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${span2 ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
      {label}
    </label>
  );
}
