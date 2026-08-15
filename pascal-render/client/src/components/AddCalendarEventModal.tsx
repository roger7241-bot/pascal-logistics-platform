import { useEffect, useState } from "react";
import { X, CalendarPlus, Bell } from "lucide-react";
import { api } from "../config/api";
import type { CalendarEvent, CalendarEventCategory, CalendarEventTimezone, PoeId, ReminderChannel, ReminderThreshold } from "../types/calendar";
import type { FacilityProfile } from "../types/facility";

const CATEGORY_OPTIONS: { key: CalendarEventCategory; label: string; emoji: string }[] = [
  { key: "dock_appointment", label: "Delivery & Pickup Appointment", emoji: "🚚" },
  { key: "ocean_demurrage", label: "Ocean Laycan & Demurrage Expiration", emoji: "⚓" },
  { key: "border_clearance", label: "Border Clearance & PAPS Window", emoji: "🛂" },
  { key: "discovery_call", label: "Discovery Call / Client Meeting", emoji: "📅" },
];

const POE_OPTIONS: { key: PoeId; label: string }[] = [
  { key: "pacific_highway", label: "Pacific Highway (Blaine, WA)" },
  { key: "sumas", label: "Sumas" },
  { key: "aldergrove", label: "Aldergrove" },
  { key: "peace_arch", label: "Peace Arch (Blaine, WA — passenger only)" },
  { key: "point_roberts", label: "Point Roberts" },
];

const TIMEZONE_OPTIONS: { key: CalendarEventTimezone; label: string }[] = [
  { key: "America/Los_Angeles", label: "PST / PDT" },
  { key: "America/New_York", label: "EST / EDT" },
  { key: "UTC", label: "UTC" },
];

const REMINDER_THRESHOLDS: ReminderThreshold[] = ["15m", "1h", "24h"];
const REMINDER_CHANNELS: ReminderChannel[] = ["email", "sms"];

export interface AddCalendarEventModalProps {
  defaultOrgId?: string;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
}

export function AddCalendarEventModal({ defaultOrgId = "org_meridian", onClose, onSaved }: AddCalendarEventModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [facilities, setFacilities] = useState<FacilityProfile[]>([]);

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<CalendarEventCategory>("dock_appointment");
  const [orgId, setOrgId] = useState(defaultOrgId);
  const [shipmentId, setShipmentId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [poeId, setPoeId] = useState<PoeId | "">("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [timezone, setTimezone] = useState<CalendarEventTimezone>("America/Los_Angeles");
  const [reminderThresholds, setReminderThresholds] = useState<ReminderThreshold[]>(["1h"]);
  const [reminderChannels, setReminderChannels] = useState<ReminderChannel[]>(["email"]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    api.operatorFacilities<{ facilities: FacilityProfile[] }>().then((d) => setFacilities(d.facilities));
  }, []);

  function toggleThreshold(t: ReminderThreshold) {
    setReminderThresholds((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function toggleChannel(c: ReminderChannel) {
    setReminderChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function handleSubmit() {
    if (!title || !startsAt) {
      setError("Event title and start time are required.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const event = await api.createCalendarEvent<CalendarEvent>({
        orgId,
        title,
        eventType,
        startsAtIso: new Date(startsAt).toISOString(),
        endsAtIso: endsAt ? new Date(endsAt).toISOString() : undefined,
        shipmentId: shipmentId || undefined,
        facilityId: facilityId || undefined,
        poeId: poeId || undefined,
        timezone,
        reminderThresholds,
        reminderChannels,
        notes: notes || undefined,
      });
      onSaved(event);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarPlus size={18} className="text-slate-500" />
            <h2 className="text-base font-bold text-slate-900">Schedule Event / Appointment</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

          <Field label="Event Title" required>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dock Appointment: Surrey Main Plant" />
          </Field>

          <Field label="Category">
            <div className="grid grid-cols-2 gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setEventType(opt.key)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-xs font-medium transition ${
                    eventType === opt.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span>{opt.emoji}</span> {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Client Org ID">
              <input className={inputCls} value={orgId} onChange={(e) => setOrgId(e.target.value)} />
            </Field>
            <Field label="Bound Shipment ID">
              <input className={inputCls} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="SHIP-2026-8801" />
            </Field>
          </div>

          <Field label="Target Facility SOP Location">
            <select className={inputCls} value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              <option value="">— None —</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.city})
                </option>
              ))}
            </select>
          </Field>

          {eventType === "border_clearance" && (
            <Field label="Port of Entry">
              <select className={inputCls} value={poeId} onChange={(e) => setPoeId(e.target.value as PoeId)}>
                <option value="">— Select POE —</option>
                {POE_OPTIONS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Start" required>
              <input type="datetime-local" className={inputCls} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field label="End">
              <input type="datetime-local" className={inputCls} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
            <Field label="Timezone">
              <select className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value as CalendarEventTimezone)}>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.key} value={tz.key}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={
            <span className="flex items-center gap-1.5">
              <Bell size={12} /> Reminder Alert Thresholds
            </span>
          }>
            <div className="flex flex-wrap gap-2">
              {REMINDER_THRESHOLDS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleThreshold(t)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    reminderThresholds.includes(t) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {t} before
                </button>
              ))}
              <span className="mx-1 text-slate-300">|</span>
              {REMINDER_CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
                    reminderChannels.includes(c) ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Notes">
            <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? "Scheduling…" : "Schedule Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400";

function Field({ label, required, children }: { label: React.ReactNode; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}
