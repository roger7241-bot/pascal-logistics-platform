// ============================================================================
// AGENTS ROUTE
// Operator-only endpoints for the AI agent registry + review inbox.
// GET  /api/operator/agents                        list all agents
// GET  /api/operator/agents/drafts?status=pending  review queue
// PATCH /api/operator/agents/drafts/:id            approve / edit / reject
// POST /api/operator/agents/chief-of-staff/simulate  inject a test inbound
//                                                  message so Roger can
//                                                  see the flow end-to-end
//                                                  without live inbox
//                                                  integration yet
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { categorizeAndDraft as chiefCategorize, persistDraft as chiefPersist, type InboundMessage } from "../services/agent6ChiefOfStaff.js";
import { categorizeAndDraft as bookingCategorize, persistDraft as bookingPersist, type BookingEvent } from "../services/agent12BookingDispatch.js";
import { categorizeAndDraft as customsCategorize, persistDraft as customsPersist, type CustomsEvent } from "../services/agent13CustomsLiaison.js";
import { categorizeAndDraft as vettingCategorize, persistDraft as vettingPersist, type VettingRequest } from "../services/agent14CarrierVetting.js";
import { categorizeAndDraft as claimsCategorize, persistDraft as claimsPersist, type ClaimEvent, type ClaimStage } from "../services/agent15ClaimsOsd.js";
import { categorizeAndDraft as financeCategorize, persistDraft as financePersist, type FinanceEvent } from "../services/agent8Finance.js";
import { categorizeAndDraft as marketingCategorize, persistDraft as marketingPersist, type MarketingBrief, type MarketingFormat } from "../services/agent9Marketing.js";
import { categorizeAndDraft as eaCategorize, persistDraft as eaPersist, type EaRequest } from "../services/agent7ExecutiveAssistant.js";

