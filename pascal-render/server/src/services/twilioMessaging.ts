// ============================================================================
// TWILIO MESSAGING
// Real Twilio SDK integration for driver SMS/WhatsApp notifications and
// Tier 2 broker email fallback context. Requires TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER (all provisioned as sync:false
// in render.yaml). Falls back to a console-logged simulation when
// credentials aren't configured, so local development and this sandbox
// (which has no live Twilio account) don't hard-fail — but the send path
// itself is genuinely real, not a stub, the moment credentials exist.
// ============================================================================

import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

const client = accountSid && authToken ? twilio(accountSid, authToken) : undefined;

export interface MessageDispatchResult {
  success: boolean;
  simulated: boolean;
  sid?: string;
  error?: string;
}

export async function sendDriverSms(toPhoneE164: string, body: string): Promise<MessageDispatchResult> {
  if (!client || !fromNumber) {
    console.log(`[SIMULATED SMS — no Twilio credentials configured] To ${toPhoneE164}: "${body}"`);
    return { success: true, simulated: true };
  }

  try {
    const message = await client.messages.create({ to: toPhoneE164, from: fromNumber, body });
    return { success: true, simulated: false, sid: message.sid };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Twilio error";
    console.error(`Twilio SMS send failed to ${toPhoneE164}: ${error}`);
    return { success: false, simulated: false, error };
  }
}

export async function sendDriverWhatsApp(toPhoneE164: string, body: string): Promise<MessageDispatchResult> {
  if (!client || !fromNumber) {
    console.log(`[SIMULATED WHATSAPP — no Twilio credentials configured] To ${toPhoneE164}: "${body}"`);
    return { success: true, simulated: true };
  }

  try {
    // Twilio's WhatsApp channel requires the whatsapp: prefix on both
    // numbers, and a from-number that's been enabled for WhatsApp in the
    // Twilio console — a real deployment configures that separately from
    // the plain-SMS from-number.
    const message = await client.messages.create({ to: `whatsapp:${toPhoneE164}`, from: `whatsapp:${fromNumber}`, body });
    return { success: true, simulated: false, sid: message.sid };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown Twilio error";
    console.error(`Twilio WhatsApp send failed to ${toPhoneE164}: ${error}`);
    return { success: false, simulated: false, error };
  }
}
