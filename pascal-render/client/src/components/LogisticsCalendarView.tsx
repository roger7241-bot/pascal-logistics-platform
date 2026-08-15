import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Rows3, ListTodo, AlertTriangle, Plus } from "lucide-react";
import type { CalendarEvent, CalendarEventCategory } from "../types/calendar";
import { addDays, addMonths, formatDayHeader, formatMonthYear, formatTimeInZone, isSameDay, monthGridDays, weekDays } from "../lib/calendarDate";

type ViewMode = "month" | "week" | "day" | "critical";
type CategoryFilter = "all" | CalendarEventCategory;

const CATEGORY_META: Record<CalendarEventCategory, { emoji: string; label: string; badgeClass: string }> = {
  dock_appointment: { emoji: "🚚", label: "Delivery & Pickup", badgeClass: "bg-sky-100 text-sky-700" },
  ocean_demurrage: { emoji: "⚓", label: "Ocean Laycan / Demurrage", badgeClass: "bg-violet-100 text-violet-700" },
  border_clearance: { emoji: "🛂", label: "Border Clearance / PAPS", badgeClass: "bg-amber-100 text-amber-700" },
  discovery_call: { emoji: "📅", label: "Discovery Call / Meeting", badgeClass: "bg-emerald-100 text-emerald-700" },
  other: { emoji: "🗓️", label: "Other", badgeClass: "bg-slate-100 text-slate-600" },
};

const VIEW_OPTIONS: { key: ViewMode; label: string; icon: typeof CalendarDays }[] = [
  { key: "month", label: "Month View", icon: CalendarDays },
  { key: "week", label: "Week Grid", icon: Rows3 },
  { key: "day", label: "Day Timeline", icon: ListTodo },
  { key: "critical", label: "Critical Deadlines", icon: AlertTriangle },
];

/** Deadline-driven categories that count as "critical" — free-time expirations
 * and border windows carry real financial/compliance risk if missed. */
const CRITICAL_CATEGORIES: CalendarEventCategory[] = ["ocean_demurrage", "border_clearance"];

export interface LogisticsCalendarViewProps {
  events: CalendarEvent[];
  loading: boolean;
  isOperator: boolean;
  onEventClick: (event: CalendarEvent) => void;
  onAddClick?: () => void;
}

