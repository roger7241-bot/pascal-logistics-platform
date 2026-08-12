// ============================================================================
// GET   /api/operator/leads
// GET   /api/operator/leads/segments
// GET   /api/operator/leads/pipeline-kpis — real KPIs, not fabricated
// POST  /api/operator/leads
// PATCH /api/operator/leads/:id/stage — real first_contact_at/decided_at
//       timestamp capture, which is what makes sales velocity a genuine
//       computed number rather than a placeholder.
// POST  /api/operator/leads/:id/draft-intro-email
// POST  /api/operator/leads/:id/savings-proposal
// POST  /api/operator/leads/:id/convert-to-account — genuinely creates a
//       real row in the accounts table (CRM Desk #6), not just a UI
//       transition.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { draftIntroEmail, generateSavingsProposal } from "../services/leadsAiAssist.js";

const VALID_STAGES = ["new_unqualified", "discovery_sop_review", "rfq_issued", "retainer_sent", "closed_won", "lost"];

function rowToLead(row: Record<string, unknown>) {
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    segment: row.segment,
    source: row.source,
    stage: row.stage,
    notes: row.notes,
    estimatedAnnualValueUsd: row.estimated_annual_value_usd !== null ? Number(row.estimated_annual_value_usd) : undefined,
    estimatedMonthlyVolume: row.estimated_monthly_volume,
    primaryTransportMode: row.primary_transport_mode,
    targetBorderCrossing: row.target_border_crossing,
    legalEntity: row.legal_entity,
    operatingRegions: row.operating_regions,
    commodities: row.commodities,
    targetLanes: row.target_lanes,
    leadChannel: row.lead_channel,
    firstContactAtIso: row.first_contact_at ? (row.first_contact_at as Date).toISOString() : undefined,
    decidedAtIso: row.decided_at ? (row.decided_at as Date).toISOString() : undefined,
    createdAt: row.created_at,
  };
}

