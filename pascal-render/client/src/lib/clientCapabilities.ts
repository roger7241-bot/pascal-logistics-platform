// ============================================================================
// CLIENT CAPABILITIES
// Shape + tiny helpers for per-account feature flags. Kept as a plain
// TS module (no React) so backend-shaped types can share the source.
// ============================================================================

export interface ClientCapabilities {
  shipsUSToCanada?: boolean;
  shipsCanadaToUS?: boolean;
  shipsDomesticOnly?: boolean;
  shipsInternational?: boolean;
  brokerOfRecord?: string;
  currentForwarder?: string;
  trackedHsCodes?: string[];
  primaryLanes?: string[];
  monthlyLoadsEstimate?: string;
}

export function isCrossBorder(caps: ClientCapabilities | undefined): boolean {
  if (!caps) return false;
  return Boolean(caps.shipsUSToCanada || caps.shipsCanadaToUS || caps.shipsInternational);
}

export function capabilityLabel(caps: ClientCapabilities | undefined): "Cross-border" | "Domestic-only" | "International" | "Unset" {
  if (!caps || Object.keys(caps).length === 0) return "Unset";
  if (caps.shipsInternational) return "International";
  if (caps.shipsUSToCanada || caps.shipsCanadaToUS) return "Cross-border";
  if (caps.shipsDomesticOnly) return "Domestic-only";
  return "Unset";
}

export function capabilityBadgeClass(label: ReturnType<typeof capabilityLabel>): string {
  switch (label) {
    case "Cross-border": return "bg-cyan-100 text-cyan-700";
    case "International": return "bg-violet-100 text-violet-700";
    case "Domestic-only": return "bg-slate-100 text-slate-600";
    case "Unset": return "bg-amber-100 text-amber-700";
  }
}
