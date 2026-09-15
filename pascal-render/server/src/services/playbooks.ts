// ============================================================================
// PLAYBOOK REGISTRY
// Named plays a quarterback (Chief of Staff or Executive Assistant) can call.
// Each playbook is a sequence of steps — which agent does what, in what
// order, with which reviews gated for Roger. The quarterback doesn't do
// the work itself — it decides which play applies and runs it. This is
// what makes the back office feel like an experienced supply-chain
// manager coordinating a real team instead of five disconnected tools.
//
// Each play ends with a "client-visible narrative" step where the
// quarterback composes what the client sees. That is the moment the
// client feels the difference — "we noticed X, we checked Y, we set
// up Z, here's what happens next" instead of the usual silence.
// ============================================================================

export type QuarterbackKey = "agent6_chief_of_staff" | "agent7_executive_assist";

export interface PlaybookStep {
  stepKey: string;
  agentKey: string;          // which agent runs this step
  action: string;            // human-readable action label
  gateForReview?: string;    // if set, Roger reviews before this step's output goes anywhere
  skipIf?: (payload: Record<string, unknown>) => boolean;
}

export interface Playbook {
  key: string;
  name: string;
  trigger: string;                    // one-line description of what fires it
  quarterback: QuarterbackKey;        // who calls the play
  steps: PlaybookStep[];
  clientVisible: boolean;             // does the client see the final summary?
}

// Chief-of-Staff-quarterbacked plays — operational + reactive
const usmcaMissing: Playbook = {
  key: "usmca_missing",
  name: "USMCA cert missing",
  trigger: "Customs Liaison packet audit finds missing USMCA certificate of origin on cross-border shipment",
  quarterback: "agent6_chief_of_staff",
  clientVisible: true,
  steps: [
    { stepKey: "customs_audit", agentKey: "agent13_customs_liaison", action: "Flag missing USMCA + estimate duty impact" },
    { stepKey: "compliance_check", agentKey: "agent2_compliance", action: "Confirm goods qualify for USMCA under RoO", gateForReview: "Compliance found ambiguity — confirm goods qualify" },
    { stepKey: "client_outreach", agentKey: "agent5_client_chat", action: "Draft client note: cert needed, duty impact, deadline", gateForReview: "Confirm draft reads right before send" },
    { stepKey: "finance_flag", agentKey: "agent8_finance", action: "Flag potential duty impact on margin if cert doesn't come in" },
    { stepKey: "qb_wrap", agentKey: "agent6_chief_of_staff", action: "Compose client-visible narrative + Roger recap" },
  ],
};

const rateSpike: Playbook = {
  key: "rate_spike",
  name: "Carrier rate spike",
  trigger: "Rate Optimization spots a carrier invoice materially above benchmark",
  quarterback: "agent6_chief_of_staff",
  clientVisible: true,
  steps: [
    { stepKey: "rate_audit", agentKey: "agent3_rate_optimization", action: "Audit invoice vs spot market + name the delta" },
    { stepKey: "compliance_check", agentKey: "agent2_compliance", action: "Check if a tariff / fuel / regulatory driver explains the spike" },
    { stepKey: "vetting_check", agentKey: "agent14_carrier_vetting", action: "Confirm carrier still in good standing" },
    { stepKey: "client_note", agentKey: "agent5_client_chat", action: "Draft client note: what we spotted, what's likely driving it, options", gateForReview: "Confirm client note before send" },
    { stepKey: "qb_wrap", agentKey: "agent6_chief_of_staff", action: "Compose client-visible narrative + Roger recap" },
  ],
};

const transitException: Playbook = {
  key: "transit_exception",
  name: "In-transit exception",
  trigger: "Booking & Dispatch flags a late pickup, breakdown, HOS shutdown, weather delay, or damage in transit",
  quarterback: "agent6_chief_of_staff",
  clientVisible: true,
  steps: [
    { stepKey: "booking_flag", agentKey: "agent12_booking_dispatch", action: "Log the exception + pull revised ETA from carrier" },
    { stepKey: "recovery_option", agentKey: "agent12_booking_dispatch", action: "Assess recovery options (recover, reconsign, re-tender)" },
    { stepKey: "client_heads_up", agentKey: "agent5_client_chat", action: "Draft client heads-up: what happened, revised ETA, what we're doing", gateForReview: "Confirm heads-up before send — timing matters" },
    { stepKey: "qb_wrap", agentKey: "agent6_chief_of_staff", action: "Compose client-visible narrative + Roger recap" },
  ],
};

