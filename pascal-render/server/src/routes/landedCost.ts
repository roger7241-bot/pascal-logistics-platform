// ============================================================================
// LANDED COST ROUTES — public + client + operator
// Public endpoints are mounted before auth so the marketing site widget
// works without a login. Every public submission becomes a prospect row,
// so the calculator doubles as a lead-gen funnel wired straight into the
// Sprint 4 prospect pipeline. Chief of Staff drafts the follow-up.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { estimateLandedCost, type LandedCostInput } from "../services/landedCost.js";
import { categorizeAndDraft as chiefCategorize, persistDraft as chiefPersist, type InboundMessage } from "../services/agent6ChiefOfStaff.js";

// Common input parser — every entry point normalizes the same body shape.
function parseInput(b: Record<string, unknown>): LandedCostInput | { error: string } {
  const validModes = ["LTL", "TL", "OCEAN_FCL", "OCEAN_LCL", "AIR"] as const;
  if (!validModes.includes(b.mode as (typeof validModes)[number])) {
    return { error: `mode must be one of: ${validModes.join(", ")}` };
  }
  if (typeof b.originCountry !== "string" || b.originCountry.length !== 2) return { error: "originCountry must be ISO-2 code (US, CA, CN, …)." };
  if (typeof b.destinationCountry !== "string" || b.destinationCountry.length !== 2) return { error: "destinationCountry must be ISO-2 code." };
  if (typeof b.weightKg !== "number" || b.weightKg <= 0) return { error: "weightKg must be a positive number." };
  if (typeof b.declaredValueUsd !== "number" || b.declaredValueUsd < 0) return { error: "declaredValueUsd required." };
  return {
    mode: b.mode as LandedCostInput["mode"],
    origin: typeof b.origin === "string" ? b.origin : "",
    originCountry: (b.originCountry as string).toUpperCase(),
    destination: typeof b.destination === "string" ? b.destination : "",
    destinationCountry: (b.destinationCountry as string).toUpperCase(),
    destinationZip: typeof b.destinationZip === "string" ? b.destinationZip : undefined,
    weightKg: b.weightKg as number,
    volumeCbm: typeof b.volumeCbm === "number" ? b.volumeCbm : undefined,
    pieces: typeof b.pieces === "number" ? b.pieces : undefined,
    hsCode: typeof b.hsCode === "string" ? b.hsCode : undefined,
    hsChapter: typeof b.hsChapter === "string" ? b.hsChapter : undefined,
    declaredValueUsd: b.declaredValueUsd as number,
    incoterm: typeof b.incoterm === "string" ? (b.incoterm as LandedCostInput["incoterm"]) : undefined,
    useUsmcaOrigin: b.useUsmcaOrigin === true,
    includeInsurance: b.includeInsurance === true,
    brokerageFeeUsdOverride: typeof b.brokerageFeeUsdOverride === "number" ? b.brokerageFeeUsdOverride : undefined,
    lastMileZip: typeof b.lastMileZip === "string" ? b.lastMileZip : undefined,
    isDangerousGoods: b.isDangerousGoods === true,
  };
}

