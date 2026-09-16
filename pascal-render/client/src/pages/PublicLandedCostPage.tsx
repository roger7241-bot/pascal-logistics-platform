// ============================================================================
// PublicLandedCostPage
// Standalone /quote page, no auth. The marketing site links here. Every
// submission with an email captures a lead into the prospect pipeline.
// ============================================================================

import { Calculator, Compass } from "lucide-react";
import { LandedCostCalculator } from "../components/LandedCostCalculator";

export function PublicLandedCostPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Minimal header — no operator/client nav so anonymous visitors don't see it */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400 text-slate-950">
              <Compass size={18} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight text-slate-50-800">Pascal Logistics</p>
              <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Landed-cost calculator</p>
            </div>
          </a>
          <a href="https://pascallogistics.com" className="text-xs font-medium text-slate-500 hover:text-slate-800">← Back to site</a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-slate-700" />
          <h1 className="text-2xl font-bold">All-in landed cost in 30 seconds</h1>
        </div>
        <p className="text-sm text-slate-600 max-w-3xl">
          Freight + duty + brokerage + insurance + last mile. Estimates are benchmark rates —
          the real number takes a live carrier quote and your broker's fee schedule, which we'll do for free if you save your quote below.
        </p>
        <LandedCostCalculator variant="public" />
      </main>
    </div>
  );
}
