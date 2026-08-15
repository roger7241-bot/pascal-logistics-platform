import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { LogisticsCalendarView } from "../components/LogisticsCalendarView";
import { AddCalendarEventModal } from "../components/AddCalendarEventModal";
import { CalendarEventDrawer } from "../components/CalendarEventDrawer";
import { api } from "../config/api";
import type { CalendarEvent } from "../types/calendar";

export function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | undefined>();

  function load() {
    setLoading(true);
    api
      .calendarEvents<{ events: CalendarEvent[] }>()
      .then((d) => setEvents(d.events))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] p-6">
        <div className="mb-4 flex items-center gap-2">
          <CalendarDays size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Scheduling Hub</h1>
        </div>

        <LogisticsCalendarView
          events={events}
          loading={loading}
          isOperator
          onEventClick={setSelectedEvent}
          onAddClick={() => setShowAddModal(true)}
        />
      </main>

      {showAddModal && (
        <AddCalendarEventModal
          onClose={() => setShowAddModal(false)}
          onSaved={(event) => {
            setEvents((prev) => [...prev, event]);
            setShowAddModal(false);
          }}
        />
      )}

      {selectedEvent && (
        <CalendarEventDrawer
          event={selectedEvent}
          isOperator
          onClose={() => setSelectedEvent(undefined)}
          onUpdated={(updated) => {
            setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
            setSelectedEvent(updated);
          }}
          onCancelled={(id) => {
            setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, status: "cancelled" } : e)));
            setSelectedEvent(undefined);
          }}
        />
      )}
    </div>
  );
}
