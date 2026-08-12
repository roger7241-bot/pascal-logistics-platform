import { useEffect, useState } from "react";
import { Warehouse, Clock, Truck as ForkliftIcon } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface Facility {
  id: string;
  name: string;
  role: string;
  street: string;
  city: string;
  dockHeight: boolean;
  liftgateRequired: boolean;
  forkliftOnSite: boolean;
  maxTrailerLength: string;
  receivingHoursStart: string;
  receivingHoursEnd: string;
  appointmentRequired: boolean;
  twicCardRequired: boolean;
}

export function FacilitySopDirectoryPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .facilities<{ facilities: Facility[] }>()
      .then((d) => setFacilities(d.facilities))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] p-6">
        <div className="mb-4 flex items-center gap-2">
          <Warehouse size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Facility SOP Directory</h1>
          {loading && <span className="text-xs text-slate-400">(loading...)</span>}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {facilities.map((f) => (
            <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-1 text-sm font-bold text-slate-900">{f.name}</p>
              <p className="mb-3 text-xs text-slate-500 capitalize">
                {f.role} · {f.street}, {f.city}
              </p>
              <div className="mb-3 flex items-center gap-4 text-xs text-slate-600">
                <span className="flex items-center gap-1">
                  <Clock size={11} /> {f.receivingHoursStart}–{f.receivingHoursEnd}
                </span>
                <span>{f.maxTrailerLength}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {f.dockHeight && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Dock height</span>}
                {f.liftgateRequired && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Liftgate required</span>}
                {f.forkliftOnSite && (
                  <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    <ForkliftIcon size={10} /> Forklift on-site
                  </span>
                )}
                {f.appointmentRequired && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs text-cyan-700">Appointment required</span>}
                {f.twicCardRequired && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">TWIC required</span>}
              </div>
            </div>
          ))}
        </div>
        {!loading && facilities.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No facilities on file yet — added via the Client Portal's Operational Baseline setup.</p>}
      </main>
    </div>
  );
}
