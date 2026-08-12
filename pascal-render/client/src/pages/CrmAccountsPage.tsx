import { useEffect, useState } from "react";
import { Users, Plus, X, Loader2, TrendingUp, ShieldCheck, Building2, FileStack, Truck, Receipt, Warehouse, ChevronRight } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface Account {
  id: string;
  orgId: string;
  companyName: string;
  legalEntityName?: string;
  operatingDba?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  operationsManagerName?: string;
  apEmail?: string;
  usEin?: string;
  caBn?: string;
  mxRfc?: string;
  countryOfIncorporation?: string;
  retainerMonthlyUsd?: number;
  billingCurrency: string;
  paymentTerms: string;
  houseSpotBenchmarkOptIn: boolean;
  accountStatus: string;
  facilityCount: number;
  poaStatus: string;
  usmcaCertCount: number;
}

interface Kpis {
  activeCount: number;
  onboardingCount: number;
  mrrByCurrency: Record<string, number>;
  complianceHealthRatePct: number;
}

interface AccountDetail {
  account: Account;
  facilities: { id: string; name: string; role: string; city: string; country_code: string }[];
  carrierAccounts: { id: string; carrier_name: string; account_number: string; integration_status: string }[];
  invoices: { invoice_number: string; amount_usd: string; currency: string; status: string }[];
  totalSpendUsd: number;
  agent3SavingsCapturedUsd: number;
  poa: { status: string; expires_at?: string };
  usmcaCertificates: { filename: string; expires_at?: string }[];
}

const STATUS_CLASS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  onboarding: "bg-cyan-100 text-cyan-700",
  suspended: "bg-amber-100 text-amber-700",
  churned: "bg-rose-100 text-rose-700",
};

const POA_LABEL: Record<string, { label: string; class: string }> = {
  active_in_ace_aci: { label: "POA Active - ACE/ACI", class: "bg-emerald-100 text-emerald-700" },
  uploaded_pending_broker_review: { label: "POA Pending Broker Audit", class: "bg-amber-100 text-amber-700" },
  pending_upload: { label: "POA Not On File", class: "bg-slate-100 text-slate-600" },
  expired_needs_renewal: { label: "POA Expired", class: "bg-rose-100 text-rose-700" },
};

const DETAIL_TABS = ["overview", "compliance", "facilities", "freight", "carriers"] as const;
const TAB_LABEL: Record<(typeof DETAIL_TABS)[number], string> = {
  overview: "Overview & Contacts",
  compliance: "Customs Compliance & Vault",
  facilities: "Linked Facility SOPs",
  freight: "Active & Historical Freight",
  carriers: "Assigned Carrier Accounts",
};

