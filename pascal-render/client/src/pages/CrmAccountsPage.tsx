import { useEffect, useState } from "react";
import { Users, Plus, X, Loader2, TrendingUp, ShieldCheck, Building2, FileStack, Truck, Receipt, Warehouse, ChevronRight } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { KpiCard, ProgressBar } from "../components/KpiCard";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import { subdivisionsForCountry } from "../lib/subdivisions";
import { api } from "../config/api";

interface Account {
  id: string;
  orgId: string;
  companyName: string;
  legalEntityName?: string;
  operatingDba?: string;
  addressStreet?: string;
  addressLine2?: string;
  addressCity?: string;
  addressStateOrProvince?: string;
  addressPostalCode?: string;
  addressCountryCode?: string;
  website?: string;
  industry?: string;
  shippingContactName?: string;
  shippingContactEmail?: string;
  shippingContactPhone?: string;
  secondaryContactName?: string;
  secondaryContactEmail?: string;
  secondaryContactPhone?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  operationsManagerName?: string;
  apEmail?: string;
  apPhone?: string;
  apContactName?: string;
  usEin?: string;
  usDotNumber?: string;
  mcFfNumber?: string;
  caBn?: string;
  caBnProgramSuffix?: string;
  mxRfc?: string;
  countryOfIncorporation?: string;
  retainerMonthlyUsd?: number;
  overageRateUsd?: number;
  billingCurrency: string;
  paymentTerms: string;
  houseSpotBenchmarkOptIn: boolean;
  customsBrokerName?: string;
  customsBrokerAccountRef?: string;
  customsBrokerEmail?: string;
  customsBrokerOpsPhone?: string;
  customsPoaStatus?: "active_verified" | "pending_signature" | "exempt";
  defaultPoePreference?: string;
  primaryCommodities: string[];
  requiresReefer: boolean;
  requiresHazmat: boolean;
  preferredCarrierScacs: string[];
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

/** org_id + a short random suffix so two clients with the same/similar
 * name (e.g. two different "Acme Inc") never collide against the real
 * PRIMARY KEY constraint on accounts.org_id. */
function generateOrgId(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 6);
  return slug ? `org_${slug}_${suffix}` : `org_${suffix}`;
}

