// ============================================================================
// AgentsPage
// Operator observability + review surface for every AI agent in the org.
// Grid at top shows all 15 agents (9 client-facing + 6 back-office).
// Tabbed simulate section (Chief of Staff, Booking, Customs, Vetting,
// Claims). Review queue below is agent-aware and renders draft-type
// specific detail (broker + packet issues, carrier + red flags,
// claim value + filing window, etc.).
// ============================================================================

import { useEffect, useState } from "react";
import { Cpu, Bot, CheckCircle2, XCircle, Inbox, Loader2, Send, Edit3, Archive, MessageSquarePlus, Sparkles, AlertCircle, Truck, ShieldCheck, ShieldAlert, PackageX, DollarSign, Megaphone, CalendarClock, GitBranch, ArrowRight, Play, ClipboardList } from "lucide-react";
import { OperatorHeader } from "../components/OperatorHeader";
import { api, ApiError } from "../config/api";

interface AgentRow {
  agentKey: string;
  agentNumber: number;
  name: string;
  role: "Client-facing" | "Back-office";
  description: string;
  status: "active" | "planned" | "paused" | "deprecated";
  humanInLoop: boolean;
  lastRunAtIso?: string;
  lastRunStatus?: string;
  pendingDrafts: number;
}

interface DraftOutputBase {
  category: string;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  simulated: boolean;
}
interface ChiefPayload {
  inbound: { fromEmail: string; fromName?: string; subject: string; body: string };
  output: DraftOutputBase;
}
interface BookingPayload {
  event: { shipmentRef: string; carrier: string; origin: string; destination: string; eventType: string; eventDetail: string };
  output: DraftOutputBase;
}
interface CustomsPayload {
  event: { shipmentRef: string; direction: string; brokerName: string; eventType: string; entryNumber?: string };
  output: DraftOutputBase & { docPacketIssues: string[]; recipientRole: "broker" | "client" | "internal" };
}
interface VettingPayload {
  request: { carrierName: string; mcNumber?: string; dotNumber?: string; eventType: string };
  output: DraftOutputBase & { decision: "allow" | "conditional" | "block"; redFlags: string[]; recipientRole: "carrier" | "internal" };
}
interface ClaimsPayload {
  event: { shipmentRef: string; mode: string; carrier: string; eventType: string; deliveredAtIso?: string };
  output: DraftOutputBase & { stage: string; claimValueUsd: number; filingWindowDays: number; documentationGaps: string[]; recipientRole: "carrier" | "client" | "internal" };
}
interface FinancePayload {
  event: { clientName: string; eventType: string; invoiceNumber?: string; amountUsd?: number; currency?: string; daysPastDue?: number };
  output: DraftOutputBase & { amountUsd: number; recipientRole: "client" | "internal" };
}
interface MarketingPayload {
  brief: { format: string; audience: string; topic: string };
  output: DraftOutputBase & { hashtags: string[]; recipientRole: "external" | "internal" };
}
interface EaPayload {
  request: { eventType: string; contactName?: string; contactCompany?: string; requestDetail: string; meetingWhenIso?: string };
  output: DraftOutputBase & { recipientRole: "prospect" | "client" | "internal" };
}

interface PlaybookRow {
  key: string;
  name: string;
  trigger: string;
  quarterback: "agent6_chief_of_staff" | "agent7_executive_assist";
  clientVisible: boolean;
  stepCount: number;
  steps: { agentKey: string; action: string; gateForReview: string | null }[];
}