export function LogisticsCalendarView({ events, loading, isOperator, onEventClick, onAddClick }: LogisticsCalendarViewProps) {
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(new Date());
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const filteredEvents = useMemo(() => {
    const active = events.filter((e) => e.status !== "cancelled");
    if (categoryFilter === "all") return active;
    return active.filter((e) => e.eventType === categoryFilter);
  }, [events, categoryFilter]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of filteredEvents) {
      const key = new Date(e.startsAtIso).toDateString();
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [filteredEvents]);

  function navigate(direction: -1 | 1) {
    if (view === "month") setAnchor((prev) => addMonths(prev, direction));
    else if (view === "week") setAnchor((prev) => addDays(prev, direction * 7));
    else setAnchor((prev) => addDays(prev, direction));
  }

  return (
    <div>
      {/* View toggles + nav + add button */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setView(opt.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                view === opt.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <opt.icon size={13} /> {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {view !== "critical" && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1">
              <button onClick={() => navigate(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-50">
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[140px] px-1 text-center text-xs font-semibold text-slate-700">
                {view === "day" ? formatDayHeader(anchor) : formatMonthYear(anchor)}
              </span>
              <button onClick={() => navigate(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-50">
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          <button onClick={() => setAnchor(new Date())} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Today
          </button>
          {isOperator && onAddClick && (
            <button onClick={onAddClick} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              <Plus size={15} /> Schedule Event
            </button>
          )}
        </div>
      </div>

      {/* Category filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCategoryFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            categoryFilter === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          }`}
        >
          All Categories
        </button>
        {(Object.entries(CATEGORY_META) as [CalendarEventCategory, (typeof CATEGORY_META)[CalendarEventCategory]][])
          .filter(([key]) => key !== "other")
          .map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setCategoryFilter(key)}
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
                categoryFilter === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <span>{meta.emoji}</span> {meta.label}
            </button>
          ))}
        {loading && <span className="text-xs text-slate-400">(loading…)</span>}
      </div>

      {view === "month" && <MonthGrid anchor={anchor} eventsByDay={eventsByDay} onEventClick={onEventClick} />}
      {view === "week" && <WeekGrid anchor={anchor} eventsByDay={eventsByDay} onEventClick={onEventClick} />}
      {view === "day" && <DayTimeline anchor={anchor} events={filteredEvents} onEventClick={onEventClick} />}
      {view === "critical" && <CriticalDeadlinesList events={filteredEvents} onEventClick={onEventClick} />}
    </div>
  );
}

function EventChip({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const meta = CATEGORY_META[event.eventType] ?? CATEGORY_META.other;
  return (
    <button onClick={onClick} className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${meta.badgeClass}`}>
      {meta.emoji} {formatTimeInZone(event.startsAtIso, event.timezone)} {event.title}
    </button>
  );
}

function MonthGrid({ anchor, eventsByDay, onEventClick }: { anchor: Date; eventsByDay: Map<string, CalendarEvent[]>; onEventClick: (e: CalendarEvent) => void }) {
  const days = monthGridDays(anchor);
  const today = new Date();
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-slate-500">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const dayEvents = eventsByDay.get(d.toDateString()) ?? [];
          const inMonth = d.getMonth() === anchor.getMonth();
          return (
            <div key={i} className={`min-h-[100px] border-b border-r border-slate-100 p-1.5 ${inMonth ? "bg-white" : "bg-slate-50/50"}`}>
              <p className={`mb-1 text-xs ${isSameDay(d, today) ? "font-bold text-slate-900" : inMonth ? "text-slate-500" : "text-slate-300"}`}>{d.getDate()}</p>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <EventChip key={e.id} event={e} onClick={() => onEventClick(e)} />
                ))}
                {dayEvents.length > 3 && <p className="px-1 text-[10px] text-slate-400">+{dayEvents.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ anchor, eventsByDay, onEventClick }: { anchor: Date; eventsByDay: Map<string, CalendarEvent[]>; onEventClick: (e: CalendarEvent) => void }) {
  const days = weekDays(anchor);
  const today = new Date();
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const dayEvents = (eventsByDay.get(d.toDateString()) ?? []).sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
          return (
            <div key={i} className="min-h-[320px] border-r border-slate-100 p-2 last:border-r-0">
              <p className={`mb-2 text-xs font-semibold ${isSameDay(d, today) ? "text-slate-900" : "text-slate-500"}`}>{formatDayHeader(d)}</p>
              <div className="space-y-1">
                {dayEvents.map((e) => (
                  <EventChip key={e.id} event={e} onClick={() => onEventClick(e)} />
                ))}
                {dayEvents.length === 0 && <p className="text-[10px] text-slate-300">—</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayTimeline({ anchor, events, onEventClick }: { anchor: Date; events: CalendarEvent[]; onEventClick: (e: CalendarEvent) => void }) {
  const dayEvents = events.filter((e) => isSameDay(new Date(e.startsAtIso), anchor)).sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="divide-y divide-slate-100">
        {hours.map((h) => {
          const hourEvents = dayEvents.filter((e) => new Date(e.startsAtIso).getHours() === h);
          if (hourEvents.length === 0 && (h < 5 || h > 20)) return null; // collapse quiet overnight hours
          return (
            <div key={h} className="flex items-start gap-3 px-4 py-2">
              <span className="w-14 shrink-0 pt-0.5 text-xs font-mono text-slate-400">{h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}</span>
              <div className="flex-1 space-y-1">
                {hourEvents.map((e) => {
                  const meta = CATEGORY_META[e.eventType] ?? CATEGORY_META.other;
                  return (
                    <button key={e.id} onClick={() => onEventClick(e)} className={`block w-full rounded-lg px-3 py-2 text-left text-xs font-medium ${meta.badgeClass}`}>
                      {meta.emoji} {formatTimeInZone(e.startsAtIso, e.timezone)} — {e.title}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {dayEvents.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">No events scheduled for this day.</p>}
      </div>
    </div>
  );
}

function CriticalDeadlinesList({ events, onEventClick }: { events: CalendarEvent[]; onEventClick: (e: CalendarEvent) => void }) {
  const critical = events
    .filter((e) => CRITICAL_CATEGORIES.includes(e.eventType) && new Date(e.startsAtIso).getTime() >= Date.now() - 24 * 60 * 60 * 1000)
    .sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3">
        <p className="text-sm font-bold text-slate-900">Critical Deadlines — Demurrage & Border Windows</p>
      </div>
      <div className="divide-y divide-slate-100">
        {critical.map((e) => {
          const meta = CATEGORY_META[e.eventType] ?? CATEGORY_META.other;
          const hoursOut = Math.round((new Date(e.startsAtIso).getTime() - Date.now()) / (60 * 60 * 1000));
          return (
            <button key={e.id} onClick={() => onEventClick(e)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50">
              <span className="text-lg">{meta.emoji}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-900">{e.title}</p>
                <p className="text-xs text-slate-500">
                  {formatTimeInZone(e.startsAtIso, e.timezone)} · {new Date(e.startsAtIso).toLocaleDateString()}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hoursOut <= 6 ? "bg-rose-100 text-rose-700" : hoursOut <= 24 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                {hoursOut <= 0 ? "Overdue" : `${hoursOut}h out`}
              </span>
            </button>
          );
        })}
        {critical.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No upcoming demurrage or border-clearance deadlines.</p>}
      </div>
    </div>
  );
}
