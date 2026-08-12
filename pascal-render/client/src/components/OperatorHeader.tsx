import { Link, useLocation } from "react-router-dom";
import {
  Compass,
  Inbox,
  Truck,
  Receipt,
  ShieldCheck,
  Megaphone,
  Users,
  Warehouse,
  FolderOpen,
  CalendarDays,
  Camera,
  Gauge,
  Phone,
} from "lucide-react";

const OPERATOR_DESKS = [
  { to: "/operator", label: "CEO Hub", icon: Gauge },
  { to: "/operator/operations", label: "Operations Queue", icon: Inbox },
  { to: "/operator/carriers", label: "Carrier Desk", icon: Truck },
  { to: "/operator/billing", label: "Billing & Admin", icon: Receipt },
  { to: "/operator/executive-review", label: "Executive Review", icon: ShieldCheck },
  { to: "/operator/leads", label: "Sales & Leads", icon: Megaphone },
  { to: "/operator/calls", label: "Call Activity", icon: Phone },
  { to: "/operator/crm", label: "CRM & Accounts", icon: Users },
  { to: "/operator/facilities", label: "Facility SOPs", icon: Warehouse },
  { to: "/operator/vault", label: "Document Vault", icon: FolderOpen },
  { to: "/operator/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/border-telemetry", label: "Border & Cams", icon: Camera },
];

export function OperatorHeader() {
  const location = useLocation();

  return (
    <header className="border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
            <Compass size={16} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-slate-50">Pascal Logistics</p>
            <p className="text-xs font-mono uppercase tracking-wide text-slate-400">Operator Control Tower</p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-slate-800/60 p-1">
          <Link to="/operator" className="rounded px-3 py-1.5 text-xs font-semibold text-slate-50 bg-slate-700">
            Operator
          </Link>
          <Link to="/client-portal" className="rounded px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
            Client Portal
          </Link>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 border-t border-slate-800 px-2">
        {OPERATOR_DESKS.map((desk) => {
          const Icon = desk.icon;
          const isActive = location.pathname === desk.to;
          return (
            <Link
              key={desk.to}
              to={desk.to}
              className={`flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs font-medium transition-colors ${
                isActive ? "border-cyan-400 text-slate-50" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon size={12} />
              {desk.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
