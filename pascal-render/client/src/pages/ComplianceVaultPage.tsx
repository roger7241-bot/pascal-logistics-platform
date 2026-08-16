import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, FileText, Loader2 } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { api } from "../config/api";

interface PoaRecord {
  status: string;
  brokerName?: string;
  brokerEmail?: string;
  expiresAtIso?: string;
}

interface VaultDocument {
  id: string;
  filename: string;
  category: string;
  uploadedAt: string;
}

const POA_STATUS_LABEL: Record<string, string> = {
  pending_upload: "Pending Upload",
  uploaded_pending_broker_review: "Uploaded — Pending Broker Review",
  active_in_ace_aci: "Active in ACE/ACI",
  expired_needs_renewal: "Expired — Needs Renewal",
};

const POA_STATUS_CLASS: Record<string, string> = {
  pending_upload: "bg-slate-100 text-slate-600",
  uploaded_pending_broker_review: "bg-amber-100 text-amber-700",
  active_in_ace_aci: "bg-emerald-100 text-emerald-700",
  expired_needs_renewal: "bg-rose-100 text-rose-700",
};

export function ComplianceVaultPage() {
  const [poa, setPoa] = useState<PoaRecord | undefined>(undefined);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.poaStatus<PoaRecord>(),
      fetch(`${import.meta.env.VITE_API_BASE_URL}/api/operator/vault?orgId=org_meridian`, { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([poaResult, vaultResult]) => {
        setPoa(poaResult);
        setDocuments(vaultResult.documents ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const usmcaCerts = documents.filter((d) => d.category === "usmca_certificate");
  const poaDocs = documents.filter((d) => d.category === "poa");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-slate-500" />
          <h1 className="text-xl font-bold">Customs Compliance &amp; USMCA Vault</h1>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading compliance status...
          </p>
        )}

        {poa && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-xs font-mono uppercase tracking-wide text-slate-500">Customs Power of Attorney</p>
            <div className="flex items-center gap-3">
              {poa.status === "active_in_ace_aci" ? (
                <ShieldCheck size={20} className="text-emerald-500" />
              ) : (
                <ShieldAlert size={20} className="text-amber-500" />
              )}
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${POA_STATUS_CLASS[poa.status]}`}>{POA_STATUS_LABEL[poa.status]}</span>
            </div>
            {poa.brokerName && <p className="mt-2 text-xs text-slate-500">Broker of record: {poa.brokerName}</p>}
            {poa.expiresAtIso && <p className="text-xs text-slate-500">Expires: {new Date(poa.expiresAtIso).toLocaleDateString()}</p>}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold">USMCA/CUSMA Certificates on File</p>
          </div>
          <div className="divide-y divide-slate-100">
            {usmcaCerts.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5">
                <FileText size={14} className="text-slate-400" />
                <p className="text-sm text-slate-800">{doc.filename}</p>
              </div>
            ))}
            {usmcaCerts.length === 0 && !loading && <p className="px-5 py-6 text-center text-sm text-slate-400">No USMCA certificates on file yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold">POA Documents on File</p>
          </div>
          <div className="divide-y divide-slate-100">
            {poaDocs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5">
                <FileText size={14} className="text-slate-400" />
                <p className="text-sm text-slate-800">{doc.filename}</p>
              </div>
            ))}
            {poaDocs.length === 0 && !loading && <p className="px-5 py-6 text-center text-sm text-slate-400">No POA documents uploaded yet.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
