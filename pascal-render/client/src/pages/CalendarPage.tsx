import { useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

export interface CalendarEvent {
  id: string;
  title: string;
  eventType: string;
  startsAtIso: string;
  notes?: string;
}

const TYPE_CLASS: Record<string, string> = {
  pickup: "bg-sky-100 text-sky-700 border-sky-200",
  delivery: "bg-sky-100 text-sky-700 border-sky-200",
  laycan: "bg-violet-100 text-violet-700 border-violet-200",
  demurrage_deadline: "bg-rose-100 text-rose-700 border-rose-200",
  poa_expiry: "bg-emerald-100 text-emerald-700 border-emerald-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

const TYPE_LABEL: Record<string, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  laycan: "Vessel Laycan",
  demurrage_deadline: "Demurrage Deadline",
  poa_expiry: "POA Expiry",
  other: "Other",
};

export function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("pickup");
  const [startsAt, setStartsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .calendarEvents<{ events: CalendarEvent[] }>()
      .then((d) => setEvents(d.events))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleAdd = async () => {
    if (!title.trim() || !startsAt) return;
    setSubmitting(true);
    try {
      await api.createCalendarEvent({ orgId: "org_meridian", title, eventType, startsAtIso: new Date(startsAt).toISOString() });
      setTitle("");
      setStartsAt("");
      load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] p-6">
        <div className="mb-4 flex items-center gap-2">
          <CalendarDays size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Shared Logistics Calendar</h1>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button onClick={handleAdd} disabled={submitting} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
            <Plus size={14} /> Add event
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold">Upcoming events {loading && <span className="text-slate-400">(loading...)</span>}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-40 shrink-0">
                  <p className="text-xs font-mono text-slate-500">
                    {new Date(ev.startsAtIso).toLocaleDateString()} {new Date(ev.startsAtIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <p className="flex-1 text-sm font-semibold text-slate-900">{ev.title}</p>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${TYPE_CLASS[ev.eventType]}`}>{TYPE_LABEL[ev.eventType]}</span>
              </div>
            ))}
            {!loading && events.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No events scheduled yet.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