export function CrmAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [kpis, setKpis] = useState<Kpis | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detail, setDetail] = useState<AccountDetail | undefined>(undefined);
  const [detailTab, setDetailTab] = useState<(typeof DETAIL_TABS)[number]>("overview");
  const [detailLoading, setDetailLoading] = useState(false);

  const [orgId, setOrgId] = useState("");
  const [orgIdManuallyEdited, setOrgIdManuallyEdited] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressStateOrProvince, setAddressStateOrProvince] = useState("");
  const [addressPostalCode, setAddressPostalCode] = useState("");
  const [addressCountryCode, setAddressCountryCode] = useState("US");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [shippingContactName, setShippingContactName] = useState("");
  const [shippingContactEmail, setShippingContactEmail] = useState("");
  const [shippingContactPhone, setShippingContactPhone] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [primaryContactPhone, setPrimaryContactPhone] = useState("");
  const [countryOfIncorporation, setCountryOfIncorporation] = useState("US");
  const [taxIdField, setTaxIdField] = useState("");
  const [usDotNumber, setUsDotNumber] = useState("");
  const [mcFfNumber, setMcFfNumber] = useState("");
  const [caBnProgramSuffix, setCaBnProgramSuffix] = useState("RM0001");
  const [customsBrokerName, setCustomsBrokerName] = useState("");
  const [customsBrokerAccountRef, setCustomsBrokerAccountRef] = useState("");
  const [customsBrokerEmail, setCustomsBrokerEmail] = useState("");
  const [customsBrokerOpsPhone, setCustomsBrokerOpsPhone] = useState("");
  const [customsPoaStatus, setCustomsPoaStatus] = useState<"active_verified" | "pending_signature" | "exempt">("pending_signature");
  const [defaultPoePreference, setDefaultPoePreference] = useState("");
  const [billingCurrency, setBillingCurrency] = useState("USD");
  const [retainerMonthlyUsd, setRetainerMonthlyUsd] = useState("");
  const [overageRateUsd, setOverageRateUsd] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<"net15" | "net30" | "due_upon_receipt">("net30");
  const [apContactName, setApContactName] = useState("");
  const [apEmail, setApEmail] = useState("");
  const [apPhone, setApPhone] = useState("");
  const [secondaryContactName, setSecondaryContactName] = useState("");
  const [secondaryContactEmail, setSecondaryContactEmail] = useState("");
  const [secondaryContactPhone, setSecondaryContactPhone] = useState("");
  const [primaryCommoditiesInput, setPrimaryCommoditiesInput] = useState("");
  const [requiresReefer, setRequiresReefer] = useState(false);
  const [requiresHazmat, setRequiresHazmat] = useState(false);
  const [preferredCarrierScacsInput, setPreferredCarrierScacsInput] = useState("");
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
      const taxField =
        countryOfIncorporation === "US"
          ? { usEin: taxIdField, usDotNumber: usDotNumber || undefined, mcFfNumber: mcFfNumber || undefined }
          : countryOfIncorporation === "CA"
          ? { caBn: taxIdField, caBnProgramSuffix: caBnProgramSuffix || undefined }
          : countryOfIncorporation === "MX"
          ? { mxRfc: taxIdField }
          : {};
      await api.createAccount({
        orgId,
        companyName,
        primaryContactName: primaryContactName || undefined,
        primaryContactEmail: primaryContactEmail || undefined,
        primaryContactPhone: primaryContactPhone || undefined,
        addressStreet: addressStreet || undefined,
        addressLine2: addressLine2 || undefined,
        addressCity: addressCity || undefined,
        addressStateOrProvince: addressStateOrProvince || undefined,
        addressPostalCode: addressPostalCode || undefined,
        addressCountryCode: addressCountryCode || undefined,
        website: website || undefined,
        industry: industry || undefined,
        shippingContactName: shippingContactName || undefined,
        shippingContactEmail: shippingContactEmail || undefined,
        shippingContactPhone: shippingContactPhone || undefined,
        secondaryContactName: secondaryContactName || undefined,
        secondaryContactEmail: secondaryContactEmail || undefined,
        secondaryContactPhone: secondaryContactPhone || undefined,
        countryOfIncorporation,
        billingCurrency,
        retainerMonthlyUsd: retainerMonthlyUsd ? Number(retainerMonthlyUsd) : undefined,
        overageRateUsd: overageRateUsd ? Number(overageRateUsd) : undefined,
        paymentTerms,
        apContactName: apContactName || undefined,
        apEmail: apEmail || undefined,
        apPhone: apPhone || undefined,
        customsBrokerName: customsBrokerName || undefined,
        customsBrokerAccountRef: customsBrokerAccountRef || undefined,
        customsBrokerEmail: customsBrokerEmail || undefined,
        customsBrokerOpsPhone: customsBrokerOpsPhone || undefined,
        customsPoaStatus,
        defaultPoePreference: defaultPoePreference || undefined,
        primaryCommodities: primaryCommoditiesInput.split(",").map((s) => s.trim()).filter(Boolean),
        requiresReefer,
        requiresHazmat,
        preferredCarrierScacs: preferredCarrierScacsInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
        ...taxField,
      });
      setOrgId("");
      setOrgIdManuallyEdited(false);
      setCompanyName("");
      setPrimaryContactName("");
      setAddressStreet("");
      setAddressCity("");
      setAddressStateOrProvince("");
      setAddressPostalCode("");
      setWebsite("");
      setIndustry("");
      setAddressLine2("");
      setShippingContactName("");
      setShippingContactEmail("");
      setShippingContactPhone("");
      setSecondaryContactName("");
      setSecondaryContactEmail("");
      setSecondaryContactPhone("");
      setPrimaryContactEmail("");
      setPrimaryContactPhone("");
      setTaxIdField("");
      setUsDotNumber("");
      setMcFfNumber("");
      setCustomsBrokerName("");
      setCustomsBrokerAccountRef("");
      setCustomsBrokerEmail("");
      setCustomsBrokerOpsPhone("");
      setDefaultPoePreference("");
      setRetainerMonthlyUsd("");
      setOverageRateUsd("");
      setApContactName("");
      setApEmail("");
      setApPhone("");
      setPrimaryCommoditiesInput("");
      setPreferredCarrierScacsInput("");
      setRequiresReefer(false);
      setRequiresHazmat(false);
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
            <KpiCard icon={Building2} label="Managed accounts" value={`${kpis.activeCount} active`} caption={`${kpis.onboardingCount} onboarding`} />

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-slate-500">
                <TrendingUp size={15} />
                <span className="text-[13px] font-mono uppercase tracking-wide">Retainer MRR</span>
              </div>
              <p className="text-lg font-bold text-slate-900">
                ${kpis.mrrByCurrency.USD.toLocaleString()} <span className="text-xs font-normal text-slate-400">USD</span>
              </p>
              <p className="text-[13px] text-slate-400">
                CA${kpis.mrrByCurrency.CAD.toLocaleString()} · MX${kpis.mrrByCurrency.MXN.toLocaleString()}
              </p>
            </div>

            <div className={`rounded-xl border p-4 ${kpis.complianceHealthRatePct < 50 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white shadow-sm"}`}>
              <div className={`mb-1 flex items-center gap-2 ${kpis.complianceHealthRatePct < 50 ? "text-amber-700" : "text-slate-500"}`}>
                <ShieldCheck size={15} />
                <span className="text-[13px] font-mono uppercase tracking-wide">Compliance health rate</span>
              </div>
              <p className={`mb-1.5 text-[28px] font-bold leading-tight ${kpis.complianceHealthRatePct < 50 ? "text-amber-700" : ""}`}>{kpis.complianceHealthRatePct}%</p>
              <ProgressBar percent={kpis.complianceHealthRatePct} colorClass={kpis.complianceHealthRatePct < 50 ? "bg-amber-500" : "bg-emerald-500"} />
              <p className={`mt-1 text-[13px] ${kpis.complianceHealthRatePct < 50 ? "text-amber-600" : "text-slate-400"}`}>Active POA + verified USMCA cert on file</p>
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
                        {detail.account.apPhone && ` · ${detail.account.apPhone}`}
                      </p>
                      <p>
                        <strong>Address:</strong>{" "}
                        {detail.account.addressStreet
                          ? `${detail.account.addressStreet}${detail.account.addressLine2 ? `, ${detail.account.addressLine2}` : ""}, ${detail.account.addressCity ?? ""}, ${detail.account.addressStateOrProvince ?? ""} ${detail.account.addressPostalCode ?? ""}`.replace(/\s+/g, " ").trim()
                          : "—"}
                      </p>
                      {(detail.account.website || detail.account.industry) && (
                        <p>
                          {detail.account.website && <strong>Web:</strong>} {detail.account.website ?? ""}
                          {detail.account.website && detail.account.industry && " · "}
                          {detail.account.industry && <strong>Industry:</strong>} {detail.account.industry ?? ""}
                        </p>
                      )}
                      {detail.account.shippingContactName && (
                        <p>
                          <strong>Shipping contact:</strong> {detail.account.shippingContactName}
                          {detail.account.shippingContactPhone && ` · ${detail.account.shippingContactPhone}`}
                          {detail.account.shippingContactEmail && ` · ${detail.account.shippingContactEmail}`}
                        </p>
                      )}
                      {detail.account.secondaryContactName && (
                        <p>
                          <strong>Secondary contact:</strong> {detail.account.secondaryContactName}
                          {detail.account.secondaryContactPhone && ` · ${detail.account.secondaryContactPhone}`}
                          {detail.account.secondaryContactEmail && ` · ${detail.account.secondaryContactEmail}`}
                        </p>
                      )}
                      <p>
                        <strong>Country of incorporation:</strong> {detail.account.countryOfIncorporation ?? "—"}
                        {detail.account.usEin && ` · EIN ${detail.account.usEin}`}
                        {detail.account.usDotNumber && ` · DOT ${detail.account.usDotNumber}`}
                        {detail.account.mcFfNumber && ` · MC/FF ${detail.account.mcFfNumber}`}
                        {detail.account.caBn && ` · BN ${detail.account.caBn}${detail.account.caBnProgramSuffix ? ` ${detail.account.caBnProgramSuffix}` : ""}`}
                      </p>
                      <p>
                        <strong>Retainer:</strong> {detail.account.billingCurrency} ${detail.account.retainerMonthlyUsd?.toLocaleString() ?? "—"}/mo · {detail.account.paymentTerms}
                        {detail.account.overageRateUsd !== undefined && ` · overage $${detail.account.overageRateUsd}/shipment`}
                      </p>
                      {detail.account.apContactName && (
                        <p>
                          <strong>Billing contact:</strong> {detail.account.apContactName}
                        </p>
                      )}
                      <p>
                        <strong>House spot benchmark opt-in:</strong> {detail.account.houseSpotBenchmarkOptIn ? "Yes" : "No"}
                      </p>

                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="mb-1.5 text-xs font-mono uppercase tracking-wide text-slate-400">Customs Broker &amp; POA</p>
                        <p>
                          <strong>Broker:</strong> {detail.account.customsBrokerName ?? "—"}
                          {detail.account.customsBrokerAccountRef && ` (ref ${detail.account.customsBrokerAccountRef})`}
                        </p>
                        {(detail.account.customsBrokerEmail || detail.account.customsBrokerOpsPhone) && (
                          <p>
                            <strong>Contact:</strong> {detail.account.customsBrokerEmail ?? "—"} {detail.account.customsBrokerOpsPhone && `· ${detail.account.customsBrokerOpsPhone}`}
                          </p>
                        )}
                        <p>
                          <strong>POA status:</strong>{" "}
                          {detail.account.customsPoaStatus === "active_verified"
                            ? "Active & Verified"
                            : detail.account.customsPoaStatus === "pending_signature"
                            ? "Pending Signature"
                            : detail.account.customsPoaStatus === "exempt"
                            ? "Exempt"
                            : "—"}
                          {detail.account.defaultPoePreference && ` · Default POE: ${detail.account.defaultPoePreference}`}
                        </p>
                      </div>

                      {(detail.account.primaryCommodities.length > 0 || detail.account.preferredCarrierScacs.length > 0 || detail.account.requiresReefer || detail.account.requiresHazmat) && (
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <p className="mb-1.5 text-xs font-mono uppercase tracking-wide text-slate-400">Operations Profile</p>
                          {detail.account.primaryCommodities.length > 0 && (
                            <p>
                              <strong>Commodities:</strong> {detail.account.primaryCommodities.join(", ")}
                            </p>
                          )}
                          {detail.account.preferredCarrierScacs.length > 0 && (
                            <p>
                              <strong>Preferred carriers:</strong> {detail.account.preferredCarrierScacs.join(", ")}
                            </p>
                          )}
                          {(detail.account.requiresReefer || detail.account.requiresHazmat) && (
                            <p>
                              {detail.account.requiresReefer && <span className="mr-1 rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-700">Reefer required</span>}
                              {detail.account.requiresHazmat && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">Hazmat required</span>}
                            </p>
                          )}
                        </div>
                      )}
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
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">Add Account</p>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Company</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={companyName}
                    onChange={(e) => {
                      setCompanyName(e.target.value);
                      if (!orgIdManuallyEdited) setOrgId(generateOrgId(e.target.value));
                    }}
                    placeholder="Company legal name"
                    className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="col-span-2">
                    <label className="mb-1 block text-[11px] text-slate-500">Client ID (auto-generated — editable if needed)</label>
                    <div className="flex gap-1">
                      <input
                        value={orgId}
                        onChange={(e) => {
                          setOrgId(e.target.value);
                          setOrgIdManuallyEdited(true);
                        }}
                        placeholder="Type a company name above to generate one"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                      />
                      {orgIdManuallyEdited && (
                        <button
                          type="button"
                          onClick={() => {
                            setOrgId(generateOrgId(companyName));
                            setOrgIdManuallyEdited(false);
                          }}
                          title="Regenerate automatically"
                          className="shrink-0 rounded-md border border-slate-300 px-3 text-xs text-slate-500 hover:bg-slate-50"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                  </div>
                  <input value={primaryContactName} onChange={(e) => setPrimaryContactName(e.target.value)} placeholder="Primary contact name" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={primaryContactEmail} onChange={(e) => setPrimaryContactEmail(e.target.value)} placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={primaryContactPhone} onChange={(e) => setPrimaryContactPhone(e.target.value)} placeholder="Phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Company address & profile */}
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Company Address &amp; Profile</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <AddressAutocompleteInput
                      value={addressStreet}
                      onChange={setAddressStreet}
                      placeholder="Street address"
                      onSelect={(s) => {
                        setAddressStreet(s.streetNumber && s.streetName ? `${s.streetNumber} ${s.streetName}` : s.freeformAddress);
                        if (s.municipality) setAddressCity(s.municipality);
                        if (s.countrySubdivisionCode) setAddressStateOrProvince(s.countrySubdivisionCode);
                        if (s.postalCode) setAddressPostalCode(s.postalCode);
                        if (s.countryCode) setAddressCountryCode(s.countryCode);
                      }}
                    />
                  </div>
                  <input value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Suite / Unit / Floor (optional)" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={addressCity} onChange={(e) => setAddressCity(e.target.value)} placeholder="City" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <select value={addressCountryCode} onChange={(e) => setAddressCountryCode(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                    <option value="US">United States</option>
                    <option value="CA">Canada</option>
                    <option value="MX">Mexico</option>
                  </select>
                  <select value={addressStateOrProvince} onChange={(e) => setAddressStateOrProvince(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Select {addressCountryCode === "CA" ? "province" : "state"}...</option>
                    {subdivisionsForCountry(addressCountryCode).map((sub) => (
                      <option key={sub.code} value={sub.code}>{sub.name}</option>
                    ))}
                  </select>
                  <input value={addressPostalCode} onChange={(e) => setAddressPostalCode(e.target.value)} placeholder="Postal / ZIP code" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Company website" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (e.g. Cold Chain / F&B)" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Secondary contact — a backup when the primary contact is unavailable */}
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Secondary Contact</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={secondaryContactName} onChange={(e) => setSecondaryContactName(e.target.value)} placeholder="Name" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={secondaryContactEmail} onChange={(e) => setSecondaryContactEmail(e.target.value)} placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={secondaryContactPhone} onChange={(e) => setSecondaryContactPhone(e.target.value)} placeholder="Phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Shipping department contact — distinct from the general primary contact and AP/billing contact */}
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Shipping Department Contact</p>
                <p className="mb-2 text-[11px] text-slate-400">Who Pascal coordinates with day-to-day for pickups, appointments, and shipment-specific questions — not necessarily the primary or billing contact.</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={shippingContactName} onChange={(e) => setShippingContactName(e.target.value)} placeholder="Name" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={shippingContactEmail} onChange={(e) => setShippingContactEmail(e.target.value)} placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={shippingContactPhone} onChange={(e) => setShippingContactPhone(e.target.value)} placeholder="Phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Jurisdiction & tax registrations — dynamic by country */}
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Jurisdiction &amp; Tax Registrations</p>
                <select value={countryOfIncorporation} onChange={(e) => setCountryOfIncorporation(e.target.value)} className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="MX">Mexico</option>
                  <option value="INTL">International</option>
                </select>
                {countryOfIncorporation === "US" && (
                  <div className="grid grid-cols-2 gap-2">
                    <input value={taxIdField} onChange={(e) => setTaxIdField(e.target.value)} placeholder="US EIN (12-3456789)" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    <input value={usDotNumber} onChange={(e) => setUsDotNumber(e.target.value)} placeholder="US DOT #" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    <input value={mcFfNumber} onChange={(e) => setMcFfNumber(e.target.value)} placeholder="MC / FF #" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                )}
                {countryOfIncorporation === "CA" && (
                  <div className="grid grid-cols-2 gap-2">
                    <input value={taxIdField} onChange={(e) => setTaxIdField(e.target.value)} placeholder="Business Number (9 digits)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    <input value={caBnProgramSuffix} onChange={(e) => setCaBnProgramSuffix(e.target.value)} placeholder="Program suffix (RM0001)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                )}
                {countryOfIncorporation === "MX" && (
                  <input value={taxIdField} onChange={(e) => setTaxIdField(e.target.value)} placeholder="RFC" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                )}
                {countryOfIncorporation === "INTL" && (
                  <input value={taxIdField} onChange={(e) => setTaxIdField(e.target.value)} placeholder="Tax ID" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                )}
              </div>

              {/* Customs broker of record & POA */}
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Customs Broker of Record &amp; POA</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={customsBrokerName} onChange={(e) => setCustomsBrokerName(e.target.value)} placeholder="Broker name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={customsBrokerAccountRef} onChange={(e) => setCustomsBrokerAccountRef(e.target.value)} placeholder="Account / client ref #" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={customsBrokerEmail} onChange={(e) => setCustomsBrokerEmail(e.target.value)} placeholder="Broker contact email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={customsBrokerOpsPhone} onChange={(e) => setCustomsBrokerOpsPhone(e.target.value)} placeholder="24/7 operations phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <select value={customsPoaStatus} onChange={(e) => setCustomsPoaStatus(e.target.value as typeof customsPoaStatus)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                    <option value="active_verified">POA: Active &amp; Verified</option>
                    <option value="pending_signature">POA: Pending Signature</option>
                    <option value="exempt">POA: Exempt</option>
                  </select>
                  <input value={defaultPoePreference} onChange={(e) => setDefaultPoePreference(e.target.value)} placeholder="Default POE (e.g. Blaine 3004)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Billing, retainer & commercial terms */}
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Billing, Retainer &amp; Commercial Terms</p>
                <div className="mb-2 flex gap-1 rounded-lg border border-slate-200 p-1">
                  {(["USD", "CAD", "MXN"] as const).map((c) => (
                    <button key={c} onClick={() => setBillingCurrency(c)} className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${billingCurrency === c ? "bg-slate-900 text-white" : "text-slate-500"}`}>
                      {c}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={retainerMonthlyUsd} onChange={(e) => setRetainerMonthlyUsd(e.target.value)} placeholder="Retainer ($/mo)" type="number" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={overageRateUsd} onChange={(e) => setOverageRateUsd(e.target.value)} placeholder="Overage rate ($/shipment)" type="number" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value as typeof paymentTerms)} className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
                    <option value="net15">Net 15</option>
                    <option value="net30">Net 30</option>
                    <option value="due_upon_receipt">Due Upon Receipt</option>
                  </select>
                  <input value={apContactName} onChange={(e) => setApContactName(e.target.value)} placeholder="Billing contact name (if different)" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={apEmail} onChange={(e) => setApEmail(e.target.value)} placeholder="AP email (if different)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={apPhone} onChange={(e) => setApPhone(e.target.value)} placeholder="AP phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Operations profile & defaults */}
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Operations Profile &amp; Defaults</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={primaryCommoditiesInput} onChange={(e) => setPrimaryCommoditiesInput(e.target.value)} placeholder="Commodities / HTS Ch. (e.g. Ch. 02, Ch. 84)" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <input value={preferredCarrierScacsInput} onChange={(e) => setPreferredCarrierScacsInput(e.target.value)} placeholder="Preferred carrier SCACs (comma-separated)" className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600">
                    <input type="checkbox" checked={requiresReefer} onChange={(e) => setRequiresReefer(e.target.checked)} className="rounded border-slate-300" />
                    Requires temp-controlled / reefer
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600">
                    <input type="checkbox" checked={requiresHazmat} onChange={(e) => setRequiresHazmat(e.target.checked)} className="rounded border-slate-300" />
                    Requires hazmat
                  </label>
                </div>
              </div>

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
