// ============================================================================
// DRAFT DISPATCH — actually send the reviewed draft
// When the operator clicks "Send as drafted" on the AI Agents review queue,
// this module figures out who the draft is for and sends it. Every agent's
// payload holds the recipient somewhere; this centralizes the resolution.
//
// If no email address can be resolved, we do NOT hard-fail — we mark the
// draft sent with a note explaining the recipient couldn't be inferred, so
// Roger can copy the body manually if he wants. Silent failure of "sent"
// clicks would be worse than transparent partial success.
// ============================================================================

import { sendOperationalEmail, type EmailDispatchResult } from "./agentMailDispatch.js";

interface DraftRow {
  agent_key: string;
  payload: Record<string, unknown>;
}

export interface DispatchResult {
  attempted: boolean;
  recipient?: string;
  emailResult?: EmailDispatchResult;
  reason?: string;                       // if attempted=false, why we couldn't dispatch
}

// Return the best-guess recipient email + a compact "how we got it" tag.
export function resolveRecipient(draft: DraftRow): { email?: string; source: string } {
  const p = draft.payload ?? {};
  const output = (p as { output?: { recipientRole?: string; recipientEmail?: string } }).output ?? {};
  const recipientRole = output.recipientRole ?? "";

  // Playbook-step drafts (agent_key can be any agent). Look in contextPayload
  // for client / broker / carrier / prospect emails depending on role.
  const context = (p as { context?: Record<string, unknown> }).context ?? {};

  // Utility to pull nested email fields safely.
  const asEmail = (v: unknown): string | undefined => (typeof v === "string" && v.includes("@")) ? v : undefined;

  // Explicit override on the output itself (some agents include this).
  if (output.recipientEmail) return { email: output.recipientEmail, source: "output.recipientEmail" };

  // Client-facing drafts: check client email in various shapes.
  if (recipientRole === "client" || recipientRole === "prospect") {
    const candidates = [
      (p as { inbound?: { fromEmail?: string } }).inbound?.fromEmail,
      (p as { event?: { clientEmail?: string } }).event?.clientEmail,
      (p as { request?: { contactEmail?: string } }).request?.contactEmail,
      (context as { clientEmail?: string }).clientEmail,
      (context as { contactEmail?: string }).contactEmail,
      (context as { prospectEmail?: string }).prospectEmail,
    ];
    for (const c of candidates) {
      const email = asEmail(c);
      if (email) return { email, source: "client/prospect" };
    }
  }

  // Carrier-facing.
  if (recipientRole === "carrier") {
    const candidates = [
      (p as { event?: { carrierEmail?: string } }).event?.carrierEmail,
      (p as { request?: { carrierEmail?: string } }).request?.carrierEmail,
      (context as { carrierEmail?: string }).carrierEmail,
    ];
    for (const c of candidates) {
      const email = asEmail(c);
      if (email) return { email, source: "carrier" };
    }
  }

  // Broker-facing (customs liaison).
  if (recipientRole === "broker") {
    const candidates = [
      (p as { event?: { brokerEmail?: string } }).event?.brokerEmail,
      (context as { brokerEmail?: string }).brokerEmail,
    ];
    for (const c of candidates) {
      const email = asEmail(c);
      if (email) return { email, source: "broker" };
    }
  }

  // Legal Watcher counterparty.
  const counterparty = asEmail((p as { event?: { counterpartyEmail?: string } }).event?.counterpartyEmail);
  if (counterparty) return { email: counterparty, source: "counterparty" };

  // HR candidate.
  const candidate = asEmail((p as { request?: { candidateEmail?: string } }).request?.candidateEmail);
  if (candidate) return { email: candidate, source: "candidate" };

  // Chief of Staff / inbox reply — the inbound fromEmail is always a valid
  // reply target for anything that arrived via email triage.
  const inboundFrom = asEmail((p as { inbound?: { fromEmail?: string } }).inbound?.fromEmail);
  if (inboundFrom) return { email: inboundFrom, source: "reply-to inbound" };

  // Internal-only drafts (no recipient).
  if (recipientRole === "internal") return { source: "internal — no recipient" };

  return { source: "unresolved" };
}

// Look inside the draft payload for the subject + body to actually send.
function resolveSubjectAndBody(draft: DraftRow): { subject: string; body: string } {
  const output = (draft.payload as { output?: { draftResponseSubject?: string; draftResponseBody?: string } }).output ?? {};
  return {
    subject: output.draftResponseSubject ?? "Update from Pascal Logistics",
    body: output.draftResponseBody ?? "",
  };
}

// Send the draft. Returns a result object the route handler surfaces to
// the operator UI so Roger sees exactly what happened.
export async function dispatchDraft(draft: DraftRow): Promise<DispatchResult> {
  const recipient = resolveRecipient(draft);

  if (!recipient.email) {
    return { attempted: false, reason: `No recipient email on file (${recipient.source}). Draft marked sent — forward manually if needed.` };
  }

  const { subject, body } = resolveSubjectAndBody(draft);
  if (!body.trim()) {
    return { attempted: false, recipient: recipient.email, reason: "Draft body is empty — refusing to send." };
  }

  const emailResult = await sendOperationalEmail(recipient.email, subject, body);
  return {
    attempted: true,
    recipient: recipient.email,
    emailResult,
  };
}
