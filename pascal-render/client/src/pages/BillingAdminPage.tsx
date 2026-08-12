import { useEffect, useState } from "react";
import { Receipt, Plus, X, Loader2, Download, Send, ShieldCheck, ShieldAlert, FileCheck, FileX, TrendingUp, Gauge, Search } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface Invoice {
  id: string;
  invoiceNumber: string;
  shipmentId?: string;
  amountUsd: number;
  currency: string;
  clientEntity?: string;
  status: string;
  podStatus: string;
  disputeFlags?: string[];
  displayAmount?: number;
}

interface Kpis {
  mrrDisplay: number;
  displayCurrency: string;
  auditHealthScorePct: number;
  fxRates: { isLive: boolean; source: string; fetchedAtIso: string };
}

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-sky-100 text-sky-700",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-rose-100 text-rose-700",
  disputed: "bg-amber-100 text-amber-700",
};

const CURRENCY_SYMBOL: Record<string, string> = { CAD: "CA$", USD: "US$", MXN: "MX$" };
const TAX_ID_LABEL: Record<string, string> = { CA_BN_GST_PST: "Canadian BN/GST/PST", US_EIN: "US EIN", MX_RFC: "Mexican RFC" };

export function BillingAdminPage() {
  const [currency, setCurrency] = useState<"CAD" | "USD" | "MXN">("USD");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [kpis, setKpis] = useState<Kpis | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [auditingId, setAuditingId] = useState<string | undefined>(undefined);

  const [orgId, setOrgId] = useState("org_meridian");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [shipmentId, setShipmentId] = useState("");
  const [newCurrency, setNewCurrency] = useState<"CAD" | "USD" | "MXN">("USD");
  const [clientEntity, setClientEntity] = useState("");
  const [taxIdType, setTaxIdType] = useState("US_EIN");
  const [taxId, setTaxId] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("net30");
  const [linehaul, setLinehaul] = useState("");
  const [customsBrokerage, setCustomsBrokerage] = useState("");
  const [accessorials, setAccessorials] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.invoices<{ invoices: Invoice[] }>(currency), api.billingKpis<Kpis>(currency)])
      .then(([inv, k]) => {
        setInvoices(inv.invoices);
        setKpis(k);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [currency]);

  const filteredInvoices = invoices.filter((inv) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return `${inv.invoiceNumber} ${inv.clientEntity ?? ""} ${inv.shipmentId ?? ""}`.toLowerCase().includes(q);
  });

  const handleCreate = async () => {
    if (!invoiceNumber.trim()) return;
    setSubmitting(true);
    try {
      const rawItems: Array<{ label: string; amount: number } | false> = [
        linehaul ? { label: "Base Linehaul / Freight", amount: Number(linehaul) } : false,
        customsBrokerage ? { label: "Customs Brokerage & Entry Fees", amount: Number(customsBrokerage) } : false,
        accessorials ? { label: "Accessorial Charges", amount: Number(accessorials) } : false,
      ];
      const lineItems = rawItems.filter((x): x is { label: string; amount: number } => x !== false);
      const total = lineItems.reduce((sum, item) => sum + item.amount, 0);

      await api.createInvoice({
        orgId,
        invoiceNumber,
        shipmentId: shipmentId || undefined,
        amountUsd: total || 0,
        currency: newCurrency,
        clientEntity: clientEntity || undefined,
        taxId: taxId || undefined,
        taxIdType: taxId ? taxIdType : undefined,
        paymentTerms,
        lineItems: lineItems.length ? lineItems : undefined,
      });
      setInvoiceNumber("");
      setShipmentId("");
      setClientEntity("");
      setTaxId("");
      setLinehaul("");
      setCustomsBrokerage("");
      setAccessorials("");
      setModalOpen(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    await api.updateInvoiceStatus(id, status);
    load();
  };

  const handleAudit = async (id: string) => {
    setAuditingId(id);
    try {
      await api.auditInvoice(id);
      load();
    } finally {
      setAuditingId(undefined);
    }
  };

  const handleDownloadPdf = (id: string) => {
    window.open(`${import.meta.env.VITE_API_BASE_URL}/api/operator/invoices/${id}/pdf`, "_blank");
  };

  const handleQuickPay = async (id: string) => {
    const result = await api.sendQuickPayLink<{ payLink: string }>(id);
    window.prompt("Quick Pay link generated (copy below):", result.payLink);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt size={18} className="text-slate-500" />
            <h1 className="text-xl font-bold">Financial Command Center</h1>
            <span className="ml-2 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Agent 8 Desk</span>
          </div>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">
            <Plus size={14} /> New Invoice
          </button>
        </div>

        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {(["CAD", "USD", "MXN"] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} className={`flex-1 rounded-md py-2 text-xs font-semibold ${currency === c ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
              {CURRENCY_SYMBOL[c]} {c}
            </button>
          ))}
        </div>

        {kpis && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-1 flex items-center gap-2 text-emerald-700">
                <TrendingUp size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">MRR ({kpis.displayCurrency})</span>
              </div>
              <p className="text-2xl font-bold text-emerald-700">
                {CURRENCY_SYMBOL[kpis.displayCurrency]}
                {kpis.mrrDisplay.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-slate-500">
                <Gauge size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">Audit health score</span>
              </div>
              <p className="text-2xl font-bold">{kpis.auditHealthScorePct}%</p>
              <p className="text-xs text-slate-400">Verified POD + no disputes</p>
            </div>
            <div className={`rounded-xl border p-4 ${kpis.fxRates.isLive ? "border-slate-200 bg-white shadow-sm" : "border-amber-200 bg-amber-50"}`}>
              <div className={`mb-1 flex items-center gap-2 ${kpis.fxRates.isLive ? "text-slate-500" : "text-amber-700"}`}>
                {kpis.fxRates.isLive ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                <span className="text-xs font-mono uppercase tracking-wide">FX rate source</span>
              </div>
              <p className={`text-xs font-semibold ${kpis.fxRates.isLive ? "text-slate-700" : "text-amber-700"}`}>{kpis.fxRates.isLive ? "Live" : "Static fallback"}</p>
              <p className="text-xs text-slate-400">{kpis.fxRates.source}</p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoices..." className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm" />
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {filteredInvoices.map((inv) => (
              <div key={inv.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-mono text-sm font-bold text-slate-900">{inv.invoiceNumber}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{inv.currency}</span>
                  <p className="text-xs text-slate-500">{inv.clientEntity}</p>
                  {inv.shipmentId && <p className="font-mono text-xs text-slate-400">{inv.shipmentId}</p>}
                  <p className="text-sm font-semibold text-slate-800">
                    {CURRENCY_SYMBOL[currency]}
                    {(inv.displayAmount ?? inv.amountUsd).toLocaleString()}
                  </p>
                  <select value={inv.status} onChange={(e) => handleStatusChange(inv.id, e.target.value)} className={`rounded-full border-none px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[inv.status]}`}>
                    <option value="draft">Draft</option>
                    <option value="sent">Issued / Pending</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                    <option value="disputed">Disputed</option>
                  </select>
                  {inv.podStatus === "verified" ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                      <FileCheck size={11} /> POD Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-rose-600">
                      <FileX size={11} /> Missing POD
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => handleAudit(inv.id)} disabled={auditingId === inv.id} className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      {auditingId === inv.id ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Audit
                    </button>
                    <button onClick={() => handleDownloadPdf(inv.id)} className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      <Download size={11} /> PDF
                    </button>
                    <button onClick={() => handleQuickPay(inv.id)} className="flex items-center gap-1 rounded-md border border-cyan-300 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-100">
                      <Send size={11} /> Quick Pay
                    </button>
                  </div>
                </div>
                {inv.disputeFlags && inv.disputeFlags.length > 0 && (
                  <div className="mt-2 rounded-md bg-amber-50 p-2">
                    {inv.disputeFlags.map((flag, i) => (
                      <p key={i} className="text-xs text-amber-700">
                        ⚠ {flag}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!loading && filteredInvoices.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No invoices match.</p>}
          </div>
        </div>
      </main>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">Create Cross-Border Invoice</p>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="Client org ID" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Invoice number" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <input value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} placeholder="Bound Shipment ID (or retainer account)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input value={clientEntity} onChange={(e) => setClientEntity(e.target.value)} placeholder="Client entity name (regional)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />

              <div className="flex gap-1 rounded-lg border border-slate-200 p-1">
                {(["CAD", "USD", "MXN"] as const).map((c) => (
                  <button key={c} onClick={() => setNewCurrency(c)} className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${newCurrency === c ? "bg-slate-900 text-white" : "text-slate-500"}`}>
                    {CURRENCY_SYMBOL[c]} {c}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select value={taxIdType} onChange={(e) => setTaxIdType(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  {Object.entries(TAX_ID_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Tax ID" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="net15">Net 15</option>
                <option value="net30">Net 30</option>
              </select>

              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">Line items</p>
              <input value={linehaul} onChange={(e) => setLinehaul(e.target.value)} placeholder="Base Linehaul / Freight Charges" type="number" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input
                value={customsBrokerage}
                onChange={(e) => setCustomsBrokerage(e.target.value)}
                placeholder="Customs Brokerage & Entry Fees (PAPS/PARS/Pedimento)"
                type="number"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={accessorials}
                onChange={(e) => setAccessorials(e.target.value)}
                placeholder="Accessorial Charges (Detention, Demurrage, Liftgate...)"
                type="number"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />

              <button onClick={handleCreate} disabled={submitting} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
