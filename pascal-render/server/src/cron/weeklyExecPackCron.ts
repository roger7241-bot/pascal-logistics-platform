// ============================================================================
// CRON — Weekly Executive Pack (Friday 14:00 America/Los_Angeles)
// For every Tier 3 client, compose their weekly executive dashboard from the
// past 7 days of KPI snapshots. Chief of Staff persona composes in Roger's
// voice. Lands as a pending draft under agent6_chief_of_staff labelled
// 'weekly_exec_pack:<orgId>' so Roger reviews before sending to the client's
// leadership team Monday morning.
//
// Structure the client sees:
//   1. TL;DR — the single most important number this week
//   2. KPI scorecard — target vs actual, trend arrow, delta
//   3. What we noticed — 2-3 exceptions or wins Roger should highlight
//   4. Focus next week — one specific commitment
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "../services/pascalContext.js";
import { listRecentSnapshots, getKpiTargets } from "../services/kpiCompute.js";
import { getKnowledgeBase, renderKnowledgeBaseForPrompt } from "../services/clientKnowledgeBase.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

async function main() {
  const clients = await pool.query<{ org_id: string; company_name: string; primary_contact_name: string | null }>(
    `SELECT org_id, company_name, primary_contact_name FROM accounts
     WHERE account_status = 'active' AND retainer_tier IN ('tier3', 'Tier 3', 'tier_3')`,
  );

  if (clients.rowCount === 0) {
    console.log("No Tier 3 clients on file — skipping exec pack.");
    return;
  }

  let drafted = 0;

  for (const c of clients.rows) {
    const [snapshots, targets, kb] = await Promise.all([
      listRecentSnapshots(c.org_id, 7),
      getKpiTargets(c.org_id),
      getKnowledgeBase(c.org_id),
    ]);

    if (snapshots.length === 0) {
      console.log(`No KPI snapshots yet for ${c.company_name} — skipping.`);
      continue;
    }

    const latest = snapshots[0];
    const oldest = snapshots[snapshots.length - 1];

    // Simple week-over-week helper — same KPI's latest vs 7 days back.
    const delta = (a: number | null | undefined, b: number | null | undefined): string => {
      if (a === null || a === undefined || b === null || b === undefined) return "n/a";
      const d = Number(a) - Number(b);
      const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "→";
      return `${arrow} ${d.toFixed(1)}`;
    };

    const kpiBoard = `KPI SCORECARD (this week vs target, week-over-week Δ):
- OTIF:                     ${latest.otif_pct ?? "n/a"}% (target ${targets?.otif_target_pct ?? "not set"}%, Δ ${delta(latest.otif_pct, oldest.otif_pct)})
- Perfect Order:            ${latest.perfect_order_pct ?? "n/a"}% (target ${targets?.perfect_order_target_pct ?? "not set"}%, Δ ${delta(latest.perfect_order_pct, oldest.perfect_order_pct)})
- Freight-to-Revenue:       ${latest.freight_to_revenue_pct ?? "n/a"}% (target ${targets?.freight_to_revenue_target_pct ?? "not set"}%, Δ ${delta(latest.freight_to_revenue_pct, oldest.freight_to_revenue_pct)})
- Inventory Turns:          ${latest.inventory_turns ?? "n/a"} (target ${targets?.inventory_turns_target ?? "not set"}, Δ ${delta(latest.inventory_turns, oldest.inventory_turns)})
- Order Fill Rate:          ${latest.order_fill_rate_pct ?? "n/a"}% (target ${targets?.order_fill_rate_target_pct ?? "not set"}%)
- Supplier OTIF:            ${latest.supplier_otif_pct ?? "n/a"}% (target ${targets?.supplier_otif_target_pct ?? "not set"}%)
- Damage Rate:              ${latest.damage_rate_pct ?? "n/a"}% (target ${targets?.damage_rate_target_pct ?? "not set"}%)
- Dead Stock:               ${latest.dead_stock_pct ?? "n/a"}% (target ${targets?.dead_stock_target_pct ?? "not set"}%)

Raw counts this week: ${latest.orders_total} total orders, ${latest.orders_shipped_ontime} on-time, ${latest.orders_shipped_infull} in-full. Freight $${Math.round(Number(latest.freight_cost_usd ?? 0)).toLocaleString()}, revenue $${Math.round(Number(latest.revenue_usd ?? 0)).toLocaleString()}, inventory value $${Math.round(Number(latest.inventory_value_usd ?? 0)).toLocaleString()}.

Data source: ${latest.source} (${latest.source === "demo" ? "DEMO MODE — no live ERP yet" : "live ERP pull"}).`;

    let body = "";
    if (client) {
      const systemPrompt = `${PASCAL_SYSTEM_PREFIX}${renderKnowledgeBaseForPrompt(kb)}

ROLE — You are the Chief of Staff (Agent 10) composing the Tier 3 Weekly Executive Pack for ${c.company_name}. This goes to their leadership (CFO / VP Ops / Owner). It's the moment they see what a real Supply Chain Manager looks like in dashboard form.

Structure (400-600 words):
1. TL;DR: One sentence with the single most important number this week
2. KPI Scorecard: Format the KPI board below as a clean table. Include only KPIs with data.
3. What we noticed: 2-3 exceptions or wins we should call out. Ground each in a specific number.
4. Focus next week: One specific commitment we're making next week.
Sign-off: "— Roger, Pascal Logistics"

Rules:
- Speak in "we" throughout — never name internal agents.
- Ground everything in specific numbers. No vague statements.
- If demo mode is on, note transparently at the very end: "Note: KPIs above reflect demo data — live ERP integration goes live once we complete the [ERP provider] connection."
- Never make up KPIs not in the scorecard.`;

      const userPrompt = `Client: ${c.company_name}
Contact: ${c.primary_contact_name ?? "team"}

${kpiBoard}`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1400,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      body = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    } else {
      body = `Hi ${c.primary_contact_name ?? "team"},\n\nYour weekly exec pack. [Simulated — no ANTHROPIC_API_KEY]\n\n${kpiBoard}\n\n— Roger, Pascal Logistics`;
    }

    const payload = {
      inbound: {
        fromEmail: "internal-cron@pascallogistics.com",
        fromName: "Weekly Exec Pack Cron",
        subject: `Compose exec pack for ${c.company_name}`,
        body: kpiBoard,
      },
      output: {
        category: "operational",
        priority: "normal",
        summary: `Weekly Tier 3 exec pack drafted for ${c.company_name}. OTIF ${latest.otif_pct ?? "n/a"}%, orders ${latest.orders_total}.`,
        suggestedActions: ["Review scorecard against leadership context", "Adjust the 'Focus next week' line if needed", "Send Monday morning"],
        draftResponseSubject: `${c.company_name} — Weekly Executive Pack, week ending ${new Date().toISOString().slice(0, 10)}`,
        draftResponseBody: body,
        simulated: !client,
      },
    };

    await pool.query(
      `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
       VALUES ('agent6_chief_of_staff', 'weekly_exec_pack', 'operational', $1, $2, $3::jsonb)`,
      [`Exec pack for ${c.company_name}`, `weekly_exec_pack:${c.org_id}:${new Date().toISOString().slice(0, 10)}`, JSON.stringify(payload)],
    );
    drafted += 1;
    console.log(`Weekly exec pack drafted for ${c.company_name}.`);
  }

  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = $1, updated_at = now()
     WHERE agent_key = 'agent6_chief_of_staff'`,
    [`weekly_exec_pack: ${drafted} drafted`],
  );
  console.log(`Weekly exec pack: ${drafted} drafts queued.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Weekly exec pack cron failed:", err);
    process.exit(1);
  });
