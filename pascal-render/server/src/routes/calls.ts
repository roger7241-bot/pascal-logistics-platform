// ============================================================================
// GET  /api/operator/calls?search=...
// POST /api/operator/calls
// GET  /api/operator/dnc?search=...
// POST /api/operator/dnc
// GET  /api/operator/dnc/check?contact=...
// POST /api/operator/leads/:id/send-rate-proposal-email
// POST /api/operator/leads/:id/send-usmca-packet
//
// CRMCallAssistEngine (Desk #5/#6). HONEST LIMITATION: audio file
// transcription is NOT implemented — needs a real speech-to-text service
// (Whisper, AssemblyAI, Deepgram) which isn't configured. Text transcripts
// (pasted or uploaded .txt/.vtt/.srt) run through the real Claude analysis
// already verified in earlier rounds.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { analyzeCallTranscript } from "../services/callTranscriptAnalysis.js";
import { sendOperationalEmail } from "../services/agentMailDispatch.js";
import { generateSavingsProposal } from "../services/leadsAiAssist.js";

const VALID_OUTCOMES = ["connected", "voicemail", "not_interested", "hot_lead", "opt_out_dnc"];

function normalizeContact(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed.replace(/\s+/g, "");
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) return digitsOnly.slice(1);
  return digitsOnly;
}

function rowToCallLog(row: Record<string, unknown>) {
  return {
    id: row.id,
    leadId: row.lead_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    calledAtIso: (row.called_at as Date).toISOString(),
    durationMinutes: row.duration_minutes,
    transcriptText: row.transcript_text,
    callOutcome: row.call_outcome,
    sentiment: row.sentiment,
    extractedEntities: row.extracted_entities,
    nextSteps: row.next_steps,
    keyNotesSummary: row.key_notes_summary,
    operatorName: row.operator_name,
  };
}

async function addToDncRegistry(contactValue: string, contactName: string | undefined, reason: string, operatorName?: string) {
  await pool.query(
    `INSERT INTO dnc_registry (contact_value, contact_name, reason, operator_name) VALUES ($1,$2,$3,$4)
     ON CONFLICT (contact_value) DO UPDATE SET reason = EXCLUDED.reason, operator_name = EXCLUDED.operator_name`,
    [normalizeContact(contactValue), contactName ?? null, reason, operatorName ?? null],
  );
}

