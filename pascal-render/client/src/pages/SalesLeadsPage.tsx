import { useEffect, useState } from "react";
import {
  Megaphone,
  Plus,
  X,
  Loader2,
  TrendingUp,
  Users,
  Clock,
  LayoutGrid,
  Table as TableIcon,
  Mail,
  Calculator,
  UserPlus,
  Linkedin,
  Inbox,
  Phone,
  Share2,
  Globe,
} from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api } from "../config/api";

interface Lead {
  id: string;
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  stage: string;
  estimatedAnnualValueUsd?: number;
  primaryTransportMode?: string;
  targetBorderCrossing?: string;
  legalEntity?: string;
  operatingRegions?: string;
  commodities?: string;
  targetLanes?: string;
  estimatedMonthlyVolume?: string;
  leadChannel?: string;
}

interface Kpis {
  activePipelineValueUsd: number;
  monthlyQualifiedLeads: number;
  winRatePct?: number;
  avgSalesVelocityDays?: number;
  dataNote?: string;
}

const STAGES = [
  { key: "new_unqualified", label: "New Leads / Unqualified" },
  { key: "discovery_sop_review", label: "Discovery & SOP Review" },
  { key: "rfq_issued", label: "RFQ / Rate Quote Issued" },
  { key: "retainer_sent", label: "Retainer Contract Sent" },
  { key: "closed_won", label: "Closed - Won / Onboarding" },
] as const;

const CHANNEL_CONFIG: Record<string, { label: string; icon: typeof Linkedin; class: string }> = {
  linkedin_inmail: { label: "LinkedIn InMail", icon: Linkedin, class: "bg-sky-100 text-sky-700" },
  inbound_rfq: { label: "Inbound RFQ", icon: Inbox, class: "bg-violet-100 text-violet-700" },
  cold_outreach: { label: "Cold Outreach", icon: Phone, class: "bg-slate-100 text-slate-600" },
  referral: { label: "Referral", icon: Share2, class: "bg-emerald-100 text-emerald-700" },
  web_intake: { label: "Web Intake", icon: Globe, class: "bg-amber-100 text-amber-700" },
};