export function createAgentsRouter(): Router {
  const router = Router();

  router.get("/agents", async (_req: Request, res: Response) => {
    const registryResult = await pool.query(
      `SELECT agent_key, agent_number, name, role, description, status, human_in_loop, last_run_at, last_run_status
       FROM agent_registry ORDER BY agent_number ASC`,
    );
    const draftCounts = await pool.query(
      `SELECT agent_key, COUNT(*) FILTER (WHERE status = 'pending') AS pending
       FROM agent_drafts GROUP BY agent_key`,
    );
    const byKey = new Map<string, number>();
    for (const row of draftCounts.rows) byKey.set(row.agent_key, Number(row.pending));

    return res.status(200).json({
      agents: registryResult.rows.map((r) => ({
        agentKey: r.agent_key,
        agentNumber: Number(r.agent_number),
        name: r.name,
        role: r.role,
        description: r.description,
        status: r.status,
        humanInLoop: r.human_in_loop,
        lastRunAtIso: r.last_run_at ? (r.last_run_at as Date).toISOString() : undefined,
        lastRunStatus: r.last_run_status,
        pendingDrafts: byKey.get(r.agent_key) ?? 0,
      })),
    });
  });

  router.get("/agents/drafts", async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const agentKey = typeof req.query.agentKey === "string" ? req.query.agentKey : undefined;
    const params: string[] = [status];
    let where = "WHERE status = $1";
    if (agentKey) {
      params.push(agentKey);
      where += ` AND agent_key = $2`;
    }
    const result = await pool.query(
      `SELECT id, agent_key, kind, category, subject, source_ref, payload, status, operator_notes, reviewed_at, reviewer_email, created_at
       FROM agent_drafts ${where} ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    return res.status(200).json({ drafts: result.rows });
  });

  router.patch("/agents/drafts/:id", async (req: Request, res: Response) => {
    const { status, operatorNotes, payload } = req.body ?? {};
    if (status !== "approved" && status !== "rejected" && status !== "sent" && status !== "archived") {
      return res.status(400).json({ error: "status must be 'approved', 'rejected', 'sent', or 'archived'." });
    }
    const setClauses = ["status = $1", "operator_notes = COALESCE($2, operator_notes)", "reviewed_at = now()", "reviewer_email = $3"];
    const params: unknown[] = [status, operatorNotes ?? null, req.authUser?.email ?? null];
    if (payload && typeof payload === "object") {
      setClauses.push(`payload = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(payload));
    }
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE agent_drafts SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Draft not found." });
    return res.status(200).json({ draft: result.rows[0] });
  });

  // Test-only endpoint — inject a fake inbound message so Roger can watch
  // the Chief of Staff flow end-to-end before live inbox integration.
  router.post("/agents/chief-of-staff/simulate", async (req: Request, res: Response) => {
    const { fromEmail, fromName, subject, body } = req.body ?? {};
    if (!fromEmail || !subject || !body) {
      return res.status(400).json({ error: "fromEmail, subject, and body are required." });
    }
    const message: InboundMessage = {
      fromEmail: String(fromEmail),
      fromName: fromName ? String(fromName) : undefined,
      subject: String(subject),
      body: String(body),
      receivedAtIso: new Date().toISOString(),
    };
    const output = await chiefCategorize(message);
    const draft = await chiefPersist(message, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  // Simulate a booking / dispatch milestone. Any field missing gets a sane
  // default so Roger can just fill in the event type and see a draft come out.
  router.post("/agents/booking-dispatch/simulate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.shipmentRef || !b.eventType || !b.eventDetail) {
      return res.status(400).json({ error: "shipmentRef, eventType, and eventDetail are required." });
    }
    const event: BookingEvent = {
      shipmentRef: String(b.shipmentRef),
      carrier: String(b.carrier ?? "TBD"),
      origin: String(b.origin ?? "TBD"),
      destination: String(b.destination ?? "TBD"),
      eventType: String(b.eventType),
      eventDetail: String(b.eventDetail),
      eventAtIso: new Date().toISOString(),
      clientEmail: b.clientEmail ? String(b.clientEmail) : undefined,
      clientName: b.clientName ? String(b.clientName) : undefined,
    };
    const output = await bookingCategorize(event);
    const draft = await bookingPersist(event, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  // Simulate a customs event. Doc checkboxes default to a realistic
  // cross-border packet so Roger can toggle one off and see the flag fire.
  router.post("/agents/customs-liaison/simulate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.shipmentRef || !b.brokerName || !b.eventType) {
      return res.status(400).json({ error: "shipmentRef, brokerName, and eventType are required." });
    }
    const event: CustomsEvent = {
      shipmentRef: String(b.shipmentRef),
      direction: b.direction === "north_to_south" || b.direction === "south_to_north" || b.direction === "domestic" ? b.direction : "south_to_north",
      brokerName: String(b.brokerName),
      brokerEmail: b.brokerEmail ? String(b.brokerEmail) : undefined,
      eventType: String(b.eventType),
      eventDetail: String(b.eventDetail ?? ""),
      hasCommercialInvoice: b.hasCommercialInvoice !== false,
      hasPackingList: b.hasPackingList !== false,
      hasUsmcaCert: b.hasUsmcaCert !== false,
      hasPoaOnFile: b.hasPoaOnFile !== false,
      isDg: b.isDg === true,
      hasDgPapers: b.hasDgPapers !== false,
      entryNumber: b.entryNumber ? String(b.entryNumber) : undefined,
      clientEmail: b.clientEmail ? String(b.clientEmail) : undefined,
      clientName: b.clientName ? String(b.clientName) : undefined,
    };
    const output = await customsCategorize(event);
    const draft = await customsPersist(event, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  // Simulate a carrier vetting request. Defaults land at a clean carrier so
  // Roger can toggle any red flag (expired insurance, high SMS score, no W9)
  // and see the deterministic audit fire.
  router.post("/agents/carrier-vetting/simulate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.carrierName || !b.eventType) {
      return res.status(400).json({ error: "carrierName and eventType are required." });
    }
    const request: VettingRequest = {
      carrierName: String(b.carrierName),
      mcNumber: b.mcNumber ? String(b.mcNumber) : undefined,
      dotNumber: b.dotNumber ? String(b.dotNumber) : undefined,
      eventType: String(b.eventType),
      authorityActive: b.authorityActive !== false,
      insuranceAutoLiabilityUsd: typeof b.insuranceAutoLiabilityUsd === "number" ? b.insuranceAutoLiabilityUsd : 1_000_000,
      insuranceCargoUsd: typeof b.insuranceCargoUsd === "number" ? b.insuranceCargoUsd : 100_000,
      insuranceExpiresIso: b.insuranceExpiresIso ? String(b.insuranceExpiresIso) : undefined,
      smsUnsafeDriving: typeof b.smsUnsafeDriving === "number" ? b.smsUnsafeDriving : undefined,
      smsHoursOfService: typeof b.smsHoursOfService === "number" ? b.smsHoursOfService : undefined,
      smsVehicleMaintenance: typeof b.smsVehicleMaintenance === "number" ? b.smsVehicleMaintenance : undefined,
      hasW9OnFile: b.hasW9OnFile !== false,
      lastVerifiedIso: b.lastVerifiedIso ? String(b.lastVerifiedIso) : undefined,
      notes: b.notes ? String(b.notes) : undefined,
    };
    const output = await vettingCategorize(request);
    const draft = await vettingPersist(request, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  // Simulate a claim event. Defaults land at damage on LTL with photos +
  // POD but no BOL notation, so the concealed-damage warning fires.
  router.post("/agents/claims-osd/simulate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.shipmentRef || !b.carrier || !b.eventType) {
      return res.status(400).json({ error: "shipmentRef, carrier, and eventType are required." });
    }
    const validModes: ClaimEvent["mode"][] = ["ltl", "tl", "ocean", "air", "rail", "unknown"];
    const validStages: ClaimStage[] = ["intake", "claim_filed", "carrier_response", "negotiation", "resolved", "denied", "escalated"];
    const event: ClaimEvent = {
      shipmentRef: String(b.shipmentRef),
      mode: validModes.includes(b.mode) ? b.mode : "ltl",
      carrier: String(b.carrier),
      clientName: b.clientName ? String(b.clientName) : undefined,
      clientEmail: b.clientEmail ? String(b.clientEmail) : undefined,
      eventType: String(b.eventType),
      eventDetail: String(b.eventDetail ?? ""),
      invoiceValueUsd: typeof b.invoiceValueUsd === "number" ? b.invoiceValueUsd : undefined,
      damagedValueUsd: typeof b.damagedValueUsd === "number" ? b.damagedValueUsd : undefined,
      hasPhotos: b.hasPhotos !== false,
      hasBolNotation: b.hasBolNotation === true,
      hasSignedPod: b.hasSignedPod !== false,
      deliveredAtIso: b.deliveredAtIso ? String(b.deliveredAtIso) : undefined,
      stage: validStages.includes(b.stage) ? b.stage : "intake",
      claimAmountUsd: typeof b.claimAmountUsd === "number" ? b.claimAmountUsd : undefined,
      filedAtIso: b.filedAtIso ? String(b.filedAtIso) : undefined,
    };
    const output = await claimsCategorize(event);
    const draft = await claimsPersist(event, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  // Simulate a finance event — new invoice, payment received, or past-due chase.
  router.post("/agents/finance/simulate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.clientName || !b.eventType) {
      return res.status(400).json({ error: "clientName and eventType are required." });
    }
    const event: FinanceEvent = {
      clientName: String(b.clientName),
      clientEmail: b.clientEmail ? String(b.clientEmail) : undefined,
      eventType: String(b.eventType),
      eventDetail: String(b.eventDetail ?? ""),
      invoiceNumber: b.invoiceNumber ? String(b.invoiceNumber) : undefined,
      amountUsd: typeof b.amountUsd === "number" ? b.amountUsd : undefined,
      currency: b.currency === "CAD" ? "CAD" : "USD",
      daysPastDue: typeof b.daysPastDue === "number" ? b.daysPastDue : undefined,
      paidAtIso: b.paidAtIso ? String(b.paidAtIso) : undefined,
      dueAtIso: b.dueAtIso ? String(b.dueAtIso) : undefined,
      stripeRef: b.stripeRef ? String(b.stripeRef) : undefined,
      quickbooksRef: b.quickbooksRef ? String(b.quickbooksRef) : undefined,
      serviceDescription: b.serviceDescription ? String(b.serviceDescription) : undefined,
    };
    const output = await financeCategorize(event);
    const draft = await financePersist(event, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  // Simulate a marketing brief — newsletter, LinkedIn, cold email, or SEO angle.
  router.post("/agents/marketing/simulate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.audience || !b.topic || !b.desiredCta) {
      return res.status(400).json({ error: "audience, topic, and desiredCta are required." });
    }
    const validFormats: MarketingFormat[] = ["newsletter", "linkedin_post", "cold_email", "seo_angle", "other"];
    const brief: MarketingBrief = {
      format: validFormats.includes(b.format) ? b.format : "cold_email",
      audience: String(b.audience),
      topic: String(b.topic),
      keyPoints: Array.isArray(b.keyPoints) ? b.keyPoints.map(String).slice(0, 5) : [],
      prospectName: b.prospectName ? String(b.prospectName) : undefined,
      prospectCompany: b.prospectCompany ? String(b.prospectCompany) : undefined,
      prospectRole: b.prospectRole ? String(b.prospectRole) : undefined,
      currentPainSignal: b.currentPainSignal ? String(b.currentPainSignal) : undefined,
      desiredCta: String(b.desiredCta),
    };
    const output = await marketingCategorize(brief);
    const draft = await marketingPersist(brief, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  // Simulate an EA request — scheduling, meeting prep, onboarding, follow-up.
  router.post("/agents/executive-assistant/simulate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    if (!b.eventType || !b.requestDetail) {
      return res.status(400).json({ error: "eventType and requestDetail are required." });
    }
    const request: EaRequest = {
      eventType: String(b.eventType),
      contactName: b.contactName ? String(b.contactName) : undefined,
      contactEmail: b.contactEmail ? String(b.contactEmail) : undefined,
      contactCompany: b.contactCompany ? String(b.contactCompany) : undefined,
      contactRole: b.contactRole ? String(b.contactRole) : undefined,
      requestDetail: String(b.requestDetail),
      meetingWhenIso: b.meetingWhenIso ? String(b.meetingWhenIso) : undefined,
      onboardingStep: b.onboardingStep ? String(b.onboardingStep) : undefined,
      priorContext: b.priorContext ? String(b.priorContext) : undefined,
    };
    const output = await eaCategorize(request);
    const draft = await eaPersist(request, output, `simulated:${Date.now()}`);
    return res.status(201).json({ draft, output });
  });

  return router;
}
