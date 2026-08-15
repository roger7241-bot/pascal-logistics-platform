import { useEffect, useMemo, useState } from "react";
import { Warehouse, Clock, Truck as ForkliftIcon, Search, Plus, Snowflake, Split, ShieldCheck, Construction, Phone, Mail } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { AddFacilityModal } from "../components/AddFacilityModal";
import { FacilityDetailDrawer } from "../components/FacilityDetailDrawer";
import { api } from "../config/api";
import type { FacilityCapability, FacilityProfile } from "../types/facility";

type RegionFilter = "all" | "bc" | "wa";
type CapabilityFilter = "all" | FacilityCapability;

const CAPABILITY_FILTERS: { key: CapabilityFilter; label: string; icon: typeof Snowflake }[] = [
  { key: "all", label: "All Capabilities", icon: Warehouse },
  { key: "cold_storage", label: "Cold Storage / Reefer", icon: Snowflake },
  { key: "cross_dock", label: "Cross-Dock", icon: Split },
  { key: "hazmat_approved", label: "Hazmat Approved", icon: ShieldCheck },
  { key: "overhead_crane", label: "Overhead Crane", icon: Construction },
];

const CAPABILITY_BADGE_CLASS: Record<FacilityCapability, string> = {
  cold_storage: "bg-cyan-100 text-cyan-700",
  cross_dock: "bg-indigo-100 text-indigo-700",
  hazmat_approved: "bg-rose-100 text-rose-700",
  overhead_crane: "bg-amber-100 text-amber-700",
};

const CAPABILITY_LABEL: Record<FacilityCapability, string> = {
  cold_storage: "Cold Storage / Reefer",
  cross_dock: "Cross-Dock",
  hazmat_approved: "Hazmat Approved",
  overhead_crane: "Overhead Crane",
};

function regionOf(facility: FacilityProfile): RegionFilter {
  if (facility.countryCode === "CA") return "bc";
  if (facility.countryCode === "US") return "wa";
  return "all";
}

export function FacilitySopDirectoryPage() {
  const [facilities, setFacilities] = useState<FacilityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState<RegionFilter>("all");
  const [capability, setCapability] = useState<CapabilityFilter>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState<FacilityProfile | undefined>();
  const [editingFacility, setEditingFacility] = useState<FacilityProfile | undefined>();

  function loadFacilities() {
    setLoading(true);
    api
      .operatorFacilities<{ facilities: FacilityProfile[] }>()
      .then((d) => setFacilities(d.facilities))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadFacilities();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return facilities.filter((f) => {
      if (region !== "all" && regionOf(f) !== region) return false;
      if (capability !== "all" && !f.capabilities.includes(capability)) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.city.toLowerCase().includes(q) ||
        f.orgId.toLowerCase().includes(q) ||
        f.maxTrailerLength.toLowerCase().includes(q) ||
        f.capabilities.some((c) => CAPABILITY_LABEL[c].toLowerCase().includes(q))
      );
    });
  }, [facilities, search, region, capability]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] p-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Warehouse size={18} className="text-slate-500" />
            <h1 className="text-xl font-bold">Facility Management & Warehouse Rules Hub</h1>
            {loading && <span className="text-xs text-slate-400">(loading…)</span>}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus size={15} /> Add Facility SOP
          </button>
        </div>

        {/* Search, region, capability filter bar */}
        <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by facility name, city, client org, or equipment type…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Region</span>
            {([
              ["all", "All Regions"],
              ["bc", "Lower Mainland / BC"],
              ["wa", "Washington State / US"],
            ] as [RegionFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setRegion(key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  region === key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Capability</span>
            {CAPABILITY_FILTERS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setCapability(opt.key)}
                className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  capability === opt.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                <opt.icon size={11} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Facility cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedFacility(f)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <p className="mb-1 text-sm font-bold text-slate-900">{f.name}</p>
              <p className="mb-1 text-xs text-slate-500">
                {f.street}, {f.city}, {f.stateOrProvince}
              </p>
              <p className="mb-3 text-xs capitalize text-slate-400">{f.role} · org: {f.orgId}</p>

              {(f.dockContactName || f.dockContactPhone || f.receivingEmail) && (
                <div className="mb-3 space-y-0.5 text-xs text-slate-500">
                  {f.dockContactName && <p>{f.dockContactName}</p>}
                  {f.dockContactPhone && (
                    <p className="flex items-center gap-1">
                      <Phone size={10} /> {f.dockContactPhone}
                    </p>
                  )}
                  {f.receivingEmail && (
                    <p className="flex items-center gap-1">
                      <Mail size={10} /> {f.receivingEmail}
                    </p>
                  )}
                </div>
              )}

              <div className="mb-3 flex items-center gap-4 text-xs text-slate-600">
                <span className="flex items-center gap-1">
                  <Clock size={11} /> {f.receivingHoursStart}–{f.receivingHoursEnd}
                </span>
                <span>{f.maxTrailerLength}</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {f.capabilities.map((c) => (
                  <span key={c} className={`rounded-full px-2 py-0.5 text-xs ${CAPABILITY_BADGE_CLASS[c]}`}>
                    {CAPABILITY_LABEL[c]}
                  </span>
                ))}
                {f.liftgateRequired && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Liftgate required</span>}
                {f.forkliftOnSite && (
                  <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    <ForkliftIcon size={10} /> Forklift on-site
                  </span>
                )}
                {f.twicCardRequired && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">TWIC required</span>}
                {f.addedBy === "operator" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Operator-added</span>}
              </div>

              <p className="mt-3 text-xs text-slate-400">
                {f.freeTimeMinutes} min free · ${f.detentionRateUsdPerHour.toFixed(2)}/hr detention
              </p>
            </button>
          ))}
        </div>

        {!loading && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            {facilities.length === 0 ? "No facilities on file yet — add one with \u201c+ Add Facility SOP.\u201d" : "No facilities match your search or filters."}
          </p>
        )}
      </main>

      {showAddModal && (
        <AddFacilityModal
          onClose={() => setShowAddModal(false)}
          onSaved={(facility) => {
            setFacilities((prev) => [facility, ...prev]);
            setShowAddModal(false);
          }}
        />
      )}

      {editingFacility && (
        <AddFacilityModal
          facility={editingFacility}
          onClose={() => setEditingFacility(undefined)}
          onSaved={(facility) => {
            setFacilities((prev) => prev.map((f) => (f.id === facility.id ? facility : f)));
            setEditingFacility(undefined);
            setSelectedFacility(undefined);
          }}
        />
      )}

      {selectedFacility && (
        <FacilityDetailDrawer
          facility={selectedFacility}
          onClose={() => setSelectedFacility(undefined)}
          onEdit={(facility) => {
            setSelectedFacility(undefined);
            setEditingFacility(facility);
          }}
          onArchived={(facilityId) => {
            setFacilities((prev) => prev.filter((f) => f.id !== facilityId));
            setSelectedFacility(undefined);
          }}
        />
      )}
    </div>
  );
}