// ============================================================================
// PUBLIC (no auth) — mounted at /api/public
// ============================================================================
export function createPublicLandedCostRouter(): Router {
  const router = Router();

  // Compute an estimate. No auth. Rate-limit at the platform edge.
  router.post("/landed-cost/estimate", async (req: Request, res: Response) => {
    const parsed = parseInput(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    try {
      const breakdown = estimateLandedCost(parsed);
      return res.status(200).json(breakdown);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Estimate failed." });
    }
  });

  // Save-lead: attaches an email + name to the estimate, creates a prospect,
  // fires Chief of Staff draft for Roger to review.
  router.post("/landed-cost/save-lead", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const email = typeof b.email === "string" && b.email.includes("@") ? b.email.trim() : undefined;
    const parsed = parseInput(b.input ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    if (!email) return res.status(400).json({ error: "email required." });
    const companyName = typeof b.companyName === "string" ? b.companyName : email.split("@")[1]?.split(".")[0] ?? "Unknown";
    const contactName = typeof b.contactName === "string" ? b.contactName : undefined;

    try {
      const breakdown = estimateLandedCost(parsed);

      // Prospect row — dedup by contact_email if we've seen them.
      const existing = await pool.query(`SELECT id FROM prospects WHERE contact_email = $1 LIMIT 1`, [email]);
      let prospectId: string;
      if ((existing.rowCount ?? 0) > 0) {
        prospectId = existing.rows[0].id;
        await pool.query(
          `UPDATE prospects SET updated_at = now(),
             notes = COALESCE(notes || E'\\n', '') || $1
           WHERE id = $2`,
          [`[${new Date().toISOString().slice(0, 10)}] Landed-cost quote: ${parsed.mode} ${parsed.origin} → ${parsed.destination}, ${parsed.weightKg} kg, est. $${breakdown.totals.grandTotalUsd.toLocaleString()} total.`, prospectId],
        );
      } else {
        const ins = await pool.query(
          `INSERT INTO prospects (company_name, contact_name, contact_email, source, stage, pain_signal, notes)
           VALUES ($1, $2, $3, 'landed_cost_calculator', 'contacted', $4, $5)
           RETURNING id`,
          [
            companyName,
            contactName ?? null,
            email,
            `Ran a landed-cost quote via the public calculator: ${parsed.mode} ${parsed.origin} → ${parsed.destination}`,
            `Public calculator estimate: $${breakdown.totals.grandTotalUsd.toLocaleString()} all-in for ${parsed.weightKg} kg.`,
          ],
        );
        prospectId = ins.rows[0].id;
      }

      // Chief of Staff drafts the follow-up so Roger sees it in his review queue.
      const message: InboundMessage = {
        fromEmail: email,
        fromName: contactName,
        subject: `Landed-cost quote requested: ${parsed.mode} ${parsed.origin} → ${parsed.destination}`,
        body: `Public calculator submission from ${email}${contactName ? ` (${contactName})` : ""}.
Company: ${companyName}
Mode: ${parsed.mode}
Route: ${parsed.origin} (${parsed.originCountry}) → ${parsed.destination} (${parsed.destinationCountry})
Weight: ${parsed.weightKg} kg${parsed.volumeCbm ? `, volume ${parsed.volumeCbm} cbm` : ""}
Declared value: $${parsed.declaredValueUsd.toLocaleString()}
HS: ${parsed.hsCode ?? parsed.hsChapter ?? "not provided"}
USMCA qualifying: ${parsed.useUsmcaOrigin ? "yes" : "no"}

Estimated total landed cost: $${breakdown.totals.grandTotalUsd.toLocaleString()}
  Freight: $${breakdown.totals.freightUsd.toLocaleString()}
  Duty & taxes: $${breakdown.totals.dutiesUsd.toLocaleString()}
  Brokerage: $${breakdown.totals.brokerageUsd.toLocaleString()}
  Insurance: $${breakdown.totals.insuranceUsd.toLocaleString()}
  Last mile: $${breakdown.totals.lastMileUsd.toLocaleString()}`,
        receivedAtIso: new Date().toISOString(),
      };
      const output = await chiefCategorize(message);
      await chiefPersist(message, output, `landed_cost_lead:${prospectId}`);

      return res.status(201).json({
        prospectId,
        breakdown,
        message: "Estimate saved. Roger will follow up within the business day.",
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Save lead failed." });
    }
  });

  return router;
}

// ============================================================================
// AUTHENTICATED — client + operator both use the same handler
// ============================================================================
export function createAuthedLandedCostRouter(): Router {
  const router = Router();

  router.post("/landed-cost/estimate", async (req: Request, res: Response) => {
    const parsed = parseInput(req.body ?? {});
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    try {
      const breakdown = estimateLandedCost(parsed);
      return res.status(200).json(breakdown);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Estimate failed." });
    }
  });

  return router;
}
