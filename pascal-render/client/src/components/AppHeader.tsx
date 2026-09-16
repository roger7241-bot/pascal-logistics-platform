import { Link, useLocation, useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { SimulationButton } from "./SimulationButton";
import { useAuth } from "../contexts/AuthContext";

// Role-scoped nav — operators get their own hub links, client users see
// only client-appropriate destinations. Previously "Manager Hub" was
// visible on the Client Portal but pointed at an operator-only route,
// which either sent operators to CeoHub (confusing when they were on
// the Client Portal tab) or bounced clients back to their portal.
const OPERATOR_NAV_ITEMS = [
  { to: "/operator", label: "Manager Hub" },
  { to: "/operator/operations", label: "Operations Queue" },
  { to: "/operator/carriers", label: "Carrier Desk" },
  { to: "/operator/crm", label: "CRM Accounts" },
  { to: "/operator/agents", label: "AI Agents" },
  { to: "/border-telemetry", label: "Border Telemetry" },
];

const CLIENT_NAV_ITEMS = [
  { to: "/client-portal", label: "Client Portal" },
  { to: "/client-portal/dashboard", label: "Executive Dashboard" },
  { to: "/client-portal/tracking", label: "Ocean & Air Tracking" },
  { to: "/client-portal/compliance", label: "Compliance Vault" },
  { to: "/client-portal/calendar", label: "Calendar" },
  { to: "/border-telemetry", label: "Border Telemetry" },
];

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const navItems = user?.role === "client" ? CLIENT_NAV_ITEMS : OPERATOR_NAV_ITEMS;

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
            <Compass size={22} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-lg font-bold leading-tight text-slate-50">Pascal Logistics</p>
            <p className="text-sm font-mono uppercase tracking-wide text-slate-400">Fractional Logistics Platform</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SimulationButton />
          <button onClick={handleLogout} className="text-xs font-medium text-slate-400 hover:text-slate-200">
            Log out
          </button>
        </div>
      </div>
      <nav className="flex gap-1 border-t border-slate-800 px-2">
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`border-b-2 px-4 py-3.5 text-sm font-medium transition-colors ${
              location.pathname === item.to ? "border-cyan-400 text-slate-50" : "border-transparent text-slate-300 hover:text-slate-50"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
