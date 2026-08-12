import { Link, useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import { SimulationButton } from "./SimulationButton";

const NAV_ITEMS = [
  { to: "/", label: "CEO Hub" },
  { to: "/client-portal", label: "Client Portal" },
  { to: "/client-portal/compliance", label: "Compliance Vault" },
  { to: "/client-portal/calendar", label: "Calendar" },
  { to: "/border-telemetry", label: "Border Telemetry" },
];

export function AppHeader() {
  const location = useLocation();

  return (
    <header className="border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
            <Compass size={16} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-slate-50">Pascal Logistics</p>
            <p className="text-xs font-mono uppercase tracking-wide text-slate-400">Fractional Logistics Platform</p>
          </div>
        </div>
        <SimulationButton />
      </div>
      <nav className="flex gap-1 border-t border-slate-800 px-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              location.pathname === item.to ? "border-cyan-400 text-slate-50" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
