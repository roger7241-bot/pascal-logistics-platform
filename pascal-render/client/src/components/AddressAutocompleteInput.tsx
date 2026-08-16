import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

export interface AddressSuggestion {
  freeformAddress: string;
  streetNumber?: string;
  streetName?: string;
  municipality?: string;
  countrySubdivisionCode?: string;
  postalCode?: string;
  countryCode?: string;
}

interface AddressAutocompleteInputProps {
  value: string;
  onChange: (v: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
  countrySet?: string; // e.g. "CA,US" — omit for the default CA/US/MX bias
}

/** Debounced (350ms) address autocomplete backed by GET
 * /api/client/address-autocomplete (TomTom Search, server-side proxied —
 * see server/src/services/addressAutocomplete.ts for the honest
 * simulated-fallback behavior when no TOMTOM_API_KEY is configured). */
export function AddressAutocompleteInput({ value, onChange, onSelect, placeholder, countrySet }: AddressAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ query: value });
        if (countrySet) params.set("countrySet", countrySet);
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/client/address-autocomplete?${params}`, { credentials: "include" });
        const data = (await res.json()) as { suggestions: AddressSuggestion[]; simulated: boolean };
        setSuggestions(data.suggestions);
        setOpen(data.suggestions.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, countrySet]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-400 px-3 py-2 text-sm"
        autoComplete="off"
      />
      {loading && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">searching…</span>}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-300 bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onSelect(s);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
            >
              <MapPin size={12} className="mt-0.5 shrink-0 text-slate-400" />
              <span>{s.freeformAddress}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
