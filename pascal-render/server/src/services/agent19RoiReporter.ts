// ============================================================================
// AGENT 19 — ROI REPORTER (headless)
// Monthly retainer-defense value tally. Pulls from roi_credits (any agent
// can write a credit row when they save the client money) and composes a
// summary. NOT a persona — this feeds Chief of Staff or Frank; they wrap
// the numbers in the client-facing voice.
// ============================================================================

import { pool } from "../db/pool.js";

export interface RoiCreditInput {
  orgId: string;
  sourceAgentKey: string;
  creditType: string;
  headline: string;
  dollarValueUsd: number;
  hoursSavedValueUsd?: number;
  linkedDraftId?: string;
  linkedTaskId?: string;
}

// Any agent can call this to log a "we saved the client X" credit.
export async function recordRoiCredit(input: RoiCreditInput): Promise<string> {
  const result = await pool.query(
    `INSERT INTO roi_credits (org_id, source_agent_key, credit_type, headline,
       dollar_value_usd, hours_saved_value_usd, linked_draft_id, linked_task_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.orgId, input.sourceAgentKey, input.creditType, input.headline,
      input.dollarValueUsd, input.hoursSavedValueUsd ?? null,
      input.linkedDraftId ?? null, input.linkedTaskId ?? null,
    ],
  );
  return result.rows[0].id as string;
}

export interface RoiRollupRow {
  creditType: string;
  count: number;
  totalDollarValueUsd: number;
  totalHoursSavedValueUsd: number;
  headlines: string[];
}

export interface MonthlyRoiSummary {
  orgId: string;
  companyName: string;
  reportedInMonth: string;               // YYYY-MM-01
  rollupByType: RoiRollupRow[];
  grandTotalUsd: number;
  totalCreditCount: number;
  retainerMonthlyUsd?: number;
  coverageMultiple?: number;             // grandTotal / retainer (>1 = we more than cover ourselves)
  narrative: string;
}

// Roll up the past month's credits, mark them reported, hand back a
// structured summary. Chief of Staff / Frank wraps it in client-facing prose.
export async function generateMonthlyRoi(orgId: string, targetMonthIso?: string): Promise<MonthlyRoiSummary | null> {
  const monthStart = targetMonthIso
    ? new Date(targetMonthIso).toISOString().slice(0, 10)
    : new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const nextMonthStart = new Date(new Date(monthStart).setMonth(new Date(monthStart).getMonth() + 1)).toISOString().slice(0, 10);

  const account = await pool.query(
    `SELECT company_name, retainer_monthly_usd FROM accounts WHERE org_id = $1`,
    [orgId],
  );
  if ((account.rowCount ?? 0) === 0) return null;

  const rollup = await pool.query<{ credit_type: string; count: string; dollar_sum: string; hours_sum: string; headlines: string[] }>(
    `SELECT credit_type,
            COUNT(*) AS count,
            COALESCE(SUM(dollar_value_usd), 0) AS dollar_sum,
            COALESCE(SUM(hours_saved_value_usd), 0) AS hours_sum,
            array_agg(headline ORDER BY captured_at DESC) AS headlines
       FROM roi_credits
      WHERE org_id = $1
        AND captured_at >= $2::date
        AND captured_at <  $3::date
        AND reported_in_month IS NULL
      GROUP BY credit_type
      ORDER BY SUM(dollar_value_usd) DESC`,
    [orgId, monthStart, nextMonthStart],
  );

  if (rollup.rowCount === 0) return null;

  const rollupByType: RoiRollupRow[] = rollup.rows.map((r) => ({
    creditType: r.credit_type,
    count: Number(r.count),
    totalDollarValueUsd: Number(r.dollar_sum),
    totalHoursSavedValueUsd: Number(r.hours_sum),
    headlines: (r.headlines ?? []).slice(0, 5),
  }));
  const grandTotal = rollupByType.reduce((n, r) => n + r.totalDollarValueUsd + r.totalHoursSavedValueUsd, 0);
  const retainer = Number(account.rows[0].retainer_monthly_usd ?? 0);

  // Mark credits reported so next month's roll doesn't double-count.
  await pool.query(
    `UPDATE roi_credits SET reported_in_month = $1::date
     WHERE org_id = $2 AND reported_in_month IS NULL
       AND captured_at >= $3::date AND captured_at < $4::date`,
    [monthStart, orgId, monthStart, nextMonthStart],
  );

  const narrative = `This month we captured ${rollupByType.reduce((n, r) => n + r.count, 0)} value events across ${rollupByType.length} category${rollupByType.length === 1 ? "" : "ies"}. Total quantified value: $${Math.round(grandTotal).toLocaleString()}. Top drivers: ${rollupByType.slice(0, 3).map((r) => `${r.creditType.replace(/_/g, " ")} ($${Math.round(r.totalDollarValueUsd).toLocaleString()})`).join(", ")}.`;

  return {
    orgId,
    companyName: account.rows[0].company_name,
    reportedInMonth: monthStart,
    rollupByType,
    grandTotalUsd: grandTotal,
    totalCreditCount: rollupByType.reduce((n, r) => n + r.count, 0),
    retainerMonthlyUsd: retainer > 0 ? retainer : undefined,
    coverageMultiple: retainer > 0 ? Math.round((grandTotal / retainer) * 100) / 100 : undefined,
    narrative,
  };
}

// Read unreported credits without generating (dashboard preview usage).
export async function previewUnreportedCredits(orgId: string) {
  const result = await pool.query(
    `SELECT credit_type, headline, dollar_value_usd, hours_saved_value_usd, captured_at
     FROM roi_credits WHERE org_id = $1 AND reported_in_month IS NULL
     ORDER BY captured_at DESC LIMIT 100`,
    [orgId],
  );
  return result.rows;
}
