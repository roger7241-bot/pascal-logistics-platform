// ============================================================================
// ROGER NOTIFY — SMS + email to the operator when something needs him
// One helper both cron jobs and route handlers call. Reads two env vars:
//   ROGER_NOTIFICATION_EMAIL — where "gate landed" alerts email
//   ROGER_NOTIFICATION_PHONE_E164 — where SMS alerts text (e.g. +13603893615)
// Both optional — anything unset just skips silently rather than failing.
// ============================================================================

import { sendOperationalEmail } from "./agentMailDispatch.js";
import { sendDriverSms } from "./twilioMessaging.js";

const alertEmail = process.env.ROGER_NOTIFICATION_EMAIL;
const alertPhone = process.env.ROGER_NOTIFICATION_PHONE_E164;

export interface NotifyOptions {
  channel?: "auto" | "email" | "sms" | "both";
  subject: string;
  message: string;
}

export async function notifyRoger(opts: NotifyOptions): Promise<{ emailSent: boolean; smsSent: boolean }> {
  const channel = opts.channel ?? "auto";
  const wantEmail = channel === "email" || channel === "both" || channel === "auto";
  const wantSms = channel === "sms" || channel === "both";

  let emailSent = false;
  let smsSent = false;

  if (wantEmail && alertEmail) {
    try {
      await sendOperationalEmail(alertEmail, opts.subject, opts.message);
      emailSent = true;
    } catch (err) {
      console.error("notifyRoger email failed:", err);
    }
  }
  if (wantSms && alertPhone) {
    try {
      await sendDriverSms(alertPhone, `${opts.subject}\n\n${opts.message.slice(0, 300)}`);
      smsSent = true;
    } catch (err) {
      console.error("notifyRoger sms failed:", err);
    }
  }
  return { emailSent, smsSent };
}
