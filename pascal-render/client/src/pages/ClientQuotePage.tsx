// ============================================================================
// ClientQuotePage
// The same landed-cost calculator, inside the authenticated client portal.
// No lead capture — the client is already an account. Estimate is theirs
// to run any time; they can print the result via the browser (same pattern
// as the Tier 3 exec dashboard).
// ============================================================================

import { Calculator } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { LandedCostCalculator } from "../components/LandedCostCalculator";

export function ClientQuotePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Calculator size={18} className="text-slate-700" />
          <h1 className="text-xl font-bold">Landed-cost calculator</h1>
        </div>
        <p className="text-sm text-slate-600">
          Freight + duty + brokerage + insurance + last mile. Benchmark rates by default —
          when we have your carrier + broker on file, the real numbers flow through automatically.
        </p>
        <LandedCostCalculator variant="authed" scope="client" />
      </main>
    </div>
  );
}