export function createLeadsRouter(): Router {
  const router = Router();

  router.get("/leads", async (req: Request, res: Response) => {
    const segment = typeof req.query.segment === "string" ? req.query.segment : undefined;
    const result = segment
      ? await pool.query("SELECT * FROM leads WHERE segment = $1 ORDER BY created_at DESC", [segment])
      : await pool.query("SELECT * FROM leads ORDER BY created_at DESC");
    res.status(200).json({ leads: result.rows.map(rowToLead) });
  });

  router.get("/leads/segments", async (_req: Request, res: Response) => {
    const result = await pool.query("SELECT DISTINCT segment FROM leads WHERE segment IS NOT NULL ORDER BY segment");
    res.status(200).json({ segments: result.rows.map((r) => r.segment) });
  });

  router.get("/leads/pipeline-kpis", async (_req: Request, res: Response) => {
    const pipelineResult = await pool.query(
      "SELECT COALESCE(SUM(estimated_annual_value_usd), 0) AS total FROM leads WHERE stage NOT IN ('closed_won', 'lost')",
    );
    const activePipelineValueUsd = Number(pipelineResult.rows[0].total);

    const monthlyResult = await pool.query(
      "SELECT COUNT(*) AS count FROM leads WHERE created_at >= date_trunc('month', now()) AND stage != 'new_unqualified'",
    );
    const monthlyQualifiedLeads = Number(monthlyResult.rows[0].count);

    const winRateResult = await pool.query(
      "SELECT COUNT(*) FILTER (WHERE stage = 'closed_won') AS won, COUNT(*) FILTER (WHERE stage IN ('closed_won', 'lost')) AS decided FROM leads",
    );
    const won = Number(winRateResult.rows[0].won);
    const decided = Number(winRateResult.rows[0].decided);
    const winRatePct = decided > 0 ? Math.round((won / decided) * 100) : undefined;

    // Defensive: excludes any row where decided_at somehow precedes
    // first_contact_at (bad/imported historical data, clock skew, etc.)
    // rather than silently averaging in a nonsensical negative duration.
    const velocityResult = await pool.query(
      "SELECT AVG(EXTRACT(EPOCH FROM (decided_at - first_contact_at)) / 86400) AS avg_days FROM leads WHERE stage = 'closed_won' AND decided_at IS NOT NULL AND first_contact_at IS NOT NULL AND decided_at >= first_contact_at",
    );
    const avgSalesVelocityDays = velocityResult.rows[0].avg_days !== null ? Math.round(Number(velocityResult.rows[0].avg_days)) : undefined;

    return res.status(200).json({
      activePipelineValueUsd,
      monthlyQualifiedLeads,
      winRatePct,
      avgSalesVelocityDays,
      dataNote: winRatePct === undefined || avgSalesVelocityDays === undefined ? "Win rate and/or sales velocity need at least one closed_won or lost lead with real timestamps to compute — not enough decided leads yet." : undefined,
    });
  });

  router.post("/leads", async (req: Request, res: Response) => {
    const {
      companyName,
      contactName,
      contactEmail,
      contactPhone,
      segment,
      source,
      notes,
      estimatedAnnualValueUsd,
      estimatedMonthlyVolume,
      primaryTransportMode,
      targetBorderCrossing,
      leadChannel,
    } = req.body ?? {};
    if (!companyName) return res.status(400).json({ error: "companyName is required." });

    const result = await pool.query(
      `INSERT INTO leads (
        company_name, contact_name, contact_email, contact_phone, segment, source, notes,
        estimated_annual_value_usd, estimated_monthly_volume, primary_transport_mode, target_border_crossing, lead_channel
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        companyName,
        contactName ?? null,
        contactEmail ?? null,
        contactPhone ?? null,
        segment ?? null,
        source ?? null,
        notes ?? null,
        estimatedAnnualValueUsd ?? null,
        estimatedMonthlyVolume ?? null,
        primaryTransportMode ?? null,
        targetBorderCrossing ?? null,
        leadChannel ?? null,
      ],
    );
    res.status(201).json(rowToLead(result.rows[0]));
    return;
  });

  router.patch("/leads/:id/stage", async (req: Request, res: Response) => {
    const { stage } = req.body ?? {};
    if (!VALID_STAGES.includes(stage)) {
      return res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(", ")}` });
    }

    const existing = await pool.query("SELECT * FROM leads WHERE id = $1", [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: `No lead on file with id ${req.params.id}.` });
    const current = existing.rows[0];

    const setFirstContact = current.first_contact_at === null && stage !== "new_unqualified";
    const setDecided = (stage === "closed_won" || stage === "lost") && current.decided_at === null;

    const result = await pool.query(
      `UPDATE leads SET stage = $1
       ${setFirstContact ? ", first_contact_at = now()" : ""}
       ${setDecided ? ", decided_at = now()" : ""}
       WHERE id = $2 RETURNING *`,
      [stage, req.params.id],
    );
    res.status(200).json(rowToLead(result.rows[0]));
    return;
  });

  router.post("/leads/:id/draft-intro-email", async (req: Request, res: Response) => {
    const result = await pool.query("SELECT * FROM leads WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: `No lead on file with id ${req.params.id}.` });
    const lead = rowToLead(result.rows[0]);
    const email = await draftIntroEmail({
      companyName: lead.companyName as string,
      contactName: lead.contactName as string | undefined,
      targetLanes: lead.targetLanes as string | undefined,
      commodities: lead.commodities as string | undefined,
      operatingRegions: lead.operatingRegions as string | undefined,
      targetBorderCrossing: lead.targetBorderCrossing as string | undefined,
    });
    return res.status(200).json(email);
  });

  router.post("/leads/:id/savings-proposal", async (req: Request, res: Response) => {
    const result = await pool.query("SELECT * FROM leads WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: `No lead on file with id ${req.params.id}.` });
    const lead = rowToLead(result.rows[0]);
    const proposal = generateSavingsProposal((lead.estimatedAnnualValueUsd as number) ?? 0);
    return res.status(200).json(proposal);
  });

  router.post("/leads/:id/convert-to-account", async (req: Request, res: Response) => {
    const leadResult = await pool.query("SELECT * FROM leads WHERE id = $1", [req.params.id]);
    if (leadResult.rows.length === 0) return res.status(404).json({ error: `No lead on file with id ${req.params.id}.` });
    const lead = leadResult.rows[0];

    const { orgId } = req.body ?? {};
    if (!orgId) return res.status(400).json({ error: "orgId is required (the new account's org identifier)." });

    const accountResult = await pool.query(
      `INSERT INTO accounts (org_id, company_name, primary_contact_name, primary_contact_email, primary_contact_phone, account_status)
       VALUES ($1,$2,$3,$4,$5,'onboarding') RETURNING *`,
      [orgId, lead.company_name, lead.contact_name, lead.contact_email, lead.contact_phone],
    );

    await pool.query("UPDATE leads SET stage = 'closed_won', decided_at = COALESCE(decided_at, now()) WHERE id = $1", [req.params.id]);

    return res.status(201).json({ converted: true, accountId: accountResult.rows[0].id, orgId: accountResult.rows[0].org_id });
  });

  return router;
}
