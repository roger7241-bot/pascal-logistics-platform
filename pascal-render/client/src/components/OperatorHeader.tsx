import { Link, useLocation, useNavigate } from "react-router-dom";
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
  Zap,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

const OPERATOR_DESKS = [
  { to: "/operator", label: "Manager Hub", icon: Gauge },
  { to: "/operator/operations", label: "Operations Manager", icon: Inbox },
  { to: "/operator/carriers", label: "Carrier Desk", icon: Truck },
  { to: "/operator/billing", label: "Billing & Admin", icon: Receipt },
  { to: "/operator/executive-review", label: "Executive Review", icon: ShieldCheck },
  { to: "/operator/leads", label: "Sales & Leads", icon: Megaphone },
  { to: "/operator/calls", label: "Call Activity", icon: Phone },
  { to: "/operator/crm", label: "CRM & Accounts", icon: Users },
  { to: "/operator/facilities", label: "Facility SOPs", icon: Warehouse },
  { to: "/operator/vault", label: "Document Vault", icon: FolderOpen },
  { to: "/operator/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/operator/dispatch", label: "Rapid Dispatch", icon: Zap },
  { to: "/border-telemetry", label: "Border & Cams", icon: Camera },
];

export function OperatorHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
            <Compass size={22} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-lg font-bold leading-tight text-slate-50">Pascal Logistics</p>
            <p className="text-sm font-mono uppercase tracking-wide text-slate-400">Operator Control Tower</p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-slate-800/60 p-1">
          <Link to="/operator" className="rounded px-3 py-1.5 text-xs font-semibold text-slate-50 bg-slate-700">
            Operator
          </Link>
          <Link to="/client-portal" className="rounded px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
            Client Portal
          </Link>
          <button onClick={handleLogout} className="rounded px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
            Log out
          </button>
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
              className={`flex items-center gap-1.5 border-b-2 px-3 py-3 text-[13px] font-medium transition-colors ${
                isActive ? "border-cyan-400 text-slate-50" : "border-transparent text-slate-300 hover:text-slate-50"
              }`}
            >
              <Icon size={14} />
              {desk.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
