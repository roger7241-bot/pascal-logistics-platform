// ============================================================================
// CRON — Monthly ROI Reporter (1st of month, 08:00 America/Los_Angeles)
// For every active client, roll up last month's roi_credits. Push the
// summary into a drafts row that either Chief of Staff (Tier 1/1.5/2) or
// Frank (Tier 3) will wrap in client-facing prose on their next authoring
// pass. Clients that had no unreported credits are skipped silently.
// ============================================================================

import { pool } from "../db/pool.js";
import { generateMonthlyRoi } from "../services/agent19RoiReporter.js";
import { runCron } from "./cronHelpers.js";

async function main() {
  const clients = await pool.query<{ org_id: string; company_name: string; retainer_tier: string | null }>(
    `SELECT org_id, company_name, retainer_tier FROM accounts WHERE account_status = 'active'`,
  );
  if (clients.rowCount === 0) {
    console.log("No active clients — skipping monthly ROI report.");
    return;
  }

  const targetMonth = new Date(new Date().setDate(1));
  targetMonth.setMonth(targetMonth.getMonth() - 1);
  const targetMonthIso = targetMonth.toISOString().slice(0, 10);
  let drafted = 0;

  for (const c of clients.rows) {
    try {
      const summary = await generateMonthlyRoi(c.org_id, targetMonthIso);
      if (!summary) continue;
      const isTier3 = c.retainer_tier ? /tier[_\s]?3/i.test(c.retainer_tier) : false;
      const authorAgentKey = isTier3 ? "agent17_scm_frank" : "agent6_chief_of_staff";

      const payload = {
        summary,
        inbound: {
          fromEmail: "internal-cron@pascallogistics.com",
          fromName: "Monthly ROI Reporter",
          subject: `ROI rollup — ${c.company_name} · ${targetMonthIso.slice(0, 7)}`,
          body: summary.narrative,
        },
        output: {
          category: "operational",
          priority: "normal",
          summary: `Monthly ROI: ${summary.totalCreditCount} events, $${Math.round(summary.grandTotalUsd).toLocaleString()} of quantified value${summary.coverageMultiple ? ` (${summary.coverageMultiple}x coverage of retainer)` : ""}.`,
          suggestedActions: ["Author the client-facing wrap under this rollup", "Send with the next monthly touch"],
          draftResponseSubject: `${c.company_name} — Monthly Value Report · ${targetMonthIso.slice(0, 7)}`,
          draftResponseBody: `${summary.narrative}\n\nCategory rollup:\n${summary.rollupByType.map((r) => `- ${r.creditType.replace(/_/g, " ")}: ${r.count} events, $${Math.round(r.totalDollarValueUsd).toLocaleString()} value`).join("\n")}\n\nTop headlines:\n${summary.rollupByType.flatMap((r) => r.headlines).slice(0, 8).map((h) => `- ${h}`).join("\n")}\n\n${summary.coverageMultiple ? `Retainer coverage: ${summary.coverageMultiple}x` : ""}`,
          simulated: false,
        },
      };
      await pool.query(
        `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
         VALUES ($1, 'monthly_roi_report', 'operational', $2, $3, $4::jsonb)`,
        [authorAgentKey, `Monthly ROI: ${c.company_name} · ${targetMonthIso.slice(0, 7)}`, `monthly_roi:${c.org_id}:${targetMonthIso.slice(0, 7)}`, JSON.stringify(payload)],
      );
      drafted += 1;
      console.log(`Monthly ROI rollup drafted for ${c.company_name} (${authorAgentKey}).`);
    } catch (err) {
      console.error(`Monthly ROI failed for ${c.company_name}:`, err);
    }
  }
  console.log(`Monthly ROI: ${drafted} client draft${drafted === 1 ? "" : "s"} queued.`);
}

runCron("monthly_roi", main);
