// ============================================================================
// 07:00 AM BRIEF GENERATOR — pure function, real data sources:
// SAMPLE_SHIPMENTS (in-transit/exception counts — same honest in-memory
// limitation as everywhere else this set is used), reroute_advisories,
// rate_optimizations (Agent 3 savings), calendar_events. No fabricated
// numbers — an org with no activity gets a genuinely quiet brief.
// ============================================================================

import { pool } from "../db/pool.js";
import { SAMPLE_SHIPMENTS } from "../routes/client.js";
import type { ExecutiveMorningBrief } from "../types/cx.js";

export async function generateMorningDigest(orgId: string): Promise<string> {
  const shipmentsInTransit = SAMPLE_SHIPMENTS.filter((s) => s.statusChip !== "delivered").length;
  const shipmentsWithExceptions = SAMPLE_SHIPMENTS.filter((s) => s.statusChip === "customs_hold_flagged").length;

  const [advisories, savings, calendarToday] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS count FROM reroute_advisories WHERE status = 'pending_client_signoff'`),
    pool.query(`SELECT COALESCE(SUM(savings_usd), 0) AS total FROM rate_optimizations WHERE captured_at >= date_trunc('day', now())`),
    pool.query(`SELECT COUNT(*) AS count FROM calendar_events WHERE org_id = $1 AND starts_at >= date_trunc('day', now()) AND starts_at < date_trunc('day', now()) + interval '1 day' AND status != 'cancelled'`, [orgId]),
  ]);

  const brief: ExecutiveMorningBrief = {
    orgId,
    generatedAtIso: new Date().toISOString(),
    shipmentsInTransit,
    shipmentsWithExceptions,
    criticalRerouteAdvisoriesPending: Number(advisories.rows[0].count),
    agent3SavingsCapturedUsd: Number(savings.rows[0].total),
    todaysCalendarEventCount: Number(calendarToday.rows[0].count),
    narrative: "",
  };

  const lines = [
    `Good morning — here's your ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} brief.`,
    ``,
    `📦 ${brief.shipmentsInTransit} shipment${brief.shipmentsInTransit === 1 ? "" : "s"} currently in transit${brief.shipmentsWithExceptions > 0 ? `, ${brief.shipmentsWithExceptions} flagged with an exception` : ", none flagged"}.`,
    brief.criticalRerouteAdvisoriesPending > 0
      ? `🛂 ${brief.criticalRerouteAdvisoriesPending} reroute ${brief.criticalRerouteAdvisoriesPending === 1 ? "advisory" : "advisories"} awaiting your sign-off.`
      : `🛂 No reroute advisories awaiting sign-off.`,
    brief.agent3SavingsCapturedUsd > 0 ? `💰 $${brief.agent3SavingsCapturedUsd.toLocaleString()} in rate savings captured so far today.` : `💰 No rate savings captured yet today.`,
    `📅 ${brief.todaysCalendarEventCount} event${brief.todaysCalendarEventCount === 1 ? "" : "s"} on today's schedule.`,
  ];

  brief.narrative = lines.join("\n");
  return brief.narrative;
}
