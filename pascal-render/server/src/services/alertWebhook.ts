// ============================================================================
// server/services/alertWebhook.ts
// Real HTTP POST to a Slack incoming-webhook or Teams incoming-webhook URL,
// each formatted to that platform's actual expected JSON schema (Slack:
// `blocks`; Teams: MessageCard `sections`/`facts`) — not a generic payload
// sent to both. HONEST LIMITATION: returns false (not a thrown error) when
// no webhookUrl is configured, matching this codebase's simulated-fallback
// convention elsewhere (Twilio/AgentMail) rather than crashing the caller.
// ============================================================================

import type { WebhookAlertPayload } from "../types/cx.js";

const SEVERITY_COLOR: Record<WebhookAlertPayload["severity"], string> = {
  info: "#2563eb",
  warning: "#d97706",
  critical: "#dc2626",
};

function buildSlackPayload(event: WebhookAlertPayload) {
  return {
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${event.severity === "critical" ? "🚨" : event.severity === "warning" ? "⚠️" : "ℹ️"} ${event.title}` } },
      { type: "section", text: { type: "mrkdwn", text: event.message } },
      ...(event.shipmentId ? [{ type: "context", elements: [{ type: "mrkdwn", text: `Shipment: \`${event.shipmentId}\`` }] }] : []),
      ...(event.linkUrl ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View Details" }, url: event.linkUrl }] }] : []),
    ],
  };
}

function buildTeamsPayload(event: WebhookAlertPayload) {
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: SEVERITY_COLOR[event.severity].replace("#", ""),
    title: event.title,
    text: event.message,
    sections: event.shipmentId ? [{ facts: [{ name: "Shipment", value: event.shipmentId }] }] : [],
    potentialAction: event.linkUrl
      ? [{ "@type": "OpenUri", name: "View Details", targets: [{ os: "default", uri: event.linkUrl }] }]
      : [],
  };
}

export async function dispatchSlackTeamsAlert(event: WebhookAlertPayload): Promise<boolean> {
  if (!event.webhookUrl) {
    console.log(`[SIMULATED ${event.platform.toUpperCase()} WEBHOOK — no webhook URL configured for org ${event.orgId}] ${event.title}: ${event.message}`);
    return false;
  }

  const body = event.platform === "slack" ? buildSlackPayload(event) : buildTeamsPayload(event);

  try {
    const response = await fetch(event.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error(`${event.platform} webhook dispatch failed: HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`${event.platform} webhook dispatch error:`, err instanceof Error ? err.message : err);
    return false;
  }
}