const tariffChangeAffectingClient: Playbook = {
  key: "tariff_change_affecting_client",
  name: "Tariff change affecting client goods",
  trigger: "Tariff monitor sees a Federal Register / CBSA change on an HS code a client imports",
  quarterback: "agent6_chief_of_staff",
  clientVisible: true,
  steps: [
    { stepKey: "compliance_summary", agentKey: "agent2_compliance", action: "Summarize the change + duty impact per unit" },
    { stepKey: "customs_prep", agentKey: "agent13_customs_liaison", action: "Prep the packet update the broker will need for future entries" },
    { stepKey: "client_note", agentKey: "agent5_client_chat", action: "Draft client note: change, effective date, impact, our recommendation", gateForReview: "Confirm impact analysis before we send" },
    { stepKey: "finance_forecast", agentKey: "agent8_finance", action: "Update landed-cost forecast if we track it" },
    { stepKey: "qb_wrap", agentKey: "agent6_chief_of_staff", action: "Compose client-visible narrative + Roger recap" },
    { stepKey: "marketing_angle", agentKey: "agent9_marketing", action: "Turn into a newsletter angle for the following week (internal)", skipIf: (p) => p.severity !== "critical" },
  ],
};

const pastDueEscalation: Playbook = {
  key: "past_due_escalation",
  name: "Past-due invoice escalation",
  trigger: "Finance sees an invoice cross the 30-day past-due threshold",
  quarterback: "agent6_chief_of_staff",
  clientVisible: false, // this one is mostly internal until Finance draft goes out
  steps: [
    { stepKey: "finance_chase", agentKey: "agent8_finance", action: "Draft the aging-appropriate chase (30 / 60 / 90)", gateForReview: "Confirm chase tone before send" },
    { stepKey: "ea_schedule", agentKey: "agent7_executive_assist", action: "Offer 15-min check-in slot to unstick the payment", skipIf: (p) => (p.daysPastDue as number) < 60 },
    { stepKey: "qb_wrap", agentKey: "agent6_chief_of_staff", action: "Log to CRM + queue for next-day review if unresolved" },
  ],
};

// EA-quarterbacked plays — anything about scheduling, onboarding, or the human loop
const newClientOnboarding: Playbook = {
  key: "new_client_onboarding",
  name: "New client onboarding",
  trigger: "New retainer signed OR intro call converted — start the onboarding sequence",
  quarterback: "agent7_executive_assist",
  clientVisible: true,
  steps: [
    { stepKey: "ea_welcome", agentKey: "agent7_executive_assist", action: "Draft warm welcome + explain onboarding checklist" },
    { stepKey: "customs_poa_pack", agentKey: "agent13_customs_liaison", action: "Prep the POA doc packet for the client's broker of record" },
    { stepKey: "finance_stripe", agentKey: "agent8_finance", action: "Draft Stripe subscription setup message" },
    { stepKey: "cs_intro", agentKey: "agent5_client_chat", action: "Draft Customer Service intro — how to reach us, portal walkthrough" },
    { stepKey: "ea_kickoff", agentKey: "agent7_executive_assist", action: "Propose kickoff-call times", gateForReview: "Confirm kickoff proposal before send" },
    { stepKey: "qb_wrap", agentKey: "agent7_executive_assist", action: "Compose client-visible day-1 narrative + Roger sign-off" },
  ],
};

const inboundProspectIntro: Playbook = {
  key: "inbound_prospect_intro",
  name: "Inbound prospect wants intro call",
  trigger: "Prospect emails or calls asking about services — usually via operations@ or the site form",
  quarterback: "agent7_executive_assist",
  clientVisible: true,
  steps: [
    { stepKey: "cos_triage", agentKey: "agent6_chief_of_staff", action: "Triage inbound + label as prospect intro" },
    { stepKey: "ea_scheduling", agentKey: "agent7_executive_assist", action: "Draft time-slot proposal + one-page prep sheet for Roger", gateForReview: "Confirm which times to offer" },
    { stepKey: "marketing_backfill", agentKey: "agent9_marketing", action: "Log the pain signal for future outreach segmentation (internal)" },
    { stepKey: "qb_wrap", agentKey: "agent7_executive_assist", action: "Send scheduling draft + brief Roger for the call" },
  ],
};

export const PLAYBOOKS: Record<string, Playbook> = {
  usmca_missing: usmcaMissing,
  rate_spike: rateSpike,
  transit_exception: transitException,
  tariff_change_affecting_client: tariffChangeAffectingClient,
  past_due_escalation: pastDueEscalation,
  new_client_onboarding: newClientOnboarding,
  inbound_prospect_intro: inboundProspectIntro,
};

export function getPlaybook(key: string): Playbook | undefined {
  return PLAYBOOKS[key];
}

export function listPlaybooks(): Playbook[] {
  return Object.values(PLAYBOOKS);
}
