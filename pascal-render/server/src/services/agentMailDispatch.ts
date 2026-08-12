// ============================================================================
// AGENTMAIL — real email dispatch for broker notifications (POA lifecycle)
// and Tier 2 legacy carrier status inquiries. Requires AGENTMAIL_API_KEY
// (provisioned as sync:false in render.yaml). Lazily creates and caches one
// inbox for "operations@pascallogistics.com"-equivalent sending — matching
// the Agent 6 pattern established elsewhere in this platform — rather than
// requiring a manual inbox-creation step before the app can send mail.
// Falls back to a console-logged simulation when no API key is configured,
// same pattern as the Twilio module, so this sandbox and local dev don't
// hard-fail without credentials.
// ============================================================================

import { AgentMailClient } from "agentmail";

const apiKey = process.env.AGENTMAIL_API_KEY;
const client = apiKey ? new AgentMailClient({ apiKey }) : undefined;

let cachedInboxId: string | undefined;

async function getOrCreateOperationsInbox(): Promise<string | undefined> {
  if (!client) return undefined;
  if (cachedInboxId) return cachedInboxId;

  // client_id makes this idempotent — re-running on redeploy reuses the
  // same inbox instead of creating a new one each time.
  const inbox = await client.inboxes.create({ clientId: "pascal-logistics-operations-v1" });
  cachedInboxId = inbox.inboxId;
  return cachedInboxId;
}

export interface EmailDispatchResult {
  success: boolean;
  simulated: boolean;
  messageId?: string;
  error?: string;
}

export async function sendOperationalEmail(to: string, subject: string, text: string): Promise<EmailDispatchResult> {
  if (!client) {
    console.log(`[SIMULATED EMAIL — no AgentMail API key configured] To: ${to} | Subject: "${subject}" | Body: "${text}"`);
    return { success: true, simulated: true };
  }

  try {
    const inboxId = await getOrCreateOperationsInbox();
    if (!inboxId) throw new Error("Could not provision an operations inbox.");

    const message = await client.inboxes.messages.send(inboxId, { to, subject, text });
    return { success: true, simulated: false, messageId: message.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown AgentMail error";
    console.error(`AgentMail send failed to ${to}: ${error}`);
    return { success: false, simulated: false, error };
  }
}