interface TrailEntry {
  agentKey: string;
  action: "created" | "advanced" | "gated_for_review" | "completed" | "rejected" | "blocked";
  contribution: string;
  atIso: string;
}
interface AgentTaskRow {
  id: string;
  task_type: string;
  status: "in_progress" | "awaiting_review" | "handed_off" | "completed" | "rejected" | "blocked";
  origin_agent_key: string;
  current_agent_key: string;
  client_org_id: string | null;
  subject: string;
  trail: TrailEntry[];
  human_gate_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface DraftRow {
  id: string;
  agent_key: string;
  kind: string;
  category: string | null;
  subject: string | null;
  payload: ChiefPayload | BookingPayload | CustomsPayload | VettingPayload | ClaimsPayload | FinancePayload | MarketingPayload | EaPayload;
  status: string;
  created_at: string;
}

const STATUS_CLASS: Record<AgentRow["status"], string> = {
  active: "bg-emerald-100 text-emerald-700",
  planned: "bg-slate-100 text-slate-500",
  paused: "bg-amber-100 text-amber-800",
  deprecated: "bg-rose-100 text-rose-700",
};

const PRIORITY_CLASS: Record<DraftOutputBase["priority"], string> = {
  urgent: "bg-rose-100 text-rose-700 border-rose-200",
  normal: "bg-slate-100 text-slate-600 border-slate-200",
  low: "bg-sky-50 text-sky-700 border-sky-200",
};

type SimTab = "chief" | "booking" | "customs" | "vetting" | "claims" | "finance" | "marketing" | "ea";
const SIM_TABS: { key: SimTab; label: string; slot: number; icon: typeof Sparkles }[] = [
  { key: "vetting",   label: "Carrier Vetting", slot: 5, icon: ShieldAlert },
  { key: "booking",   label: "Booking & Dispatch", slot: 6, icon: Truck },
  { key: "customs",   label: "Customs", slot: 7, icon: ShieldCheck },
  { key: "claims",    label: "Claims & OS&D", slot: 9, icon: PackageX },
  { key: "chief",     label: "Chief of Staff", slot: 10, icon: Sparkles },
  { key: "ea",        label: "Executive Assistant", slot: 11, icon: CalendarClock },
  { key: "finance",   label: "Finance", slot: 12, icon: DollarSign },
  { key: "marketing", label: "Marketing", slot: 13, icon: Megaphone },
];

function draftContext(d: DraftRow): { label: string; header: string; subject: string } {
  switch (d.agent_key) {
    case "agent12_booking_dispatch": {
      const p = d.payload as BookingPayload;
      return { label: "Booking & Dispatch", header: `${p.event.carrier} · ${p.event.origin} → ${p.event.destination}`, subject: `${p.event.shipmentRef}: ${p.event.eventType}` };
    }
    case "agent13_customs_liaison": {
      const p = d.payload as CustomsPayload;
      return { label: "Customs Liaison", header: `Broker: ${p.event.brokerName}${p.event.entryNumber ? ` · Entry ${p.event.entryNumber}` : ""}`, subject: `${p.event.shipmentRef}: ${p.event.eventType}` };
    }
    case "agent14_carrier_vetting": {
      const p = d.payload as VettingPayload;
      return { label: "Carrier Vetting", header: `${p.request.carrierName}${p.request.mcNumber ? ` · MC ${p.request.mcNumber}` : ""}`, subject: `${p.request.carrierName}: ${p.request.eventType}` };
    }
    case "agent15_claims_osd": {
      const p = d.payload as ClaimsPayload;
      return { label: "Claims & OS&D", header: `${p.event.carrier} · ${p.event.mode.toUpperCase()}`, subject: `${p.event.shipmentRef}: ${p.event.eventType}` };
    }
    case "agent8_finance": {
      const p = d.payload as FinancePayload;
      return { label: "Finance", header: `${p.event.clientName}${p.event.invoiceNumber ? ` · Inv ${p.event.invoiceNumber}` : ""}${p.event.amountUsd ? ` · $${p.event.amountUsd.toLocaleString()} ${p.event.currency ?? "USD"}` : ""}${p.event.daysPastDue ? ` · ${p.event.daysPastDue}d past due` : ""}`, subject: `${p.event.clientName}: ${p.event.eventType}` };
    }
    case "agent9_marketing": {
      const p = d.payload as MarketingPayload;
      return { label: "Marketing", header: `${p.brief.format.replace(/_/g, " ")} · ${p.brief.audience}`, subject: p.brief.topic };
    }
    case "agent7_executive_assist": {
      const p = d.payload as EaPayload;
      return { label: "Executive Assistant", header: `${p.request.contactName ?? p.request.contactCompany ?? "contact"}${p.request.meetingWhenIso ? ` · ${p.request.meetingWhenIso.slice(0, 10)}` : ""}`, subject: `${p.request.eventType.replace(/_/g, " ")}: ${p.request.requestDetail.slice(0, 100)}` };
    }
    default: {
      const p = d.payload as ChiefPayload;
      return { label: "Chief of Staff", header: `from ${p.inbound.fromName ? `${p.inbound.fromName} <${p.inbound.fromEmail}>` : p.inbound.fromEmail}`, subject: p.inbound.subject };
    }
  }
}

const DECISION_CLASS = {
  allow: "border-emerald-200 bg-emerald-50 text-emerald-800",
  conditional: "border-amber-200 bg-amber-50 text-amber-800",
  block: "border-rose-200 bg-rose-50 text-rose-800",
} as const;

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRow[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([]);
  const [runningPlaybook, setRunningPlaybook] = useState<string | undefined>();
  const [pbTriggerSummary, setPbTriggerSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [actioning, setActioning] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [simTab, setSimTab] = useState<SimTab>("vetting");
  const [simulating, setSimulating] = useState(false);

  // Per-tab simulate state — kept simple, no forms library.
  const [simFromEmail, setSimFromEmail] = useState("prospect@example.com");
  const [simFromName, setSimFromName] = useState("Alicia Ford");
  const [simSubject, setSimSubject] = useState("Interested in Pascal Logistics — Meridian Cold Chain");
  const [simBody, setSimBody] = useState("Hi — we ship about 25 loads a month between Blaine and Surrey, and we're looking at a fractional supply-chain option. Can you tell me more about your Tier 1.5 and whether we'd be a fit?\n\nThanks,\nAlicia");

  const [bkRef, setBkRef] = useState("PL-2405-018");
  const [bkCarrier, setBkCarrier] = useState("SAIA");
  const [bkOrigin, setBkOrigin] = useState("Blaine, WA");
  const [bkDest, setBkDest] = useState("Toronto, ON");
  const [bkEventType, setBkEventType] = useState("Late pickup");
  const [bkEventDetail, setBkEventDetail] = useState("Driver arrived 90 minutes past appointment window; shipper docks closing at 17:00.");
  const [bkClient, setBkClient] = useState("Alicia Ford <alicia@meridiancoldchain.com>");

  const [cxRef, setCxRef] = useState("PL-2405-018");
  const [cxBroker, setCxBroker] = useState("Livingston International");
  const [cxDirection, setCxDirection] = useState<"south_to_north" | "north_to_south" | "domestic">("south_to_north");
  const [cxEventType, setCxEventType] = useState("Docs check");
  const [cxEventDetail, setCxEventDetail] = useState("Pre-entry review before packet forwards to broker.");
  const [cxHasCI, setCxHasCI] = useState(true);
  const [cxHasPL, setCxHasPL] = useState(true);
  const [cxHasUSMCA, setCxHasUSMCA] = useState(false);
  const [cxHasPOA, setCxHasPOA] = useState(true);
  const [cxIsDG, setCxIsDG] = useState(false);
  const [cxHasDGP, setCxHasDGP] = useState(true);

  const [vtCarrier, setVtCarrier] = useState("Northland Regional Express");
  const [vtMC, setVtMC] = useState("MC-1234567");
  const [vtEventType, setVtEventType] = useState("new_carrier");
  const [vtAuthorityActive, setVtAuthorityActive] = useState(true);
  const [vtAutoLiab, setVtAutoLiab] = useState("1000000");
  const [vtCargo, setVtCargo] = useState("100000");
  const [vtInsExpires, setVtInsExpires] = useState("2026-11-30");
  const [vtSmsUnsafe, setVtSmsUnsafe] = useState("42");
  const [vtSmsHos, setVtSmsHos] = useState("55");
  const [vtSmsMaint, setVtSmsMaint] = useState("38");
  const [vtHasW9, setVtHasW9] = useState(true);

  const [clRef, setClRef] = useState("PL-2405-018");
  const [clMode, setClMode] = useState<"ltl" | "tl" | "ocean" | "air" | "rail" | "unknown">("ltl");
  const [clCarrier, setClCarrier] = useState("SAIA");
  const [clClient, setClClient] = useState("Alicia Ford <alicia@meridiancoldchain.com>");
  const [clEventType, setClEventType] = useState("Damaged pallet on delivery");
  const [clEventDetail, setClEventDetail] = useState("2 of 4 pallets show crush damage on top layer. Client reported at unload. Photos on hand.");
  const [clInvoice, setClInvoice] = useState("8400");
  const [clDamaged, setClDamaged] = useState("3600");
  const [clHasPhotos, setClHasPhotos] = useState(true);
  const [clHasBolNote, setClHasBolNote] = useState(false); // toggle off so concealed-damage warning fires
  const [clHasPod, setClHasPod] = useState(true);
  const [clDeliveredAt, setClDeliveredAt] = useState(new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10));
  const [clStage, setClStage] = useState<"intake" | "claim_filed" | "carrier_response" | "negotiation" | "resolved" | "denied" | "escalated">("intake");

  // Finance simulate state — defaults produce a 45-day past-due retainer chase
  const [fnClient, setFnClient] = useState("Meridian Cold Chain");
  const [fnClientEmail, setFnClientEmail] = useState("ap@meridiancoldchain.com");
  const [fnEventType, setFnEventType] = useState("past_due");
  const [fnEventDetail, setFnEventDetail] = useState("Retainer invoice unpaid — Stripe subscription attempt failed twice.");
  const [fnInvoice, setFnInvoice] = useState("PL-INV-1042");
  const [fnAmount, setFnAmount] = useState("2400");
  const [fnCurrency, setFnCurrency] = useState<"USD" | "CAD">("USD");
  const [fnDaysPastDue, setFnDaysPastDue] = useState("45");
  const [fnService, setFnService] = useState("Tier 1.5 retainer — March 2026");

  // Marketing simulate state — defaults produce a cold email to a real ICP
  const [mkFormat, setMkFormat] = useState<"newsletter" | "linkedin_post" | "cold_email" | "seo_angle">("cold_email");
  const [mkAudience, setMkAudience] = useState("US manufacturers with cross-border freight to Canada");
  const [mkTopic, setMkTopic] = useState("USMCA certificate of origin — the one form that turns duty on or off");
  const [mkKeyPoints, setMkKeyPoints] = useState("Most SMB shipments file at MFN when the USMCA cert is missing\nThe cert saves 3-10% duty on qualifying goods\nWe check every packet before entry so this doesn't happen");
  const [mkProspectName, setMkProspectName] = useState("Sarah Chen");
  const [mkProspectCompany, setMkProspectCompany] = useState("Acme Industrial Parts");
  const [mkProspectRole, setMkProspectRole] = useState("Operations Manager");
  const [mkPainSignal, setMkPainSignal] = useState("just posted a job for a logistics coordinator");
  const [mkCta, setMkCta] = useState("open to a 20-min call to see if we'd be a fit");

  // EA simulate state — defaults produce a scheduling reply for an intro request
  const [eaEventType, setEaEventType] = useState("prospect_intro");
  const [eaContactName, setEaContactName] = useState("Sarah Chen");
  const [eaContactCompany, setEaContactCompany] = useState("Acme Industrial Parts");
  const [eaContactRole, setEaContactRole] = useState("Operations Manager");
  const [eaContactEmail, setEaContactEmail] = useState("sarah@acmeindustrial.com");
  const [eaRequestDetail, setEaRequestDetail] = useState("Saw your reply, would love to set up 20 minutes next week to talk about our cross-border LTL out of Ohio into Ontario.");
  const [eaMeetingWhen, setEaMeetingWhen] = useState("");
  const [eaOnboardingStep, setEaOnboardingStep] = useState("");
  const [eaPriorContext, setEaPriorContext] = useState("Cold email replied to yesterday; roughly 20 loads/mo, no full-time supply-chain person.");

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const [a, d, t, pb] = await Promise.all([
        api.agents<{ agents: AgentRow[] }>(),
        api.agentDrafts<{ drafts: DraftRow[] }>("pending"),
        api.agentTasks<{ tasks: AgentTaskRow[] }>(3).catch(() => ({ tasks: [] })),
        api.playbooks<{ playbooks: PlaybookRow[] }>().catch(() => ({ playbooks: [] })),
      ]);
      setAgents(a.agents);
      setDrafts(d.drafts);
      setTasks(t.tasks);
      setPlaybooks(pb.playbooks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function respond(id: string, status: "approved" | "rejected" | "sent" | "archived") {
    setActioning(id);
    try {
      const patchPayload: { status: typeof status; payload?: unknown } = { status };
      if (editingId === id) {
        const draft = drafts.find((d) => d.id === id);
        if (draft) {
          patchPayload.payload = {
            ...draft.payload,
            output: { ...(draft.payload as { output: DraftOutputBase }).output, draftResponseSubject: editedSubject, draftResponseBody: editedBody },
          };
        }
      }
      await api.updateAgentDraft(id, patchPayload);
      setEditingId(undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update draft.");
    } finally {
      setActioning(undefined);
    }
  }

  function beginEdit(d: DraftRow) {
    setEditingId(d.id);
    const o = (d.payload as { output: DraftOutputBase }).output;
    setEditedSubject(o.draftResponseSubject);
    setEditedBody(o.draftResponseBody);
  }

  async function runPlaybook(key: string) {
    setRunningPlaybook(key);
    setError(undefined);
    try {
      const pb = playbooks.find((p) => p.key === key);
      const trigger = pbTriggerSummary || `Manually launched ${pb?.name ?? key}`;
      await api.runPlaybook(key, { triggerSummary: trigger });
      setPbTriggerSummary("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Playbook run failed.");
    } finally {
      setRunningPlaybook(undefined);
    }
  }

  async function simulate() {
    setSimulating(true);
    setError(undefined);
    try {
      if (simTab === "chief") {
        await api.chiefOfStaffSimulate({ fromEmail: simFromEmail, fromName: simFromName, subject: simSubject, body: simBody });
      } else if (simTab === "booking") {
        const match = bkClient.match(/^(.*?)\s*<(.+?)>\s*$/);
        await api.bookingDispatchSimulate({
          shipmentRef: bkRef, carrier: bkCarrier, origin: bkOrigin, destination: bkDest, eventType: bkEventType, eventDetail: bkEventDetail,
          clientName: match ? match[1] : undefined,
          clientEmail: match ? match[2] : bkClient.includes("@") ? bkClient : undefined,
        });
      } else if (simTab === "customs") {
        await api.customsLiaisonSimulate({
          shipmentRef: cxRef, direction: cxDirection, brokerName: cxBroker, eventType: cxEventType, eventDetail: cxEventDetail,
          hasCommercialInvoice: cxHasCI, hasPackingList: cxHasPL, hasUsmcaCert: cxHasUSMCA, hasPoaOnFile: cxHasPOA, isDg: cxIsDG, hasDgPapers: cxHasDGP,
        });
      } else if (simTab === "vetting") {
        await api.carrierVettingSimulate({
          carrierName: vtCarrier, mcNumber: vtMC, eventType: vtEventType,
          authorityActive: vtAuthorityActive,
          insuranceAutoLiabilityUsd: Number(vtAutoLiab) || 0,
          insuranceCargoUsd: Number(vtCargo) || 0,
          insuranceExpiresIso: vtInsExpires || undefined,
          smsUnsafeDriving: vtSmsUnsafe === "" ? undefined : Number(vtSmsUnsafe),
          smsHoursOfService: vtSmsHos === "" ? undefined : Number(vtSmsHos),
          smsVehicleMaintenance: vtSmsMaint === "" ? undefined : Number(vtSmsMaint),
          hasW9OnFile: vtHasW9,
        });
      } else if (simTab === "claims") {
        const match = clClient.match(/^(.*?)\s*<(.+?)>\s*$/);
        await api.claimsOsdSimulate({
          shipmentRef: clRef, mode: clMode, carrier: clCarrier,
          clientName: match ? match[1] : undefined,
          clientEmail: match ? match[2] : clClient.includes("@") ? clClient : undefined,
          eventType: clEventType, eventDetail: clEventDetail,
          invoiceValueUsd: Number(clInvoice) || 0,
          damagedValueUsd: Number(clDamaged) || 0,
          hasPhotos: clHasPhotos, hasBolNotation: clHasBolNote, hasSignedPod: clHasPod,
          deliveredAtIso: clDeliveredAt || undefined,
          stage: clStage,
        });
      } else if (simTab === "finance") {
        await api.financeSimulate({
          clientName: fnClient, clientEmail: fnClientEmail || undefined,
          eventType: fnEventType, eventDetail: fnEventDetail,
          invoiceNumber: fnInvoice || undefined,
          amountUsd: Number(fnAmount) || 0,
          currency: fnCurrency,
          daysPastDue: fnDaysPastDue === "" ? undefined : Number(fnDaysPastDue),
          serviceDescription: fnService || undefined,
        });
      } else if (simTab === "marketing") {
        await api.marketingSimulate({
          format: mkFormat, audience: mkAudience, topic: mkTopic,
          keyPoints: mkKeyPoints.split("\n").map((s) => s.trim()).filter(Boolean),
          prospectName: mkProspectName || undefined,
          prospectCompany: mkProspectCompany || undefined,
          prospectRole: mkProspectRole || undefined,
          currentPainSignal: mkPainSignal || undefined,
          desiredCta: mkCta,
        });
      } else if (simTab === "ea") {
        await api.executiveAssistantSimulate({
          eventType: eaEventType,
          contactName: eaContactName || undefined,
          contactCompany: eaContactCompany || undefined,
          contactRole: eaContactRole || undefined,
          contactEmail: eaContactEmail || undefined,
          requestDetail: eaRequestDetail,
          meetingWhenIso: eaMeetingWhen || undefined,
          onboardingStep: eaOnboardingStep || undefined,
          priorContext: eaPriorContext || undefined,
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <OperatorHeader />
      <main className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-slate-700" />
            <h1 className="text-xl font-bold">AI Agent Registry</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">
              {agents.filter((a) => a.status === "active").length} active · {agents.filter((a) => a.status === "planned").length} planned
            </span>
          </div>
          <button onClick={load} className="text-xs font-medium text-slate-500 hover:text-slate-700">Refresh</button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Agent grid */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {loading && agents.length === 0 ? (
            <div className="col-span-full flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading agents…
            </div>
          ) : agents.map((a) => (
            <div key={a.agentKey} className={`rounded-xl border p-4 shadow-sm ${a.status === "active" ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50/50"}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.status === "active" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500"}`}>
                    <Bot size={14} />
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400">Agent {a.agentNumber} · {a.role}</p>
                    <p className="text-sm font-semibold text-slate-900">{a.name}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${STATUS_CLASS[a.status]}`}>{a.status}</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{a.description}</p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                <span>{a.humanInLoop ? "Human-in-loop" : "Autonomous"}</span>
                {a.pendingDrafts > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 font-semibold">
                    <Inbox size={10} /> {a.pendingDrafts} draft{a.pendingDrafts === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>

        {/* Playbook board — Chief of Staff / EA call these plays. Roger can
            manually launch one from here to simulate what happens end-to-end. */}
        {playbooks.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <ClipboardList size={14} className="text-slate-700" />
                <p className="text-sm font-bold text-slate-900">Playbook board</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">Chief of Staff + EA quarterback</span>
              </div>
              <input
                value={pbTriggerSummary}
                onChange={(e) => setPbTriggerSummary(e.target.value)}
                placeholder="Trigger summary (optional — describe what fired the play)"
                className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              {playbooks.map((pb) => {
                const qb = pb.quarterback === "agent6_chief_of_staff" ? { name: "Chief of Staff", tag: "CoS #10" } : { name: "Executive Assistant", tag: "EA #11" };
                const gates = pb.steps.filter((s) => s.gateForReview).length;
                return (
                  <div key={pb.key} className={`rounded-lg border p-3 ${pb.clientVisible ? "border-cyan-200 bg-cyan-50/30" : "border-slate-200 bg-slate-50/40"}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-slate-900">{pb.name}</p>
                          <span className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-600">{qb.tag}</span>
                          {pb.clientVisible && <span className="rounded-md border border-cyan-300 bg-cyan-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-cyan-800">client-visible</span>}
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">{pb.trigger}</p>
                      </div>
                      <button
                        onClick={() => runPlaybook(pb.key)}
                        disabled={runningPlaybook !== undefined}
                        className="flex flex-shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        {runningPlaybook === pb.key ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                        Run play
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500">
                      <span className="rounded bg-white border border-slate-200 px-1.5 py-0.5">{pb.stepCount} steps</span>
                      {gates > 0 && <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-amber-800">{gates} review gate{gates === 1 ? "" : "s"}</span>}
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wide text-slate-500 hover:text-slate-700">The play</summary>
                      <ol className="mt-1 list-decimal list-inside space-y-0.5 text-[11px] text-slate-600">
                        {pb.steps.map((s, i) => (
                          <li key={i}>
                            <span className="font-medium text-slate-800">{agents.find((a) => a.agentKey === s.agentKey)?.name ?? s.agentKey}</span>
                            <span className="text-slate-500"> — {s.action}</span>
                            {s.gateForReview && <span className="ml-1 rounded bg-amber-50 border border-amber-200 px-1 text-[10px] text-amber-800">gate</span>}
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Cross-agent task trail — visible whenever there are any tasks */}
        {tasks.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <GitBranch size={14} className="text-slate-700" />
                <p className="text-sm font-bold text-slate-900">Cross-agent task trail</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">last 3 days</span>
                {tasks.filter((t) => t.status === "awaiting_review").length > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-rose-800">
                    {tasks.filter((t) => t.status === "awaiting_review").length} gated for review
                  </span>
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {tasks.slice(0, 10).map((t) => {
                const originAgent = agents.find((a) => a.agentKey === t.origin_agent_key);
                const currentAgent = agents.find((a) => a.agentKey === t.current_agent_key);
                return (
                  <div key={t.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide ${t.status === "awaiting_review" ? "border-rose-200 bg-rose-50 text-rose-800" : t.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{t.status.replace(/_/g, " ")}</span>
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">{t.task_type.replace(/_/g, " ")}</span>
                      <p className="text-xs font-semibold text-slate-900">{t.subject}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                      <span className="font-medium text-slate-700">{originAgent?.name ?? t.origin_agent_key}</span>
                      <ArrowRight size={11} />
                      <span className="font-medium text-slate-700">{currentAgent?.name ?? t.current_agent_key}</span>
                      <span className="text-slate-400">·</span>
                      <span>{t.trail.length} step{t.trail.length === 1 ? "" : "s"}</span>
                      {t.human_gate_reason && (
                        <>
                          <span className="text-slate-400">·</span>
                          <span className="text-rose-700">Gate: {t.human_gate_reason}</span>
                        </>
                      )}
                    </div>
                    {t.trail.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-wide text-slate-500 hover:text-slate-700">Full trail</summary>
                        <ol className="mt-2 list-decimal list-inside space-y-1 text-[11px] text-slate-600">
                          {t.trail.map((e, i) => (
                            <li key={i}><span className="font-medium text-slate-800">{agents.find((a) => a.agentKey === e.agentKey)?.name ?? e.agentKey}</span> <span className="text-slate-400">{e.action.replace(/_/g, " ")}</span>: {e.contribution}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Tabbed simulate section */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 pt-3">
            {SIM_TABS.map((t) => {
              const Icon = t.icon;
              const active = simTab === t.key;
              return (
                <button key={t.key} onClick={() => setSimTab(t.key)} className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs font-medium transition-colors ${active ? "border-cyan-500 text-slate-900 bg-slate-50" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  <Icon size={12} /> {t.label} <span className="font-mono text-[10px] text-slate-400">#{t.slot}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-2 p-4">
            {simTab === "chief" && (
              <>
                <input value={simFromEmail} onChange={(e) => setSimFromEmail(e.target.value)} placeholder="From email" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={simFromName} onChange={(e) => setSimFromName(e.target.value)} placeholder="From name" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={simSubject} onChange={(e) => setSimSubject(e.target.value)} placeholder="Subject" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <textarea value={simBody} onChange={(e) => setSimBody(e.target.value)} rows={4} placeholder="Body" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              </>
            )}
            {simTab === "booking" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input value={bkRef} onChange={(e) => setBkRef(e.target.value)} placeholder="Shipment ref" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={bkCarrier} onChange={(e) => setBkCarrier(e.target.value)} placeholder="Carrier" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={bkOrigin} onChange={(e) => setBkOrigin(e.target.value)} placeholder="Origin" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={bkDest} onChange={(e) => setBkDest(e.target.value)} placeholder="Destination" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <input value={bkEventType} onChange={(e) => setBkEventType(e.target.value)} placeholder="Event type" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <textarea value={bkEventDetail} onChange={(e) => setBkEventDetail(e.target.value)} rows={3} placeholder="Event detail" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={bkClient} onChange={(e) => setBkClient(e.target.value)} placeholder="Client (Name <email>)" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              </>
            )}
            {simTab === "customs" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input value={cxRef} onChange={(e) => setCxRef(e.target.value)} placeholder="Shipment ref" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={cxBroker} onChange={(e) => setCxBroker(e.target.value)} placeholder="Broker on file" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <select value={cxDirection} onChange={(e) => setCxDirection(e.target.value as typeof cxDirection)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  <option value="south_to_north">Southbound → Canada import</option>
                  <option value="north_to_south">Northbound → US import</option>
                  <option value="domestic">Domestic (no customs)</option>
                </select>
                <input value={cxEventType} onChange={(e) => setCxEventType(e.target.value)} placeholder="Event type" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <textarea value={cxEventDetail} onChange={(e) => setCxEventDetail(e.target.value)} rows={2} placeholder="Event detail" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-700">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={cxHasCI} onChange={(e) => setCxHasCI(e.target.checked)} /> Commercial invoice</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={cxHasPL} onChange={(e) => setCxHasPL(e.target.checked)} /> Packing list</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={cxHasUSMCA} onChange={(e) => setCxHasUSMCA(e.target.checked)} /> USMCA cert</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={cxHasPOA} onChange={(e) => setCxHasPOA(e.target.checked)} /> POA on file</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={cxIsDG} onChange={(e) => setCxIsDG(e.target.checked)} /> DG shipment</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={cxHasDGP} onChange={(e) => setCxHasDGP(e.target.checked)} /> DG papers</label>
                </div>
              </>
            )}
            {simTab === "vetting" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input value={vtCarrier} onChange={(e) => setVtCarrier(e.target.value)} placeholder="Carrier name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={vtMC} onChange={(e) => setVtMC(e.target.value)} placeholder="MC number" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <select value={vtEventType} onChange={(e) => setVtEventType(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  <option value="new_carrier">New carrier onboarding</option>
                  <option value="monthly_reverify">Monthly re-verification</option>
                  <option value="post_tender_audit">Post-tender audit</option>
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input value={vtAutoLiab} onChange={(e) => setVtAutoLiab(e.target.value)} placeholder="Auto liability $" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={vtCargo} onChange={(e) => setVtCargo(e.target.value)} placeholder="Cargo $" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={vtInsExpires} onChange={(e) => setVtInsExpires(e.target.value)} placeholder="Insurance expiry YYYY-MM-DD" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <label className="flex items-center gap-1 text-[11px] text-slate-700"><input type="checkbox" checked={vtAuthorityActive} onChange={(e) => setVtAuthorityActive(e.target.checked)} /> Authority active</label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={vtSmsUnsafe} onChange={(e) => setVtSmsUnsafe(e.target.value)} placeholder="SMS Unsafe" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={vtSmsHos} onChange={(e) => setVtSmsHos(e.target.value)} placeholder="SMS HOS" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={vtSmsMaint} onChange={(e) => setVtSmsMaint(e.target.value)} placeholder="SMS Maint" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <label className="flex items-center gap-1 text-[11px] text-slate-700"><input type="checkbox" checked={vtHasW9} onChange={(e) => setVtHasW9(e.target.checked)} /> W9 on file</label>
              </>
            )}
            {simTab === "finance" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input value={fnClient} onChange={(e) => setFnClient(e.target.value)} placeholder="Client name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={fnClientEmail} onChange={(e) => setFnClientEmail(e.target.value)} placeholder="Client email" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <select value={fnEventType} onChange={(e) => setFnEventType(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  <option value="invoice_new">New invoice (send)</option>
                  <option value="payment_received">Payment received (thank you)</option>
                  <option value="past_due">Past-due chase</option>
                  <option value="monthly_close">Monthly P&amp;L snippet (internal)</option>
                  <option value="reconciliation">Stripe / QB reconciliation note (internal)</option>
                </select>
                <textarea value={fnEventDetail} onChange={(e) => setFnEventDetail(e.target.value)} rows={2} placeholder="Event detail" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <div className="grid grid-cols-3 gap-2">
                  <input value={fnInvoice} onChange={(e) => setFnInvoice(e.target.value)} placeholder="Invoice #" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={fnAmount} onChange={(e) => setFnAmount(e.target.value)} placeholder="Amount" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <select value={fnCurrency} onChange={(e) => setFnCurrency(e.target.value as "USD" | "CAD")} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                    <option value="USD">USD</option>
                    <option value="CAD">CAD</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={fnDaysPastDue} onChange={(e) => setFnDaysPastDue(e.target.value)} placeholder="Days past due" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={fnService} onChange={(e) => setFnService(e.target.value)} placeholder="Service description" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
              </>
            )}
            {simTab === "marketing" && (
              <>
                <select value={mkFormat} onChange={(e) => setMkFormat(e.target.value as typeof mkFormat)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  <option value="cold_email">Cold email (personalized)</option>
                  <option value="linkedin_post">LinkedIn post</option>
                  <option value="newsletter">Weekly newsletter</option>
                  <option value="seo_angle">SEO angle idea (internal)</option>
                </select>
                <input value={mkAudience} onChange={(e) => setMkAudience(e.target.value)} placeholder="Audience" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={mkTopic} onChange={(e) => setMkTopic(e.target.value)} placeholder="Topic" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <textarea value={mkKeyPoints} onChange={(e) => setMkKeyPoints(e.target.value)} rows={3} placeholder="Key points (one per line, up to 5)" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                {mkFormat === "cold_email" && (
                  <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Prospect personalization</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={mkProspectName} onChange={(e) => setMkProspectName(e.target.value)} placeholder="Prospect name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                      <input value={mkProspectRole} onChange={(e) => setMkProspectRole(e.target.value)} placeholder="Prospect role" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                    </div>
                    <input value={mkProspectCompany} onChange={(e) => setMkProspectCompany(e.target.value)} placeholder="Prospect company" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                    <input value={mkPainSignal} onChange={(e) => setMkPainSignal(e.target.value)} placeholder="Pain signal to reference" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  </div>
                )}
                <input value={mkCta} onChange={(e) => setMkCta(e.target.value)} placeholder="Desired CTA" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              </>
            )}
            {simTab === "ea" && (
              <>
                <select value={eaEventType} onChange={(e) => setEaEventType(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                  <option value="prospect_intro">Prospect wants intro call</option>
                  <option value="meeting_prep">Prep me for a call (internal brief)</option>
                  <option value="onboarding_check">Onboarding check-in with client</option>
                  <option value="post_call">Post-call follow-up</option>
                  <option value="internal_reminder">Internal reminder to Roger</option>
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input value={eaContactName} onChange={(e) => setEaContactName(e.target.value)} placeholder="Contact name" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={eaContactRole} onChange={(e) => setEaContactRole(e.target.value)} placeholder="Contact role" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={eaContactCompany} onChange={(e) => setEaContactCompany(e.target.value)} placeholder="Contact company" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={eaContactEmail} onChange={(e) => setEaContactEmail(e.target.value)} placeholder="Contact email" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <textarea value={eaRequestDetail} onChange={(e) => setEaRequestDetail(e.target.value)} rows={3} placeholder="What they want / the request detail" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                {eaEventType === "meeting_prep" && (
                  <input value={eaMeetingWhen} onChange={(e) => setEaMeetingWhen(e.target.value)} placeholder="Meeting when (YYYY-MM-DDTHH:MM)" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                )}
                {eaEventType === "onboarding_check" && (
                  <select value={eaOnboardingStep} onChange={(e) => setEaOnboardingStep(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                    <option value="">— pick current onboarding step —</option>
                    <option value="poa_pending">POA pending both sides</option>
                    <option value="w9_received">W9 received</option>
                    <option value="kickoff_scheduled">Kickoff call scheduled</option>
                    <option value="stripe_active">Stripe retainer active</option>
                    <option value="first_shipment">First shipment moving</option>
                  </select>
                )}
                <textarea value={eaPriorContext} onChange={(e) => setEaPriorContext(e.target.value)} rows={2} placeholder="Prior context (email thread, previous notes)" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
              </>
            )}
            {simTab === "claims" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input value={clRef} onChange={(e) => setClRef(e.target.value)} placeholder="Shipment ref" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={clCarrier} onChange={(e) => setClCarrier(e.target.value)} placeholder="Carrier" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={clMode} onChange={(e) => setClMode(e.target.value as typeof clMode)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                    <option value="ltl">LTL</option>
                    <option value="tl">Truckload</option>
                    <option value="ocean">Ocean</option>
                    <option value="air">Air</option>
                    <option value="rail">Rail</option>
                  </select>
                  <select value={clStage} onChange={(e) => setClStage(e.target.value as typeof clStage)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">
                    <option value="intake">Intake</option>
                    <option value="claim_filed">Claim filed</option>
                    <option value="carrier_response">Carrier response</option>
                    <option value="negotiation">Negotiation</option>
                    <option value="resolved">Resolved</option>
                    <option value="denied">Denied</option>
                    <option value="escalated">Escalated</option>
                  </select>
                </div>
                <input value={clClient} onChange={(e) => setClClient(e.target.value)} placeholder="Client (Name <email>)" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <input value={clEventType} onChange={(e) => setClEventType(e.target.value)} placeholder="Event type" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <textarea value={clEventDetail} onChange={(e) => setClEventDetail(e.target.value)} rows={2} placeholder="Event detail" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                <div className="grid grid-cols-3 gap-2">
                  <input value={clInvoice} onChange={(e) => setClInvoice(e.target.value)} placeholder="Invoice $" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={clDamaged} onChange={(e) => setClDamaged(e.target.value)} placeholder="Damaged $" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                  <input value={clDeliveredAt} onChange={(e) => setClDeliveredAt(e.target.value)} placeholder="Delivered YYYY-MM-DD" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs" />
                </div>
                <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-700">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={clHasPhotos} onChange={(e) => setClHasPhotos(e.target.checked)} /> Damage photos</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={clHasBolNote} onChange={(e) => setClHasBolNote(e.target.checked)} /> BOL notation</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={clHasPod} onChange={(e) => setClHasPod(e.target.checked)} /> Signed POD</label>
                </div>
              </>
            )}

            <button onClick={simulate} disabled={simulating} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {simulating ? <Loader2 size={12} className="animate-spin" /> : <MessageSquarePlus size={12} />}
              Run simulation → draft to review queue
            </button>
          </div>
        </section>

        {/* Draft review queue */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Inbox size={14} className="text-slate-700" />
              <p className="text-sm font-bold text-slate-900">Draft review queue</p>
              {drafts.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-amber-800">{drafts.length} pending</span>}
            </div>
          </div>
          {drafts.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-500">No drafts waiting on your review.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {drafts.map((d) => {
                const ctx = draftContext(d);
                const output = (d.payload as { output: DraftOutputBase }).output;
                const customs = d.agent_key === "agent13_customs_liaison" ? (d.payload as CustomsPayload) : undefined;
                const vetting = d.agent_key === "agent14_carrier_vetting" ? (d.payload as VettingPayload) : undefined;
                const claims = d.agent_key === "agent15_claims_osd" ? (d.payload as ClaimsPayload) : undefined;
                return (
                  <div key={d.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide ${PRIORITY_CLASS[output.priority]}`}>{output.priority}</span>
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">{ctx.label}</span>
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">{d.category?.replace(/_/g, " ") ?? "—"}</span>
                          {vetting && <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wide ${DECISION_CLASS[vetting.output.decision]}`}>{vetting.output.decision}</span>}
                          {output.simulated && <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-mono text-violet-700">simulated</span>}
                          <span className="text-[11px] text-slate-500">{ctx.header}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{ctx.subject}</p>
                        <p className="mt-1 text-[11px] text-slate-500 italic">Summary: {output.summary}</p>

                        {customs && customs.output.docPacketIssues && customs.output.docPacketIssues.length > 0 && (
                          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
                            <p className="text-[10px] font-mono uppercase tracking-wide text-rose-700 mb-1">Doc packet issues</p>
                            <ul className="list-disc list-inside text-[11px] text-rose-800 space-y-0.5">
                              {customs.output.docPacketIssues.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          </div>
                        )}
                        {vetting && vetting.output.redFlags && vetting.output.redFlags.length > 0 && (
                          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
                            <p className="text-[10px] font-mono uppercase tracking-wide text-rose-700 mb-1">Red flags</p>
                            <ul className="list-disc list-inside text-[11px] text-rose-800 space-y-0.5">
                              {vetting.output.redFlags.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          </div>
                        )}
                        {claims && (
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5"><span className="font-mono uppercase tracking-wide text-slate-500">Claim value</span> ${claims.output.claimValueUsd.toLocaleString()}</span>
                            <span className={`rounded-md border px-2 py-0.5 ${claims.output.filingWindowDays < 30 ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}><span className="font-mono uppercase tracking-wide">Filing window</span> {claims.output.filingWindowDays}d remaining</span>
                            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5"><span className="font-mono uppercase tracking-wide text-slate-500">Stage</span> {claims.output.stage.replace(/_/g, " ")}</span>
                            {claims.output.documentationGaps.length > 0 && (
                              <div className="basis-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                                <p className="text-[10px] font-mono uppercase tracking-wide text-amber-700 mb-1">Documentation gaps</p>
                                <ul className="list-disc list-inside text-[11px] text-amber-800 space-y-0.5">
                                  {claims.output.documentationGaps.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        {output.suggestedActions.length > 0 && (
                          <ul className="mt-1 list-disc list-inside text-[11px] text-slate-600 space-y-0.5">
                            {output.suggestedActions.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500 mb-2">Draft response</p>
                      {editingId === d.id ? (
                        <>
                          <input value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} className="mb-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" placeholder="Subject" />
                          <textarea value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={6} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" placeholder="Body" />
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-semibold text-slate-800 mb-1">{output.draftResponseSubject}</p>
                          <pre className="whitespace-pre-wrap text-xs text-slate-700 font-sans leading-relaxed">{output.draftResponseBody}</pre>
                        </>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {editingId === d.id ? (
                        <button onClick={() => setEditingId(undefined)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel edit</button>
                      ) : (
                        <button onClick={() => beginEdit(d)} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                          <Edit3 size={12} /> Edit
                        </button>
                      )}
                      <button onClick={() => respond(d.id, "archived")} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        <Archive size={12} /> Archive
                      </button>
                      <button onClick={() => respond(d.id, "rejected")} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                        <XCircle size={12} /> Reject
                      </button>
                      <button onClick={() => respond(d.id, "sent")} disabled={actioning === d.id} className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                        {actioning === d.id ? <Loader2 size={12} className="animate-spin" /> : editingId === d.id ? <><Send size={12} /> Send edited</> : <><CheckCircle2 size={12} /> Send as drafted</>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
