import { useState } from "react";
import { PlayCircle, X, CheckCircle2, MinusCircle, Loader2 } from "lucide-react";

interface SimulationStep {
  stepNumber: number;
  title: string;
  status: "complete" | "skipped";
  detail: string;
  timestampIso: string;
}

interface SimulationTrace {
  scenarioLabel: string;
  steps: SimulationStep[];
  finalApprovalStatus: string;
  finalConfidenceScore: number;
}

export function SimulationButton() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<SimulationTrace | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleRun = async () => {
    setOpen(true);
    setRunning(true);
    setError(undefined);
    setTrace(undefined);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/simulation/run`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`Simulation failed with status ${res.status}`);
      const data = await res.json();
      setTrace(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run the simulation.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button
        onClick={handleRun}
        title="Simulate End-to-End Border Exception & Rebooking"
        className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-transparent px-2 py-1.5 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200"
      >
        <PlayCircle size={12} /> Simulate scenario
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-50">{trace?.scenarioLabel ?? "Running simulation..."}</p>
              <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-900 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>

            {running && (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
                <Loader2 size={16} className="animate-spin" /> Running the full pipeline trace...
              </div>
            )}

            {error && <p className="text-sm text-rose-400">{error}</p>}

            {trace && (
              <>
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs">
                  <span className="text-slate-400">Final approval status:</span>
                  <span className="font-mono font-semibold text-amber-300">{trace.finalApprovalStatus}</span>
                  <span className="text-slate-400">Confidence:</span>
                  <span className="font-mono font-semibold text-slate-200">{trace.finalConfidenceScore.toFixed(2)}</span>
                </div>

                <div className="space-y-2">
                  {trace.steps.map((step) => (
                    <div key={step.stepNumber} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                      <div className="mb-1 flex items-center gap-2">
                        {step.status === "complete" ? (
                          <CheckCircle2 size={14} className="text-emerald-400" />
                        ) : (
                          <MinusCircle size={14} className="text-slate-600" />
                        )}
                        <p className="text-xs font-semibold text-slate-100">
                          Step {step.stepNumber}: {step.title}
                        </p>
                      </div>
                      <p className="pl-6 text-xs leading-relaxed text-slate-400">{step.detail}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
