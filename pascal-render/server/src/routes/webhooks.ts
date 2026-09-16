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

export function createWebhooksRouter(): Router {
  const router = Router();

  // Inbound email → Chief of Staff triage → draft in review queue.
  // Normalizes the several shapes upstream providers can send.
  router.post("/webhooks/inbound-email", async (req: Request, res: Response) => {
    const b = req.body ?? {};

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

  return router;
}
