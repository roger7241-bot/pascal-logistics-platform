import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { LogisticsCalendarView } from "../components/LogisticsCalendarView";
import { CalendarEventDrawer } from "../components/CalendarEventDrawer";
import { api } from "../config/api";
import type { CalendarEvent } from "../types/calendar";

export function ClientCalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | undefined>();

  useEffect(() => {
    api
      .calendarEvents<{ events: CalendarEvent[] }>("org_meridian")
      .then((d) => setEvents(d.events))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] p-6">
        <div className="mb-4 flex items-center gap-2">
          <CalendarDays size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Logistics Schedule &amp; Calendar</h1>
        </div>

        <LogisticsCalendarView events={events} loading={loading} isOperator={false} onEventClick={setSelectedEvent} />
      </main>

      {selectedEvent && (
        <CalendarEventDrawer
          event={selectedEvent}
          isOperator={false}
          onClose={() => setSelectedEvent(undefined)}
          onUpdated={() => {}}
          onCancelled={() => {}}
        />
      )}
    </div>
  );
}
