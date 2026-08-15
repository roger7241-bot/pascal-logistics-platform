// ============================================================================
// Lightweight date helpers for the Scheduling Hub. No date-fns/dayjs
// dependency — this project doesn't have one installed, and the math
// needed here (month grid, week range, day boundaries) is simple enough
// not to warrant adding one.
// ============================================================================

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - out.getDay());
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 6x7 grid of dates covering the full month view, including lead/trail days from adjacent months. */
export function monthGridDays(monthAnchor: Date): Date[] {
  const first = startOfMonth(monthAnchor);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function formatDayHeader(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatTimeInZone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
}

export function formatDateInZone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" });
}
