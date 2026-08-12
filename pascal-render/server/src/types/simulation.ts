// ============================================================================
// END-TO-END DEMO SIMULATION TYPES
// A live, step-by-step trace through the real pipeline components already
// built and verified elsewhere in this codebase — not a separate mock
// implementation. Each step's `detail` carries the actual output of the
// real function it calls.
// ============================================================================

export interface SimulationStep {
  stepNumber: number;
  title: string;
  status: "complete" | "skipped";
  detail: string;
  data?: unknown;
  timestampIso: string;
}

export interface SimulationTrace {
  scenarioLabel: string;
  steps: SimulationStep[];
  finalApprovalStatus: string;
  finalConfidenceScore: number;
}
