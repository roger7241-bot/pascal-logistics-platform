// ============================================================================
// WeightInput
// Weight input with an inline lb/kg toggle. Stores lbs internally (single
// source of truth); the toggle just changes what the user sees and types.
// Preference persists across pages via useWeightUnit().
//
// Parent components own the lbs value (via valueLbs / onChangeLbs) so
// backend payloads never care about the unit — they always send lbs.
// ============================================================================

import type { InputHTMLAttributes } from "react";
import { useWeightUnit, fromLbs, toLbs } from "../lib/units";

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;

interface Props extends BaseProps {
  valueLbs: string;
  onChangeLbs: (nextLbs: string) => void;
  label?: string;
  minLbs?: number;
}

export function WeightInput({ valueLbs, onChangeLbs, label = "Weight", minLbs = 1, className = "", ...rest }: Props) {
  const [unit, setUnit] = useWeightUnit();

  // Display value = lbs converted to the chosen unit. Empty string stays
  // empty (don't render 0.0 when the user is mid-typing).
  const displayValue = valueLbs === "" ? "" : fromLbs(Number(valueLbs), unit).toFixed(1);

  return (
    <label className={`text-xs font-medium text-slate-600 uppercase tracking-wide ${className}`}>
      {label} ({unit})
      <div className="mt-1 flex overflow-hidden rounded-md border border-slate-300 focus-within:border-cyan-500">
        <input
          type="number"
          min={0}
          step="0.1"
          value={displayValue}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") { onChangeLbs(""); return; }
            const parsedInCurrentUnit = Number(raw);
            const asLbs = toLbs(parsedInCurrentUnit, unit);
            // Enforce minimum in lbs
            onChangeLbs(String(Math.max(minLbs, Math.round(asLbs * 100) / 100)));
          }}
          className="flex-1 px-3 py-2 text-sm text-slate-900 focus:outline-none"
          {...rest}
        />
        <div className="flex border-l border-slate-300 bg-slate-50 text-[10px] font-mono uppercase tracking-wide">
          <button
            type="button"
            onClick={() => setUnit("lb")}
            className={`px-2 ${unit === "lb" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}
          >
            lb
          </button>
          <button
            type="button"
            onClick={() => setUnit("kg")}
            className={`px-2 ${unit === "kg" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}
          >
            kg
          </button>
        </div>
      </div>
    </label>
  );
}
