// ============================================================================
// CLIENT DAY-ONE ROUTES
// The three surfaces a warehouse person needs perfectly working on day 1:
//   1. HTS / HS classification lookup + duty preview per HS
//   2. Their preferred trucking company (contact + integration status)
//   3. Their customs broker of record (contact + POA status)
// Endpoints scoped to /api/client + /api/operator (operator can preview any
// org via ?orgId=…).
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";

function resolveOrgId(req: Request, allowQueryOverride: boolean): string | undefined {
  if (allowQueryOverride && req.authUser?.role === "operator") {
    const q = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    return q ?? req.authUser?.orgId ?? undefined;
  }
  return req.authUser?.orgId ?? undefined;
}

export function createClientDayOneRouter(scope: "operator" | "client"): Router {
  const router = Router();
  const allowQueryOverride = scope === "operator";

  // ============ HTS LOOKUP ================================================
  // Search by partial HS code (2/4/6/10-digit prefix) or synonym match.
  router.get("/hts/lookup", async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) return res.status(400).json({ error: "q required (HS code prefix or product name)." });

    const digitsOnly = q.replace(/[^0-9]/g, "");
    const isCodeSearch = digitsOnly.length >= 2;
    let result;
    if (isCodeSearch) {
      result = await pool.query(
        `SELECT * FROM hts_reference
         WHERE hs_code LIKE $1 || '%' OR LEFT(hs_code, LENGTH($1)) = $1
         ORDER BY hs_code LIMIT 25`,
        [digitsOnly.slice(0, 6)],
      );
    } else {
      const like = `%${q.toLowerCase()}%`;
      result = await pool.query(
        `SELECT * FROM hts_reference
         WHERE LOWER(short_description) LIKE $1
            OR LOWER(full_description) LIKE $1
            OR EXISTS (SELECT 1 FROM unnest(common_synonyms) syn WHERE LOWER(syn) LIKE $1)
         ORDER BY hs_code LIMIT 25`,
        [like],
      );
    }
    return res.status(200).json({ results: result.rows });
  });

  // Get one HTS entry + recent Federal-Register / tariff activity on this HS.
  router.get("/hts/:hsCode", async (req: Request, res: Response) => {
    const hsCode = req.params.hsCode.replace(/[^0-9.]/g, "");
    const hts = await pool.query(`SELECT * FROM hts_reference WHERE hs_code = $1`, [hsCode]);
    if (hts.rowCount === 0) return res.status(404).json({ error: "HS code not found in reference table." });

    // Recent tariff activity affecting this HS code
    const activity = await pool.query(
      `SELECT external_ref, hs_code, headline, summary, severity, effective_date,
              source_url, old_rate, new_rate, rate_delta_pct, published_at, mechanism, direction
       FROM tariff_updates
       WHERE hs_code LIKE $1 || '%' OR $1 LIKE hs_code || '%'
       ORDER BY published_at DESC LIMIT 20`,
      [hsCode.slice(0, 6)],
    );

    return res.status(200).json({
      classification: hts.rows[0],
      recentTariffActivity: activity.rows,
    });
  });

  // Duty preview — quick calc using the reference row + user's declared value.
  router.post("/hts/duty-preview", async (req: Request, res: Response) => {
    const { hsCode, declaredValueUsd, importSide, useUsmca } = req.body ?? {};
    if (typeof hsCode !== "string" || typeof declaredValueUsd !== "number" || declaredValueUsd < 0) {
      return res.status(400).json({ error: "hsCode + numeric declaredValueUsd required." });
    }
    const side = importSide === "CA" ? "CA" : "US";
    const cleanHs = hsCode.replace(/[^0-9.]/g, "");
    const hts = await pool.query(`SELECT * FROM hts_reference WHERE hs_code = $1`, [cleanHs]);
    if (hts.rowCount === 0) return res.status(404).json({ error: "HS code not in reference." });
    const row = hts.rows[0];
    const ratePct = side === "CA"
      ? Number(useUsmca ? row.ca_usmca_rate_pct : row.ca_mfn_rate_pct)
      : Number(useUsmca ? row.us_usmca_rate_pct : row.us_mfn_rate_pct);
    const duty = Math.round(declaredValueUsd * (ratePct / 100) * 100) / 100;
    const additional: Array<{ label: string; amountUsd: number; notes: string }> = [];
    if (side === "US") {
      const mpf = Math.min(614.35, Math.max(31.67, declaredValueUsd * 0.003464));
      additional.push({ label: "Merchandise Processing Fee (MPF)", amountUsd: Math.round(mpf * 100) / 100, notes: "0.3464% of entered value, min $31.67, max $614.35" });
    } else {
      const gst = Math.round(((declaredValueUsd + duty) * 0.05) * 100) / 100;
      additional.push({ label: "GST @ 5% on duty-paid value", amountUsd: gst, notes: "Recoverable if you're GST-registered." });
    }
    return res.status(200).json({
      classification: row,
      appliedRatePct: ratePct,
      dutyUsd: duty,
      additionalFees: additional,
      totalDutyAndFeesUsd: duty + additional.reduce((s, a) => s + a.amountUsd, 0),
      warning: row.us_section_232 ? "Section 232 (steel/aluminum) may apply — confirm with broker." : row.us_section_301 ? "Section 301 (China origin) may apply — confirm origin with broker." : row.add_cvd_flag ? "ADD/CVD case may apply — confirm scope with broker." : null,
    });
  });

  // ============ CARRIER + BROKER SUMMARY =================================
  // Everything the warehouse person needs in one call.
  router.get("/counterparties", async (req: Request, res: Response) => {
    const orgId = resolveOrgId(req, allowQueryOverride);
    if (!orgId) return res.status(400).json({ error: "No org on file." });

    const [carriers, brokers] = await Promise.all([
      pool.query(
        `SELECT id, carrier_name, carrier_mode, scac_code, iata_code, fmc_number,
                account_number, dispatch_email, integration_status,
                on_time_pct, claims_rate_pct, last_verified_at
         FROM carrier_accounts WHERE org_id = $1
         ORDER BY carrier_mode, carrier_name`,
        [orgId],
      ),
      pool.query(
        `SELECT id, broker_name, side, contact_name, contact_phone, contact_email,
                ace_filer_code, cbsa_client_id, poa_status, poa_signed_at,
                poa_expires_at, notes
         FROM broker_accounts WHERE org_id = $1
         ORDER BY side, broker_name`,
        [orgId],
      ),
    ]);
    return res.status(200).json({ carriers: carriers.rows, brokers: brokers.rows });
  });

  // Operator can seed / update broker rows; clients see read-only.
  if (scope === "operator") {
    router.post("/accounts/:orgId/brokers", async (req: Request, res: Response) => {
      const b = req.body ?? {};
      if (!b.brokerName || !["us", "ca", "both"].includes(b.side)) {
        return res.status(400).json({ error: "brokerName + side ('us' | 'ca' | 'both') required." });
      }
      const result = await pool.query(
        `INSERT INTO broker_accounts (org_id, broker_name, side, contact_name, contact_phone,
           contact_email, ace_filer_code, cbsa_client_id, poa_status, poa_signed_at,
           poa_expires_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (org_id, broker_name, side) DO UPDATE
           SET contact_name = EXCLUDED.contact_name,
               contact_phone = EXCLUDED.contact_phone,
               contact_email = EXCLUDED.contact_email,
               ace_filer_code = EXCLUDED.ace_filer_code,
               cbsa_client_id = EXCLUDED.cbsa_client_id,
               poa_status = EXCLUDED.poa_status,
               poa_signed_at = EXCLUDED.poa_signed_at,
               poa_expires_at = EXCLUDED.poa_expires_at,
               notes = EXCLUDED.notes,
               updated_at = now()
         RETURNING *`,
        [
          req.params.orgId, b.brokerName, b.side,
          b.contactName ?? null, b.contactPhone ?? null, b.contactEmail ?? null,
          b.aceFilerCode ?? null, b.cbsaClientId ?? null,
          b.poaStatus ?? "not_on_file",
          b.poaSignedAt ?? null, b.poaExpiresAt ?? null, b.notes ?? null,
        ],
      );
      return res.status(200).json({ broker: result.rows[0] });
    });
  }

  return router;
}