export function SalesLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [kpis, setKpis] = useState<Kpis | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<Lead | undefined>(undefined);

  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [leadChannel, setLeadChannel] = useState("web_intake");
  const [estimatedAnnualValueUsd, setEstimatedAnnualValueUsd] = useState("");
  const [primaryTransportMode, setPrimaryTransportMode] = useState("road");
  const [targetBorderCrossing, setTargetBorderCrossing] = useState("pacific_highway");
  const [submitting, setSubmitting] = useState(false);

  const [aiBusy, setAiBusy] = useState<string | undefined>(undefined);
  const [aiResult, setAiResult] = useState<{ type: string; content: string } | undefined>(undefined);

  const load = () => {
    setLoading(true);
    Promise.all([api.leads<{ leads: Lead[] }>(), api.leadPipelineKpis<Kpis>()])
      .then(([l, k]) => {
        setLeads(l.leads);
        setKpis(k);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleAdd = async () => {
    if (!companyName.trim()) return;
    setSubmitting(true);
    try {
      await api.createLead({
        companyName,
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        leadChannel,
        estimatedAnnualValueUsd: estimatedAnnualValueUsd ? Number(estimatedAnnualValueUsd) : undefined,
        primaryTransportMode,
        targetBorderCrossing,
      });
      setCompanyName("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setEstimatedAnnualValueUsd("");
      setAddModalOpen(false);
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleStageChange = async (id: string, stage: string) => {
    await api.updateLeadStage(id, stage);
    load();
    if (detailLead?.id === id) setDetailLead(undefined);
  };

  const handleDraftEmail = async (id: string) => {
    setAiBusy("email");
    setAiResult(undefined);
    try {
      const result = await api.draftIntroEmail<{ subject: string; body: string }>(id);
      setAiResult({ type: "email", content: `Subject: ${result.subject}\n\n${result.body}` });
    } finally {
      setAiBusy(undefined);
    }
  };

  const handleSavingsProposal = async (id: string) => {
    setAiBusy("proposal");
    setAiResult(undefined);
    try {
      const result = await api.generateSavingsProposal<{ perShipmentContractedUsd: number; perShipmentSpotBenchmarkUsd: number; monthlySavingsUsd: number; annualSavingsUsd: number }>(id);
      setAiResult({
        type: "proposal",
        content: `Contracted: $${result.perShipmentContractedUsd}/shipment vs Spot: $${result.perShipmentSpotBenchmarkUsd}/shipment\nEstimated monthly savings: $${result.monthlySavingsUsd.toLocaleString()}\nEstimated annual savings: $${result.annualSavingsUsd.toLocaleString()}`,
      });
    } finally {
      setAiBusy(undefined);
    }
  };

  const handleConvert = async (id: string) => {
    const orgId = window.prompt("New account org ID (e.g. org_newclient):");
    if (!orgId) return;
    setAiBusy("convert");
    try {
      await api.convertLeadToAccount(id, orgId);
      setDetailLead(undefined);
      load();
    } finally {
      setAiBusy(undefined);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-slate-500" />
            <h1 className="text-xl font-bold">Sales Pipeline &amp; RFQ Command Center</h1>
            <span className="ml-2 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Agent 10 Desk</span>
          </div>
          <button onClick={() => setAddModalOpen(true)} className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500">
            <Plus size={14} /> Add Lead / RFQ
          </button>
        </div>

        {kpis && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-1 flex items-center gap-2 text-emerald-700">
                <TrendingUp size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">Active pipeline value</span>
              </div>
              <p className="text-2xl font-bold text-emerald-700">${kpis.activePipelineValueUsd.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-slate-500">
                <Users size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">Monthly qualified leads</span>
              </div>
              <p className="text-2xl font-bold">{kpis.monthlyQualifiedLeads}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-slate-500">
                <Clock size={14} />
                <span className="text-xs font-mono uppercase tracking-wide">Win rate / velocity</span>
              </div>
              <p className="text-2xl font-bold">
                {kpis.winRatePct !== undefined ? `${kpis.winRatePct}%` : "—"} <span className="text-sm font-normal text-slate-400">/ {kpis.avgSalesVelocityDays !== undefined ? `${kpis.avgSalesVelocityDays}d` : "—"}</span>
              </p>
              {kpis.dataNote && <p className="mt-1 text-xs text-slate-400">{kpis.dataNote}</p>}
            </div>
          </div>
        )}

        <div className="flex w-fit gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button onClick={() => setView("kanban")} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${view === "kanban" ? "bg-slate-900 text-white" : "text-slate-500"}`}>
            <LayoutGrid size={12} /> Kanban Board
          </button>
          <button onClick={() => setView("table")} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${view === "table" ? "bg-slate-900 text-white" : "text-slate-500"}`}>
            <TableIcon size={12} /> Detailed Table
          </button>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading pipeline...
          </p>
        )}

        {!loading && view === "kanban" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {STAGES.map((s) => (
              <div key={s.key} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-3 py-2.5">
                  <p className="text-xs font-bold text-slate-700">{s.label}</p>
                  <p className="text-xs text-slate-400">{leads.filter((l) => l.stage === s.key).length} leads</p>
                </div>
                <div className="space-y-2 p-2">
                  {leads
                    .filter((l) => l.stage === s.key)
                    .map((lead) => {
                      const channel = lead.leadChannel ? CHANNEL_CONFIG[lead.leadChannel] : undefined;
                      const ChannelIcon = channel?.icon;
                      return (
                        <button key={lead.id} onClick={() => setDetailLead(lead)} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-left hover:border-cyan-300">
                          <p className="text-xs font-bold text-slate-900">{lead.companyName}</p>
                          {lead.estimatedAnnualValueUsd && <p className="text-xs text-emerald-600">${lead.estimatedAnnualValueUsd.toLocaleString()}/yr</p>}
                          {channel && ChannelIcon && (
                            <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${channel.class}`}>
                              <ChannelIcon size={9} /> {channel.label}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && view === "table" && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {leads.map((lead) => {
                const channel = lead.leadChannel ? CHANNEL_CONFIG[lead.leadChannel] : undefined;
                return (
                  <button key={lead.id} onClick={() => setDetailLead(lead)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                    <p className="flex-1 text-sm font-semibold text-slate-900">{lead.companyName}</p>
                    <p className="text-xs text-slate-500">{lead.contactName}</p>
                    {lead.estimatedAnnualValueUsd && <p className="text-xs font-semibold text-emerald-600">${lead.estimatedAnnualValueUsd.toLocaleString()}/yr</p>}
                    {channel && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${channel.class}`}>{channel.label}</span>}
                    <select
                      value={lead.stage}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleStageChange(lead.id, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      {STAGES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                      <option value="lost">Lost</option>
                    </select>
                  </button>
                );
              })}
              {leads.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No leads yet.</p>}
            </div>
          </div>
        )}
      </main>

      {detailLead && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => {
            setDetailLead(undefined);
            setAiResult(undefined);
          }}
        >
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">{detailLead.companyName}</p>
              <button
                onClick={() => {
                  setDetailLead(undefined);
                  setAiResult(undefined);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mb-4 space-y-1 text-xs text-slate-600">
              <p>
                <strong>Contact:</strong> {detailLead.contactName ?? "—"} {detailLead.contactEmail && `· ${detailLead.contactEmail}`}
              </p>
              <p>
                <strong>Regions:</strong> {detailLead.operatingRegions ?? "—"}
              </p>
              <p>
                <strong>Commodities:</strong> {detailLead.commodities ?? "—"}
              </p>
              <p>
                <strong>Target lanes:</strong> {detailLead.targetLanes ?? "—"}
              </p>
              <p>
                <strong>Est. volume:</strong> {detailLead.estimatedMonthlyVolume ?? "—"}
              </p>
              <p>
                <strong>Mode:</strong> {detailLead.primaryTransportMode ?? "—"} · <strong>Crossing:</strong> {detailLead.targetBorderCrossing?.replace(/_/g, " ") ?? "—"}
              </p>
            </div>

            <p className="mb-2 text-xs font-mono uppercase tracking-wide text-slate-500">Agent 10 AI Assistant Actions</p>
            <div className="space-y-2">
              <button onClick={() => handleDraftEmail(detailLead.id)} disabled={!!aiBusy} className="flex w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {aiBusy === "email" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Draft AI Intro Email
              </button>
              <button onClick={() => handleSavingsProposal(detailLead.id)} disabled={!!aiBusy} className="flex w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {aiBusy === "proposal" ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />} Generate Cross-Border Savings Proposal
              </button>
              <button onClick={() => handleConvert(detailLead.id)} disabled={!!aiBusy} className="flex w-full items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                {aiBusy === "convert" ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Convert to Client Account
              </button>
            </div>

            {aiResult && <div className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">{aiResult.content}</div>}
          </div>
        </div>
      )}

      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAddModalOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold">Add Lead / RFQ</p>
              <button onClick={() => setAddModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Primary contact name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <select value={leadChannel} onChange={(e) => setLeadChannel(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                {Object.entries(CHANNEL_CONFIG).map(([v, c]) => (
                  <option key={v} value={v}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                value={estimatedAnnualValueUsd}
                onChange={(e) => setEstimatedAnnualValueUsd(e.target.value)}
                placeholder="Estimated monthly freight spend x12 (annual value, USD)"
                type="number"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <select value={primaryTransportMode} onChange={(e) => setPrimaryTransportMode(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="road">Road</option>
                <option value="ocean">Ocean</option>
                <option value="air">Air</option>
              </select>
              <select value={targetBorderCrossing} onChange={(e) => setTargetBorderCrossing(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="pacific_highway">Pacific Highway / Blaine</option>
                <option value="sumas">Sumas / Abbotsford</option>
                <option value="aldergrove">Aldergrove / Lynden</option>
              </select>
              <button onClick={handleAdd} disabled={submitting} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add lead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
