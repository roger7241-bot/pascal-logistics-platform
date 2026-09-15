// ============================================================================
// UNITS
// Weight unit preference + lb ⇄ kg conversion. Both the US and Canada
// use both systems in freight (US LTL rates by cwt = 100 lb, but Canadian
// commodity paperwork often quotes kg). Every weight input in the app
// stores lbs internally (single source of truth, matches Priority1/
// carrier-API expectations) and displays in the user's chosen unit.
//
// Preference stored per-browser via localStorage. Falls back to lbs when
// the browser has no storage or the value hasn't been set yet.
// ============================================================================

import { useEffect, useState } from "react";

export type WeightUnit = "lb" | "kg";

const STORAGE_KEY = "pl.weightUnit";
const LB_PER_KG = 2.2046226218;

export function lbsToKg(lbs: number): number {
  return lbs / LB_PER_KG;
}

export function kgToLbs(kg: number): number {
  return kg * LB_PER_KG;
}

export function toLbs(value: number, unit: WeightUnit): number {
  return unit === "kg" ? kgToLbs(value) : value;
}

export function fromLbs(lbs: number, unit: WeightUnit): number {
  return unit === "kg" ? lbsToKg(lbs) : lbs;
}

export function formatWeight(lbs: number, unit: WeightUnit, opts: { digits?: number } = {}): string {
  const digits = opts.digits ?? 1;
  return `${fromLbs(lbs, unit).toFixed(digits)} ${unit}`;
}

export function readStoredUnit(): WeightUnit {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "kg") return "kg";
    return "lb";
  } catch {
    return "lb";
  }
}

function writeStoredUnit(unit: WeightUnit): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    /* private mode / storage disabled — silently ignore */
  }
}

/**
 * React hook: returns the current weight unit and a setter. The setter
 * writes to localStorage so the choice persists across page loads.
 * Multiple mounted components share the same state via a small event
 * bus so a toggle in one place updates everywhere without prop drilling.
 */
const listeners = new Set<(u: WeightUnit) => void>();
export function useWeightUnit(): [WeightUnit, (u: WeightUnit) => void] {
  const [unit, setUnitState] = useState<WeightUnit>(() => readStoredUnit());

  useEffect(() => {
    const listener = (u: WeightUnit) => setUnitState(u);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  function setUnit(next: WeightUnit) {
    writeStoredUnit(next);
    listeners.forEach((l) => l(next));
  }

  return [unit, setUnit];
}
