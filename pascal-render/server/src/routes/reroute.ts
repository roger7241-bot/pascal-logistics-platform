// ============================================================================
// GET   /api/reroute/advisories                          — list (optional shipmentId filter)
// POST  /api/reroute/advisories                            — create (system/operator, from a live border reading)
// POST  /api/reroute/advisories/:id/client-signoff          — handleClientRerouteSignoff
// POST  /api/reroute/advisories/:id/broker-confirm           — handleBrokerConfirmation
//
// Consultative Reroute & Broker Notification Workflow (Prompts 36 & 39).
// Non-unilateral: creating an advisory NEVER reroutes anything by itself —
// it only starts at 'pending_client_signoff'. Only an explicit, named
// Client Logistics Manager sign-off can move it forward, and only an
// explicit broker confirmation can release driver dispatch.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { sendOperationalEmail } from "../services/agentMailDispatch.js";
import { buildAceAciAmendmentPackage } from "../services/aceAciAmendment.js";
import { dispatchSlackTeamsAlert } from "../services/alertWebhook.js";
import type { RerouteAdvisory } from "../types/reroute.js";
import type { PoeId } from "../types/borderTelemetry.js";

const DEFAULT_BROKER_EMAIL = "broker@pascallogistics-broker.example.com"; // stand-in for a real broker-of-record contact on file

function rowToAdvisory(row: Record<string, unknown>): RerouteAdvisory {
  return {
    id: row.id as string,
    shipmentId: row.shipment_id as string,
    fromPoeId: row.from_poe_id as PoeId,
    toPoeId: row.to_poe_id as PoeId,
    fromWaitMinutes: row.from_wait_minutes as number,
    toWaitMinutes: row.to_wait_minutes as number,
    deltaMinutes: row.delta_minutes as number,
    netTimeSavedMinutes: row.net_time_saved_minutes as number,
    netValueUsd: Number(row.net_value_usd),
    status: row.status as RerouteAdvisory["status"],
    clientSignoffName: (row.client_signoff_name as string) ?? undefined,
    clientSignoffAtIso: row.client_signoff_at ? new Date(row.client_signoff_at as string).toISOString() : undefined,
    brokerEmail: (row.broker_email as string) ?? undefined,
    originalPortCode: (row.original_port_code as string) ?? undefined,
    amendedPortCode: (row.amended_port_code as string) ?? undefined,
    brokerConfirmedAtIso: row.broker_confirmed_at ? new Date(row.broker_confirmed_at as string).toISOString() : undefined,
    dispatchReleasedAtIso: row.dispatch_released_at ? new Date(row.dispatch_released_at as string).toISOString() : undefined,
    createdAtIso: new Date(row.created_at as string).toISOString(),
  };
}

