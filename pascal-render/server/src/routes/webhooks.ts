// ============================================================================
// PUBLIC WEBHOOKS
// Endpoints external systems POST to. NOT gated by requireAuth or
// requireOperator — mounted at /api/webhooks before those middleware kick in.
// Every handler validates its own shape and rejects everything unknown.
//
// Currently:
//   POST /webhooks/inbound-email — AgentMail / Postmark / SES / generic
//     inbound-email payload. Chief of Staff triages and drafts a reply
//     landing in the operator review queue.
//   POST /webhooks/tracking — Terminal49 / CargoAi milestone push.
//     Milestone gets appended to shipment_milestones; is_exception fires
//     the transit_exception playbook.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { categorizeAndDraft as chiefCategorize, persistDraft as chiefPersist, type InboundMessage } from "../services/agent6ChiefOfStaff.js";
import { redeemSmsToken } from "../services/smsTokens.js";
import { continueTask } from "../services/quarterback.js";
import { dispatchDraft } from "../services/draftDispatch.js";

export function createWebhooksRouter(): Router {
  const router = Router();

  // Inbound email → Chief of Staff triage → draft in review queue.
  // Normalizes the several shapes upstream providers can send.
  router.post("/webhooks/inbound-email", async (req: Request, res: Response) => {
    const raw = req.body ?? {};

    // AgentMail wraps the payload as { type: "event", event_type, message: {...} }.
    // Postmark/SES/generic providers send fields at the top level. Unwrap when needed.
    const b: Record<string, unknown> = (
      raw && typeof raw === "object"
      && (raw as { type?: unknown }).type === "event"
      && (raw as { message?: unknown }).message
      && typeof (raw as { message?: unknown }).message === "object"
    )
      ? (raw as { message: Record<string, unknown> }).message
      : (raw as Record<string, unknown>);

    // AgentMail native shape
    let fromEmail = typeof b.from_email === "string" ? b.from_email
                  : typeof b.fromEmail === "string" ? b.fromEmail
                  : typeof b.From === "string" ? b.From
                  : typeof b.from === "string" ? b.from
                  : "";
    // Some providers wrap "Name <email@x.com>"
    const match = fromEmail.match(/<([^>]+)>/);
    if (match) fromEmail = match[1];

    const fromName = typeof b.from_name === "string" ? b.from_name
                   : typeof b.fromName === "string" ? b.fromName
                   : typeof b.FromName === "string" ? b.FromName
                   : undefined;

    const subject = typeof b.subject === "string" ? b.subject
                  : typeof b.Subject === "string" ? b.Subject
                  : "";

    const body = typeof b.text === "string" ? b.text
               : typeof b.body === "string" ? b.body
               : typeof b.TextBody === "string" ? b.TextBody
               : typeof b.text_body === "string" ? b.text_body
               : "";

    if (!fromEmail || !subject || !body) {
      return res.status(400).json({ error: "Payload must include fromEmail (or from), subject, and body (or text)." });
    }

    const messageIdRaw = typeof b.message_id === "string" ? b.message_id
                       : typeof b.MessageID === "string" ? b.MessageID
                       : undefined;

    const message: InboundMessage = {
      fromEmail,
      fromName,
      subject,
      body,
      receivedAtIso: new Date().toISOString(),
    };

    try {
      const output = await chiefCategorize(message);
      const draft = await chiefPersist(message, output, messageIdRaw ? `inbound:${messageIdRaw}` : `inbound:${Date.now()}`);
      return res.status(201).json({ draftId: draft.id, category: output.category, priority: output.priority });
    } catch (err) {
      console.error("Inbound email webhook failed:", err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "Webhook processing failed." });
    }
  });

  // Tracking milestone webhook — Terminal49 / CargoAi push a new event.
  // We accept a normalized shape; provider-specific transforms live in the
  // aggregator's webhook forwarder or a lightweight middleware.
  router.post("/webhooks/tracking", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const subscriptionId = typeof b.subscriptionId === "string" ? b.subscriptionId : undefined;
    const eventType = typeof b.eventType === "string" ? b.eventType : undefined;
    const occurredAt = typeof b.occurredAtIso === "string" ? b.occurredAtIso : undefined;
    if (!subscriptionId || !eventType || !occurredAt) {
      return res.status(400).json({ error: "Payload must include subscriptionId, eventType, occurredAtIso." });
    }

    // Verify subscription exists.
    const sub = await pool.query(`SELECT id FROM tracking_subscriptions WHERE id = $1`, [subscriptionId]);
    if ((sub.rowCount ?? 0) === 0) return res.status(404).json({ error: "Subscription not found." });

    await pool.query(
      `INSERT INTO shipment_milestones
         (subscription_id, event_type, event_code, location, latitude, longitude,
          occurred_at, is_exception, details, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT DO NOTHING`,
      [
        subscriptionId, eventType,
        b.eventCode ?? null,
        b.location ?? null,
        typeof b.latitude === "number" ? b.latitude : null,
        typeof b.longitude === "number" ? b.longitude : null,
        occurredAt,
        b.isException === true,
        JSON.stringify(b.details ?? {}),
        typeof b.source === "string" ? b.source : "unknown_webhook",
      ],
    );
    await pool.query(`UPDATE tracking_subscriptions SET last_sync_at = now() WHERE id = $1`, [subscriptionId]);

    return res.status(201).json({ received: true });
  });

  // Twilio inbound SMS webhook — Roger texts back "YES 4271" to approve
  // or "NO 4271" to reject a gated task. Twilio sends the SMS body as
  // "Body" in an application/x-www-form-urlencoded POST.
  router.post("/webhooks/sms-inbound", async (req: Request, res: Response) => {
    const body = typeof req.body?.Body === "string" ? req.body.Body : typeof req.body?.body === "string" ? req.body.body : "";
    if (!body) {
      return res.set("Content-Type", "text/xml").status(200).send("<Response></Response>");
    }
    try {
      const redeemed = await redeemSmsToken(body);
      if (!redeemed) {
        return res.set("Content-Type", "text/xml").status(200).send(
          `<Response><Message>No matching pending code found in your message. Reply "YES 1234" or "NO 1234" using the 4-digit code from the alert.</Message></Response>`,
        );
      }

      let replyText = "";
      if (redeemed.targetType === "task") {
        if (redeemed.action === "sent") {
          const result = await continueTask(redeemed.targetId);
          replyText = `Approved. Play resumed — ${result.stepsExecuted} steps executed${result.stepsGated > 0 ? `, ${result.stepsGated} more gates.` : ", play complete."}`;
        } else {
          await pool.query(`UPDATE agent_tasks SET status = 'rejected', updated_at = now() WHERE id = $1`, [redeemed.targetId]);
          replyText = "Rejected. Task closed.";
        }
      } else {
        const drafts = await pool.query(`UPDATE agent_drafts SET status = $1, reviewed_at = now() WHERE id = $2 RETURNING agent_key, payload`, [redeemed.action, redeemed.targetId]);
        if (drafts.rows.length > 0 && redeemed.action === "sent") {
          try {
            const disp = await dispatchDraft(drafts.rows[0]);
            replyText = disp.attempted ? `Sent to ${disp.recipient}.` : `Marked sent but ${disp.reason}`;
          } catch (err) {
            replyText = `Marked sent but dispatch failed: ${err instanceof Error ? err.message : "error"}`;
          }
        } else {
          replyText = `Draft ${redeemed.action}.`;
        }
      }
      return res.set("Content-Type", "text/xml").status(200).send(
        `<Response><Message>${replyText}</Message></Response>`,
      );
    } catch (err) {
      console.error("SMS webhook processing failed:", err);
      return res.set("Content-Type", "text/xml").status(200).send(
        `<Response><Message>Something went wrong on our side. Roger will check the AI Agents board.</Message></Response>`,
      );
    }
  });

  return router;
}