export function createCallsRouter(): Router {
  const router = Router();

  router.get("/calls", async (req: Request, res: Response) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const result = search
      ? await pool.query(`SELECT * FROM call_logs WHERE contact_name ILIKE $1 OR contact_phone ILIKE $1 OR contact_email ILIKE $1 ORDER BY called_at DESC`, [`%${search}%`])
      : await pool.query("SELECT * FROM call_logs ORDER BY called_at DESC");
    res.status(200).json({ calls: result.rows.map(rowToCallLog) });
  });

  router.post("/calls", async (req: Request, res: Response) => {
    const { leadId, contactName, contactPhone, contactEmail, durationMinutes, transcriptText, callOutcome, operatorName } = req.body ?? {};

    if (callOutcome && !VALID_OUTCOMES.includes(callOutcome)) {
      return res.status(400).json({ error: `callOutcome must be one of: ${VALID_OUTCOMES.join(", ")}` });
    }

    if (contactPhone) {
      const dncCheck = await pool.query("SELECT 1 FROM dnc_registry WHERE contact_value = $1", [normalizeContact(contactPhone)]);
      if (dncCheck.rows.length > 0) {
        return res.status(409).json({ error: `${contactPhone} is on the DNC registry — this contact opted out and should not be called.` });
      }
    }

    let analysis;
    if (typeof transcriptText === "string" && transcriptText.trim()) {
      analysis = await analyzeCallTranscript(transcriptText);
    }

    const result = await pool.query(
      `INSERT INTO call_logs (lead_id, contact_name, contact_phone, contact_email, duration_minutes, transcript_text, call_outcome, sentiment, extracted_entities, next_steps, key_notes_summary, operator_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        leadId ?? null,
        contactName ?? null,
        contactPhone ?? null,
        contactEmail ?? null,
        durationMinutes ?? null,
        transcriptText ?? null,
        callOutcome ?? null,
        analysis?.sentiment ?? null,
        analysis ? JSON.stringify(analysis.extractedEntities) : null,
        analysis?.extractedEntities.nextStepsCommitted ?? null,
        analysis?.summary ?? null,
        operatorName ?? null,
      ],
    );

    const callLog = rowToCallLog(result.rows[0]);
    let scheduledEvent = null;
    let bookingEmailResult = null;

    if (callOutcome === "opt_out_dnc" && (contactPhone || contactEmail)) {
      await addToDncRegistry(contactPhone || contactEmail, contactName, "Opted out during call — TCPA/CASL compliance", operatorName);
    }

    if (callOutcome === "hot_lead") {
      const eventResult = await pool.query(
        `INSERT INTO calendar_events (org_id, title, event_type, starts_at, notes) VALUES ($1,$2,'discovery_call',$3,$4) RETURNING *`,
        [
          "org_meridian",
          `Discovery call — ${contactName ?? "prospect"}`,
          new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          analysis ? `Auto-scheduled after hot-lead call. Summary: ${analysis.summary}` : "Auto-scheduled after hot-lead call.",
        ],
      );
      scheduledEvent = eventResult.rows[0];

      if (contactEmail) {
        bookingEmailResult = await sendOperationalEmail(
          contactEmail,
          "Let's find a time to talk — Pascal Logistics",
          `Hi ${contactName ?? "there"},\n\nThanks for the conversation today. I'd love to set up a discovery call to go over how we can help with your cross-border freight — I've held a placeholder slot on our end and will follow up shortly to confirm a time that works for you.\n\nPascal Logistics Operations`,
        );
      }
    }

    return res.status(201).json({
      call: callLog,
      analysis,
      scheduledDiscoveryCall: scheduledEvent ? { id: scheduledEvent.id, title: scheduledEvent.title } : null,
      bookingEmail: bookingEmailResult,
    });
  });

  router.get("/dnc", async (req: Request, res: Response) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const result = search
      ? await pool.query(`SELECT * FROM dnc_registry WHERE contact_name ILIKE $1 OR contact_value ILIKE $1 ORDER BY opted_out_at DESC`, [`%${search}%`])
      : await pool.query("SELECT * FROM dnc_registry ORDER BY opted_out_at DESC");
    res.status(200).json({
      entries: result.rows.map((r) => ({
        id: r.id,
        contactValue: r.contact_value,
        contactName: r.contact_name,
        reason: r.reason,
        operatorName: r.operator_name,
        optedOutAtIso: r.opted_out_at,
      })),
    });
  });

  router.post("/dnc", async (req: Request, res: Response) => {
    const { contactValue, contactName, reason, operatorName } = req.body ?? {};
    if (!contactValue) return res.status(400).json({ error: "contactValue (phone or email) is required." });
    await addToDncRegistry(contactValue, contactName, reason ?? "Opted out", operatorName);
    const result = await pool.query("SELECT * FROM dnc_registry WHERE contact_value = $1", [normalizeContact(contactValue)]);
    return res.status(201).json({ id: result.rows[0].id, contactValue: result.rows[0].contact_value, contactName: result.rows[0].contact_name });
  });

  router.get("/dnc/check", async (req: Request, res: Response) => {
    const contact = typeof req.query.contact === "string" ? req.query.contact : undefined;
    if (!contact) return res.status(400).json({ error: "contact query param is required." });
    const result = await pool.query("SELECT 1 FROM dnc_registry WHERE contact_value = $1", [normalizeContact(contact)]);
    return res.status(200).json({ isOnDncRegistry: result.rows.length > 0 });
  });

  router.post("/leads/:id/send-rate-proposal-email", async (req: Request, res: Response) => {
    const leadResult = await pool.query("SELECT * FROM leads WHERE id = $1", [req.params.id]);
    if (leadResult.rows.length === 0) return res.status(404).json({ error: `No lead on file with id ${req.params.id}.` });
    const lead = leadResult.rows[0];
    if (!lead.contact_email) return res.status(400).json({ error: "This lead has no contact email on file." });

    const proposal = generateSavingsProposal(lead.estimated_annual_value_usd !== null ? Number(lead.estimated_annual_value_usd) : 0);
    const emailResult = await sendOperationalEmail(
      lead.contact_email,
      `Cross-border savings proposal — ${lead.company_name}`,
      `Hi ${lead.contact_name ?? "there"},\n\nBased on your estimated volume, here's what a spot-rate comparison looks like for your lane:\n\nContracted benchmark: $${proposal.perShipmentContractedUsd}/shipment\nSpot market benchmark: $${proposal.perShipmentSpotBenchmarkUsd}/shipment\nEstimated monthly savings: $${proposal.monthlySavingsUsd.toLocaleString()}\nEstimated annual savings: $${proposal.annualSavingsUsd.toLocaleString()}\n\nHappy to walk through the numbers on a call.\n\nPascal Logistics`,
    );
    return res.status(200).json({ proposal, emailResult });
  });

  router.post("/leads/:id/send-usmca-packet", async (req: Request, res: Response) => {
    const leadResult = await pool.query("SELECT * FROM leads WHERE id = $1", [req.params.id]);
    if (leadResult.rows.length === 0) return res.status(404).json({ error: `No lead on file with id ${req.params.id}.` });
    const lead = leadResult.rows[0];
    if (!lead.contact_email) return res.status(400).json({ error: "This lead has no contact email on file." });

    const emailResult = await sendOperationalEmail(
      lead.contact_email,
      "USMCA/CUSMA qualification overview — Pascal Logistics",
      `Hi ${lead.contact_name ?? "there"},\n\nAs discussed, here's a quick overview of USMCA/CUSMA duty-free qualification:\n\n- Goods must meet rules of origin (regional value content or tariff shift, depending on HTS classification)\n- A valid certification (data elements, not a fixed form) must be on file with the importer\n- Certifications are valid up to 4 years but should be re-verified if sourcing changes\n\nWe handle the classification check and certificate generation as part of onboarding — happy to walk through your specific commodities on a call.\n\nPascal Logistics`,
    );
    return res.status(200).json({ emailResult });
  });

  return router;
}
