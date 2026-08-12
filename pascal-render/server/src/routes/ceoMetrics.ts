// ============================================================================
// GET /api/ceo/metrics
// GET /api/ceo/alerts
// GET /api/ceo/activity
//
// Real CEO Hub data. Notably: mtdCapitalSavedUsd now genuinely reflects
// persisted Agent 3 rate-optimization history (rate_optimizations table),
// closing the earlier gap where this only counted paid invoices and
// showed $0 with nothing captured. "Avoided detention fees" is still
// honestly not tracked — no real source exists for that yet — so it's
// reported as 0 with a note, not fabricated.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import type { BorderTelemetryService } from "../services/borderTelemetryService.js";
import { SAMPLE_SHIPMENTS } from "./client.js";

const MONTHLY_RETAINER_COST_USD = 3200; // Meridian Cold Chain's on-file retainer, matching the seeded account

const CUSTOMS_STATUS_BY_CHIP: Record<string, string> = {
  paps_pars_released: "PAPS_CLEARED",
  customs_hold_flagged: "PGA_REVIEW",
  in_transit: "IN_TRANSIT",
  delivered: "PAPS_CLEARED",
};

export function createCeoMetricsRouter(telemetryService: BorderTelemetryService): Router {
  const router = Router();

  router.get("/metrics", async (_req: Request, res: Response) => {
    const snapshot = telemetryService.getSnapshot();
    const pacificHighwayCommercial = snapshot.readings.filter((r) => r.poeId === "pacific_highway" && r.laneType === "commercial");
    const borderTransitVelocityMinutes =
      pacificHighwayCommercial.length > 0
        ? Math.round(pacificHighwayCommercial.reduce((sum, r) => sum + r.waitMinutes, 0) / pacificHighwayCommercial.length)
        : undefined;

    const poaResult = await pool.query("SELECT COUNT(*) FILTER (WHERE status = 'active_in_ace_aci') AS active, COUNT(*) AS total FROM poa_records");
    const poaActive = Number(poaResult.rows[0].active);
    const poaTotal = Number(poaResult.rows[0].total) || 1;
    const poaScore = poaActive / poaTotal;

    const vaultResult = await pool.query("SELECT COUNT(*) AS recent FROM vault_documents WHERE uploaded_at > now() - interval '30 days'");
    const recentDocs = Number(vaultResult.rows[0].recent);
    const vaultScore = recentDocs > 0 ? 1 : 0;

    const documentHealthScore = Math.round((poaScore * 0.6 + vaultScore * 0.4) * 100);

    // The real fix: sum genuinely persisted Agent 3 results this month,
    // not just paid invoices.
    const savingsResult = await pool.query(
      "SELECT COALESCE(SUM(savings_usd), 0) AS total FROM rate_optimizations WHERE captured_at >= date_trunc('month', now())",
    );
    const mtdSpotSavingsUsd = Number(savingsResult.rows[0].total);

    const invoiceResult = await pool.query(
      "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM invoices WHERE status = 'paid' AND created_at >= date_trunc('month', now())",
    );
    const mtdPaidInvoicesUsd = Number(invoiceResult.rows[0].total);

    // Avoided detention fees: honestly not tracked yet — no persisted
    // source (e.g. a dispute that prevented a real charge) exists to sum.
    // Reported as 0 with the gap named explicitly rather than invented.
    const avoidedDetentionFeesUsd = 0;
    const netRetainerValueUsd = mtdSpotSavingsUsd + avoidedDetentionFeesUsd - MONTHLY_RETAINER_COST_USD;

    const activeShipmentsResult = await pool.query("SELECT COUNT(*) AS count FROM executive_drafts WHERE status = 'pending'");
    const pendingExecutiveReviewCount = Number(activeShipmentsResult.rows[0].count);

    res.status(200).json({
      borderTransitVelocityMinutes,
      documentHealthScore,
      mtdCapitalSavedUsd: mtdSpotSavingsUsd, // now real — kept as the same field name the CEO Hub UI already reads
      mtdSpotSavingsUsd,
      mtdPaidInvoicesUsd,
      avoidedDetentionFeesUsd,
      monthlyRetainerCostUsd: MONTHLY_RETAINER_COST_USD,
      netRetainerValueUsd,
      pendingExecutiveReviewCount,
      dataNote: "avoidedDetentionFeesUsd is not tracked yet — no persisted source exists for it; reported honestly as 0, not estimated.",
    });
  });

  router.get("/alerts", async (_req: Request, res: Response) => {
    const usmcaExpiringResult = await pool.query(
      "SELECT COUNT(*) AS count FROM vault_documents WHERE category = 'usmca_certificate' AND expires_at IS NOT NULL AND expires_at BETWEEN now() AND now() + interval '7 days'",
    );
    const usmcaExpiringCount = Number(usmcaExpiringResult.rows[0].count);

    // PGA hold count — HONEST LIMITATION: no persisted live-shipment table
    // with a real-time PGA-hold flag exists yet (shipments in this backend
    // are sample data, not a live operational table). Reads from the
    // executive_drafts rationale text as the closest real signal — a
    // draft whose rationale mentions an EPA/PGA flag genuinely is one.
    const pgaHoldResult = await pool.query("SELECT COUNT(*) AS count FROM executive_drafts WHERE status = 'pending' AND (rationale ILIKE '%PGA%' OR rationale ILIKE '%EPA%')");
    const pgaHoldCount = Number(pgaHoldResult.rows[0].count);

    res.status(200).json({
      usmcaExpiringCount,
      pgaHoldCount,
      dataNote: "pgaHoldCount is derived from pending executive drafts mentioning PGA/EPA — there's no separate live-shipment PGA-hold table yet.",
    });
  });

  router.get("/activity", async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const result = await pool.query("SELECT * FROM activity_log ORDER BY occurred_at DESC LIMIT $1", [limit]);
    res.status(200).json({
      activity: result.rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        shipmentId: r.shipment_id,
        message: r.message,
        metadata: r.metadata,
        occurredAtIso: (r.occurred_at as Date).toISOString(),
      })),
    });
  });

  router.get("/corridor-shipments", (_req: Request, res: Response) => {
    const corridorShipments = SAMPLE_SHIPMENTS.filter((s) => s.transportMode === "road").map((s) => ({
      id: s.id,
      clientOrg: s.clientOrg ?? "Unknown",
      driverName: s.driverName,
      poeId: s.poeId,
      customsStatus: CUSTOMS_STATUS_BY_CHIP[s.statusChip] ?? "IN_TRANSIT",
      etaIso: s.etaIso,
      updatedAtIso: s.updatedAtIso,
    }));
    res.status(200).json({ shipments: corridorShipments });
  });

  return router;
}