export function CrmAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [kpis, setKpis] = useState<Kpis | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState<AccountDetail | undefined>(undefined);
  const [detailTab, setDetailTab] = useState<(typeof DETAIL_TABS)[number]>("overview");
  const [detailLoading, setDetailLoading] = useState(false);

  const [orgId, setOrgId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [primaryContactPhone, setPrimaryContactPhone] = useState("");
  const [countryOfIncorporation, setCountryOfIncorporation] = useState("US");
  const [taxIdField, setTaxIdField] = useState("");
  const [billingCurrency, setBillingCurrency] = useState("USD");
  const [retainerMonthlyUsd, setRetainerMonthlyUsd] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.accounts<{ accounts: Account[] }>(), api.accountKpis<Kpis>()])
      .then(([a, k]) => {
        setAccounts(a.accounts);
        setKpis(k);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openDetail = async (account: Account) => {
    setDetailTab("overview");
    setDetailLoading(true);
    setDetail(undefined);
    try {
      const result = await api.accountDetail<AccountDetail>(account.id);
      setDetail(result);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!orgId.trim() || !companyName.trim()) return;
    setSubmitting(true);
    try {
      const taxField = countryOfIncorporation === "US" ? { usEin: taxIdField } : countryOfIncorporation === "CA" ? { caBn: taxIdField } : countryOfIncorporation === "MX" ? { mxRfc: taxIdField } : {};
      await api.createAccount({
        orgId,
        companyName,
        primaryContactName: primaryContactName || undefined,
        primaryContactEmail: primaryContactEmail || undefined,
        primaryContactPhone: primaryContactPhone || undefined,
        countryOfIncorporation,
        billingCurrency,
        retainerMonthlyUsd: retainerMonthlyUsd ? Number(retainerMonthlyUsd) : undefined,
        ...taxField,
      });
      setOrgId("");
      setCompanyName("");
      setPrimaryContactName("");
      setPrimaryContactEmail("");
      setPrimaryContactPhone("");
      setTaxIdField("");
      setRetainerMonthlyUsd("");
      setModalOpen(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-slate-500" />
            <h1 className="text-xl font-bold">Account Management Hub</h1>
            <span className="ml-2 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Desk #6</span>
          </div>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">
            <Plus size={14} /> Add account
          </button>
        </div>

        {kpis && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-slate-500">
                <Building2 size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">Managed accounts</span>
              </div>
              <p className="text-2xl font-bold">{kpis.activeCount} active</p>
              <p className="text-xs text-slate-400">{kpis.onboardingCount} onboarding</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-1 flex items-center gap-2 text-emerald-700">
                <TrendingUp size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">Retainer MRR</span>
              </div>
              <p className="text-lg font-bold text-emerald-700">
                ${kpis.mrrByCurrency.USD.toLocaleString()} <span className="text-xs font-normal">USD</span>
              </p>
              <p className="text-xs text-emerald-600">
                CA${kpis.mrrByCurrency.CAD.toLocaleString()} · MX${kpis.mrrByCurrency.MXN.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-slate-500">
                <ShieldCheck size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">Compliance health rate</span>
              </div>
              <p className="text-2xl font-bold">{kpis.complianceHealthRatePct}%</p>
              <p className="text-xs text-slate-400">Active POA + verified USMCA cert on file</p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <p className="text-sm font-bold">Accounts {loading && <span className="text-slate-400">(loading...)</span>}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {accounts.map((acc) => {
              const poa = POA_LABEL[acc.poaStatus] ?? POA_LABEL.pending_upload;
              return (
                <button key={acc.id} onClick={() => openDetail(acc)} className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{acc.legalEntityName ?? acc.companyName}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">{acc.orgId}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {acc.primaryContactName} {acc.primaryContactEmail && `· ${acc.primaryContactEmail}`}
                    </p>
                    <p className="text-xs text-slate-400">
                      {acc.usEin && `EIN ${acc.usEin}`} {acc.caBn && `· BN ${acc.caBn}`} {acc.mxRfc && `· RFC ${acc.mxRfc}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <Warehouse size={11} /> {acc.facilityCount}
                  </div>
                  {acc.retainerMonthlyUsd && (
                    <p className="text-sm font-semibold text-slate-800">
                      {acc.billingCurrency} ${acc.retainerMonthlyUsd.toLocaleString()}/mo
                    </p>
                  )}
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${poa.class}`}>{poa.label}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[acc.accountStatus]}`}>{acc.accountStatus}</span>
                  <ChevronRight size={14} className="text-slate-300" />
                </button>
              );
            })}
            {!loading && accounts.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No accounts yet.</p>}
          </div>
        </div>
      </main>

      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDetail(undefined)}>
          <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white" onClick={(e) => e.stopPropagation()}>
            {detailLoading && (
              <div className="flex items-center justify-center p-8">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            )}
            {detail && (
              <>
                <div className="border-b border-slate-200 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-bold">{detail.account.legalEntityName ?? detail.account.companyName}</p>
                    <button onClick={() => setDetail(undefined)} className="text-slate-400 hover:text-slate-700">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="flex gap-1 overflow-x-auto">
                    {DETAIL_TABS.map((t) => (
                      <button key={t} onClick={() => setDetailTab(t)} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${detailTab === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                        {TAB_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-5">
                  {detailTab === "overview" && (
                    <div className="space-y-2 text-xs text-slate-600">
                      <p>
                        <strong>Org ID:</strong> {detail.account.orgId}
                      </p>
                      <p>
                        <strong>Contact:</strong> {detail.account.primaryContactName} · {detail.account.primaryContactEmail}
                      </p>
                      <p>
                        <strong>Ops Manager:</strong> {detail.account.operationsManagerName ?? "—"}
                      </p>
                      <p>
                        <strong>AP:</strong> {detail.account.apEmail ?? "—"}
                      </p>
                      <p>
                        <strong>Country of incorporation:</strong> {detail.account.countryOfIncorporation ?? "—"}
                      </p>
                      <p>
                        <strong>Retainer:</strong> {detail.account.billingCurrency} ${detail.account.retainerMonthlyUsd?.toLocaleString() ?? "—"}/mo · {detail.account.paymentTerms}
                      </p>
                      <p>
                        <strong>House spot benchmark opt-in:</strong> {detail.account.houseSpotBenchmarkOptIn ? "Yes" : "No"}
                      </p>
                    </div>
                  )}

                  {detailTab === "compliance" && (
                    <div className="space-y-3">
                      <div className={`rounded-lg p-3 ${POA_LABEL[detail.poa.status]?.class ?? "bg-slate-100"}`}>
                        <p className="text-xs font-semibold">{POA_LABEL[detail.poa.status]?.label ?? detail.poa.status}</p>
                        {detail.poa.expires_at && <p className="text-xs">Expires {new Date(detail.poa.expires_at).toLocaleDateString()}</p>}
                      </div>
                      <p className="text-xs font-mono uppercase tracking-wide text-slate-500">USMCA certificates</p>
                      {detail.usmcaCertificates.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-md border border-slate-200 p-2 text-xs">
                          <FileStack size={12} className="text-slate-400" /> {c.filename}
                        </div>
                      ))}
                      {detail.usmcaCertificates.length === 0 && <p className="text-xs text-slate-400">No USMCA certificates on file.</p>}
                    </div>
                  )}

                  {detailTab === "facilities" && (
                    <div className="space-y-2">
                      {detail.facilities.map((f) => (
                        <div key={f.id} className="rounded-md border border-slate-200 p-2.5 text-xs">
                          <p className="font-semibold text-slate-800">{f.name}</p>
                          <p className="text-slate-500 capitalize">
                            {f.role} · {f.city}, {f.country_code}
                          </p>
                        </div>
                      ))}
                      {detail.facilities.length === 0 && <p className="text-xs text-slate-400">No linked facilities.</p>}
                    </div>
                  )}

                  {detailTab === "freight" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">Total spend</p>
                          <p className="text-sm font-bold text-slate-900">${detail.totalSpendUsd.toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 p-3">
                          <p className="text-xs text-emerald-600">Agent 3 savings captured</p>
                          <p className="text-sm font-bold text-emerald-700">${detail.agent3SavingsCapturedUsd.toLocaleString()}</p>
                        </div>
                      </div>
                      <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Invoices</p>
                      {detail.invoices.map((inv) => (
                        <div key={inv.invoice_number} className="flex items-center gap-2 rounded-md border border-slate-200 p-2 text-xs">
                          <Receipt size={12} className="text-slate-400" /> {inv.invoice_number} · {inv.currency} ${Number(inv.amount_usd).toLocaleString()} · {inv.status}
                        </div>
                      ))}
                    </div>
                  )}

                  {detailTab === "carriers" && (
                    <div className="space-y-2">
                      {detail.carrierAccounts.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 rounded-md border border-slate-200 p-2.5 text-xs">
                          <Truck size={12} className="text-slate-400" /> {c.carrier_name} · {c.account_number} · {c.integration_status.replace(/_/g, " ")}
                        </div>
                      ))}
                      {detail.carrierAccounts.length === 0 && <p className="text-xs text-slate-400">No linked carrier accounts.</p>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">Add Account</p>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company legal name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org_id (e.g. org_newclient)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input value={primaryContactName} onChange={(e) => setPrimaryContactName(e.target.value)} placeholder="Primary contact name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input value={primaryContactEmail} onChange={(e) => setPrimaryContactEmail(e.target.value)} placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <input value={primaryContactPhone} onChange={(e) => setPrimaryContactPhone(e.target.value)} placeholder="Phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <select value={countryOfIncorporation} onChange={(e) => setCountryOfIncorporation(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="MX">Mexico</option>
                <option value="INTL">International</option>
              </select>
              <input
                value={taxIdField}
                onChange={(e) => setTaxIdField(e.target.value)}
                placeholder={countryOfIncorporation === "US" ? "US EIN" : countryOfIncorporation === "CA" ? "Canadian BN" : countryOfIncorporation === "MX" ? "Mexican RFC" : "Tax ID"}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-1 rounded-lg border border-slate-200 p-1">
                {(["USD", "CAD", "MXN"] as const).map((c) => (
                  <button key={c} onClick={() => setBillingCurrency(c)} className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${billingCurrency === c ? "bg-slate-900 text-white" : "text-slate-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
              <input value={retainerMonthlyUsd} onChange={(e) => setRetainerMonthlyUsd(e.target.value)} placeholder="Monthly retainer amount" type="number" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={handleAdd} disabled={submitting} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
