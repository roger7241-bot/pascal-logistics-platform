import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api } from "../config/api";

interface CalendarEvent {
  id: string;
  title: string;
  eventType: string;
  startsAtIso: string;
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
  demurrage_deadline: "Free-Time Expiration",
  poa_expiry: "POA Expiry",
  other: "Other",
};

export function ClientCalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .calendarEvents<{ events: CalendarEvent[] }>("org_meridian")
      .then((d) => setEvents(d.events))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center gap-2">
          <CalendarDays size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Logistics Schedule &amp; Calendar</h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold">Upcoming delivery windows &amp; deadlines {loading && <span className="text-slate-400">(loading...)</span>}</p>
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
            {!loading && events.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No upcoming events scheduled.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
