import type { LucideIcon } from "lucide-react";

export type KpiStatus = "good" | "attention" | "neutral";

export interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  caption?: string;
  status?: KpiStatus;
}

/** Consistent KPI card used across CEO Hub, Client Portal, and CRM & Accounts.
 * Color is driven by whether the metric needs attention, not by whether it's
 * a revenue number — a $0 savings figure or a 0% compliance score gets
 * flagged the same way regardless of which desk it's shown on. */
export function KpiCard({ icon: Icon, label, value, caption, status = "neutral" }: KpiCardProps) {
  const styles: Record<KpiStatus, { card: string; icon: string; value: string; caption: string }> = {
    good: { card: "border-emerald-200 bg-emerald-50", icon: "text-emerald-700", value: "text-emerald-700", caption: "text-emerald-600" },
    attention: { card: "border-amber-200 bg-amber-50", icon: "text-amber-700", value: "text-amber-700", caption: "text-amber-600" },
    neutral: { card: "border-slate-200 bg-white shadow-sm", icon: "text-slate-500", value: "text-slate-900", caption: "text-slate-400" },
  };
  const s = styles[status];

  return (
    <div className={`rounded-xl border p-4 ${s.card}`}>
      <div className={`mb-1 flex items-center gap-2 ${s.icon}`}>
        <Icon size={15} />
        <span className="text-[13px] font-mono uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-[28px] font-bold leading-tight ${s.value}`}>{value}</p>
      {caption && <p className={`text-[13px] ${s.caption}`}>{caption}</p>}
    </div>
  );
}

/** Thin progress bar for percent-based metrics — used for Document Health
 * Score and per-shipment completion, so the eye can scan visually instead
 * of reading raw numbers row by row. */
export function ProgressBar({ percent, colorClass = "bg-cyan-500" }: { percent: number; colorClass?: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