export function createRerouteRouter(): Router {
  const router = Router();

  router.get("/advisories", async (req: Request, res: Response) => {
    const shipmentId = typeof req.query.shipmentId === "string" ? req.query.shipmentId : undefined;
    const result = shipmentId
      ? await pool.query("SELECT * FROM reroute_advisories WHERE shipment_id = $1 ORDER BY created_at DESC", [shipmentId])
      : await pool.query("SELECT * FROM reroute_advisories ORDER BY created_at DESC");
    res.status(200).json({ advisories: result.rows.map(rowToAdvisory) });
  });

  router.post("/advisories", async (req: Request, res: Response) => {
    const { shipmentId, fromPoeId, toPoeId, fromWaitMinutes, toWaitMinutes, netTimeSavedMinutes, netValueUsd, brokerEmail } = req.body as Partial<{
      shipmentId: string;
      fromPoeId: PoeId;
      toPoeId: PoeId;
      fromWaitMinutes: number;
      toWaitMinutes: number;
      netTimeSavedMinutes: number;
      netValueUsd: number;
      brokerEmail: string;
    }>;

    if (!shipmentId || !fromPoeId || !toPoeId || fromWaitMinutes === undefined || toWaitMinutes === undefined) {
      return res.status(400).json({ error: "shipmentId, fromPoeId, toPoeId, fromWaitMinutes, and toWaitMinutes are required." });
    }
    const deltaMinutes = fromWaitMinutes - toWaitMinutes;
    if (deltaMinutes <= 30) {
      // 30-Min Delay Threshold Guard — enforced here AND at the DB CHECK constraint.
      return res.status(422).json({ error: `Delta of ${deltaMinutes} minutes does not clear the 30-minute advisory threshold — no advisory created.` });
    }

    const result = await pool.query(
      `INSERT INTO reroute_advisories (shipment_id, from_poe_id, to_poe_id, from_wait_minutes, to_wait_minutes, delta_minutes, net_time_saved_minutes, net_value_usd, broker_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [shipmentId, fromPoeId, toPoeId, fromWaitMinutes, toWaitMinutes, deltaMinutes, netTimeSavedMinutes ?? 0, netValueUsd ?? 0, brokerEmail ?? DEFAULT_BROKER_EMAIL],
    );

    // Real webhook dispatch — a new reroute advisory needing client
    // sign-off is exactly the kind of time-sensitive event Slack/Teams
    // alerts are for. Honestly no-ops (returns false, doesn't throw) when
    // the org has no webhook URL on file — see services/alertWebhook.ts.
    const orgResult = await pool.query("SELECT org_id, slack_webhook_url FROM accounts WHERE org_id = $1", ["org_meridian"]); // single-tenant demo — same DEMO_ORG_ID convention used across this codebase
    const orgRow = orgResult.rows[0];
    if (orgRow) {
      await dispatchSlackTeamsAlert({
        orgId: orgRow.org_id,
        platform: "slack",
        webhookUrl: orgRow.slack_webhook_url ?? "",
        severity: "warning",
        title: "Reroute Advisory Needs Sign-off",
        message: `Shipment ${shipmentId}: ${fromPoeId} → ${toPoeId}, ${deltaMinutes}min faster. Awaiting Client Logistics Manager approval.`,
        shipmentId,
      });
    }

    return res.status(201).json(rowToAdvisory(result.rows[0]));
  });

  router.post("/advisories/:id/client-signoff", async (req: Request, res: Response) => {
    const { approved, clientSignoffName } = req.body as { approved?: boolean; clientSignoffName?: string };
    if (!clientSignoffName?.trim()) {
      return res.status(400).json({ error: "clientSignoffName (the Client's Logistics Manager) is required — sign-off cannot be anonymous or operator-issued." });
    }

    const existing = await pool.query("SELECT * FROM reroute_advisories WHERE id = $1", [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Advisory not found." });
    const advisory = rowToAdvisory(existing.rows[0]);
    if (advisory.status !== "pending_client_signoff") {
      return res.status(409).json({ error: `Advisory is already past the sign-off stage (status: ${advisory.status}).` });
    }

    if (!approved) {
      const declined = await pool.query(
        `UPDATE reroute_advisories SET status = 'client_declined', client_signoff_name = $1, client_signoff_at = now() WHERE id = $2 RETURNING *`,
        [clientSignoffName, req.params.id],
      );
      return res.status(200).json(rowToAdvisory(declined.rows[0]));
    }

    // Approved — draft and send the real ACE/ACI amendment package, then hold at pending_broker_confirmation.
    const amendment = buildAceAciAmendmentPackage({
      shipmentId: advisory.shipmentId,
      fromPoeId: advisory.fromPoeId,
      toPoeId: advisory.toPoeId,
      clientSignoffName,
    });
    const emailDispatch = await sendOperationalEmail(advisory.brokerEmail ?? DEFAULT_BROKER_EMAIL, amendment.emailSubject, amendment.emailBody);

    const updated = await pool.query(
      `UPDATE reroute_advisories SET
        status = 'pending_broker_confirmation',
        client_signoff_name = $1, client_signoff_at = now(),
        original_port_code = $2, amended_port_code = $3
       WHERE id = $4 RETURNING *`,
      [clientSignoffName, amendment.fromPortCode, amendment.toPortCode, req.params.id],
    );

    return res.status(200).json({ advisory: rowToAdvisory(updated.rows[0]), brokerEmailDispatch: emailDispatch });
  });

  router.post("/advisories/:id/broker-confirm", async (req: Request, res: Response) => {
    const existing = await pool.query("SELECT * FROM reroute_advisories WHERE id = $1", [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Advisory not found." });
    const advisory = rowToAdvisory(existing.rows[0]);
    if (advisory.status !== "pending_broker_confirmation") {
      return res.status(409).json({ error: `Advisory is not awaiting broker confirmation (status: ${advisory.status}). Driver dispatch was never held on this advisory, or has already been released.` });
    }

    const result = await pool.query(
      `UPDATE reroute_advisories SET status = 'dispatch_released', broker_confirmed_at = now(), dispatch_released_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    return res.status(200).json(rowToAdvisory(result.rows[0]));
  });

  return router;
}
