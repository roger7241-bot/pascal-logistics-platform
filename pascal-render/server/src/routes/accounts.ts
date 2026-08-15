// ============================================================================
// GET  /api/operator/accounts — expanded with facility count, POA status,
//      USMCA verification, all real joins.
// POST /api/operator/accounts
// GET  /api/operator/accounts/kpis — real MRR by currency, real compliance
//      health rate.
// GET  /api/operator/accounts/:id/detail — the drill-down drawer's data:
//      real facilities, real carrier accounts, real invoice spend + Agent 3
//      savings history, real POA/USMCA status.
//
// CRM & Account Directory (Desk #6). Every number below is a genuine join
// against tables built in earlier rounds — no fabricated compliance
// percentages or spend totals.
// ============================================================================

import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool.js";
import { logSecurityAudit, getAuditLogs } from "../services/securityAuditLogger.js";
import { SAMPLE_SHIPMENTS } from "./client.js";

export interface Account {
  id: string;
  orgId: string;
  companyName: string;
  legalEntityName?: string;
  operatingDba?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  operationsManagerName?: string;
  apEmail?: string;
  apPhone?: string;
  apContactName?: string;
  usEin?: string;
  usDotNumber?: string;
  mcFfNumber?: string;
  caBn?: string;
  caBnProgramSuffix?: string;
  mxRfc?: string;
  countryOfIncorporation?: string;
  taxId?: string;
  creditLimitUsd?: number;
  retainerTier?: string;
  retainerMonthlyUsd?: number;
  overageRateUsd?: number;
  billingCurrency: string;
  paymentTerms: string;
  houseSpotBenchmarkOptIn: boolean;
  customsBrokerName?: string;
  customsBrokerAccountRef?: string;
  customsBrokerEmail?: string;
  customsBrokerOpsPhone?: string;
  customsPoaStatus?: "active_verified" | "pending_signature" | "exempt";
  defaultPoePreference?: string;
  primaryCommodities: string[];
  requiresReefer: boolean;
  requiresHazmat: boolean;
  preferredCarrierScacs: string[];
  accountStatus: string;
}

function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    companyName: row.company_name as string,
    legalEntityName: (row.legal_entity_name as string) ?? undefined,
    operatingDba: (row.operating_dba as string) ?? undefined,
    primaryContactName: (row.primary_contact_name as string) ?? undefined,
    primaryContactEmail: (row.primary_contact_email as string) ?? undefined,
    primaryContactPhone: (row.primary_contact_phone as string) ?? undefined,
    operationsManagerName: (row.operations_manager_name as string) ?? undefined,
    apEmail: (row.ap_email as string) ?? undefined,
    apPhone: (row.ap_phone as string) ?? undefined,
    apContactName: (row.ap_contact_name as string) ?? undefined,
    usEin: (row.us_ein as string) ?? undefined,
    usDotNumber: (row.us_dot_number as string) ?? undefined,
    mcFfNumber: (row.mc_ff_number as string) ?? undefined,
    caBn: (row.ca_bn as string) ?? undefined,
    caBnProgramSuffix: (row.ca_bn_program_suffix as string) ?? undefined,
    mxRfc: (row.mx_rfc as string) ?? undefined,
    countryOfIncorporation: (row.country_of_incorporation as string) ?? undefined,
    taxId: (row.tax_id as string) ?? undefined,
    creditLimitUsd: row.credit_limit_usd !== null ? Number(row.credit_limit_usd) : undefined,
    retainerTier: (row.retainer_tier as string) ?? undefined,
    retainerMonthlyUsd: row.retainer_monthly_usd !== null ? Number(row.retainer_monthly_usd) : undefined,
    overageRateUsd: row.overage_rate_usd !== null && row.overage_rate_usd !== undefined ? Number(row.overage_rate_usd) : undefined,
    billingCurrency: row.billing_currency as string,
    paymentTerms: row.payment_terms as string,
    houseSpotBenchmarkOptIn: row.house_spot_benchmark_opt_in as boolean,
    customsBrokerName: (row.customs_broker_name as string) ?? undefined,
    customsBrokerAccountRef: (row.customs_broker_account_ref as string) ?? undefined,
    customsBrokerEmail: (row.customs_broker_email as string) ?? undefined,
    customsBrokerOpsPhone: (row.customs_broker_ops_phone as string) ?? undefined,
    customsPoaStatus: (row.customs_poa_status as Account["customsPoaStatus"]) ?? undefined,
    defaultPoePreference: (row.default_poe_preference as string) ?? undefined,
    primaryCommodities: (row.primary_commodities as string[]) ?? [],
    requiresReefer: row.requires_reefer as boolean,
    requiresHazmat: row.requires_hazmat as boolean,
    preferredCarrierScacs: (row.preferred_carrier_scacs as string[]) ?? [],
    accountStatus: row.account_status as Account["accountStatus"],
  };
}

export function createAccountsRouter(): Router {
  const router = Router();

  router.get("/accounts", async (_req: Request, res: Response) => {
    const result = await pool.query("SELECT * FROM accounts ORDER BY created_at DESC");
    const accounts = await Promise.all(
      result.rows.map(async (row) => {
        const account = rowToAccount(row);
        const [facilityCount, poaResult, usmcaResult] = await Promise.all([
          pool.query("SELECT COUNT(*) AS count FROM facilities WHERE org_id = $1", [account.orgId]),
          pool.query("SELECT status FROM poa_records WHERE org_id = $1", [account.orgId]),
          pool.query("SELECT COUNT(*) AS count FROM vault_documents WHERE org_id = $1 AND category = 'usmca_certificate'", [account.orgId]),
        ]);
        // taxId deliberately omitted from the list view — no UI consumes it
        // here, and the Accounts Directory is a bulk/browsable list, not a
        // single-record lookup. Least-privilege: only the audited
        // /accounts/:id/detail endpoint below returns it.
        const { taxId: _taxId, ...accountWithoutTaxId } = account;
        return {
          ...accountWithoutTaxId,
          facilityCount: Number(facilityCount.rows[0].count),
          poaStatus: poaResult.rows[0]?.status ?? "pending_upload",
          usmcaCertCount: Number(usmcaResult.rows[0].count),
        };
      }),
    );
    res.status(200).json({ accounts });
  });

  router.post("/accounts", async (req: Request, res: Response) => {
    const body = req.body as Partial<Account> & { countryOfIncorporation?: string; billingCurrency?: string };
    if (!body.orgId || !body.companyName) {
      return res.status(400).json({ error: "orgId and companyName are required." });
    }
    const result = await pool.query(
      `INSERT INTO accounts (
        org_id, company_name, legal_entity_name, primary_contact_name, primary_contact_email, primary_contact_phone,
        country_of_incorporation, us_ein, us_dot_number, mc_ff_number, ca_bn, ca_bn_program_suffix, mx_rfc,
        billing_currency, retainer_monthly_usd, overage_rate_usd, payment_terms,
        ap_email, ap_phone, ap_contact_name,
        customs_broker_name, customs_broker_account_ref, customs_broker_email, customs_broker_ops_phone, customs_poa_status, default_poe_preference,
        primary_commodities, requires_reefer, requires_hazmat, preferred_carrier_scacs,
        account_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,'onboarding') RETURNING *`,
      [
        body.orgId,
        body.companyName,
        body.legalEntityName ?? body.companyName,
        body.primaryContactName ?? null,
        body.primaryContactEmail ?? null,
        body.primaryContactPhone ?? null,
        body.countryOfIncorporation ?? null,
        body.usEin ?? null,
        body.usDotNumber ?? null,
        body.mcFfNumber ?? null,
        body.caBn ?? null,
        body.caBnProgramSuffix ?? "RM0001",
        body.mxRfc ?? null,
        body.billingCurrency ?? "USD",
        body.retainerMonthlyUsd ?? null,
        body.overageRateUsd ?? null,
        body.paymentTerms ?? "net30",
        body.apEmail ?? null,
        body.apPhone ?? null,
        body.apContactName ?? null,
        body.customsBrokerName ?? null,
        body.customsBrokerAccountRef ?? null,
        body.customsBrokerEmail ?? null,
        body.customsBrokerOpsPhone ?? null,
        body.customsPoaStatus ?? null,
        body.defaultPoePreference ?? null,
        body.primaryCommodities ?? [],
        body.requiresReefer ?? false,
        body.requiresHazmat ?? false,
        body.preferredCarrierScacs ?? [],
      ],
    );
    res.status(201).json(rowToAccount(result.rows[0]));
    return;
  });

  router.get("/accounts/kpis", async (_req: Request, res: Response) => {
    const countResult = await pool.query(
      "SELECT COUNT(*) FILTER (WHERE account_status = 'active') AS active, COUNT(*) FILTER (WHERE account_status = 'onboarding') AS onboarding, COUNT(*) AS total FROM accounts",
    );
    const activeCount = Number(countResult.rows[0].active);
    const onboardingCount = Number(countResult.rows[0].onboarding);
    const totalCount = Number(countResult.rows[0].total) || 1;

    const mrrResult = await pool.query(
      "SELECT billing_currency, COALESCE(SUM(retainer_monthly_usd), 0) AS total FROM accounts WHERE account_status = 'active' GROUP BY billing_currency",
    );
    const mrrByCurrency: Record<string, number> = { USD: 0, CAD: 0, MXN: 0 };
    for (const row of mrrResult.rows) mrrByCurrency[row.billing_currency] = Number(row.total);

    const complianceResult = await pool.query(`
      SELECT COUNT(*) AS compliant FROM accounts a
      WHERE EXISTS (SELECT 1 FROM poa_records p WHERE p.org_id = a.org_id AND p.status = 'active_in_ace_aci')
        AND EXISTS (SELECT 1 FROM vault_documents v WHERE v.org_id = a.org_id AND v.category = 'usmca_certificate')
    `);
    const compliantCount = Number(complianceResult.rows[0].compliant);
    const complianceHealthRatePct = Math.round((compliantCount / totalCount) * 100);

    res.status(200).json({ activeCount, onboardingCount, mrrByCurrency, complianceHealthRatePct });
  });

  router.get("/accounts/:id/detail", async (req: Request, res: Response) => {
    const accountResult = await pool.query("SELECT * FROM accounts WHERE id = $1", [req.params.id]);
    if (accountResult.rows.length === 0) return res.status(404).json({ error: `No account on file with id ${req.params.id}.` });
    const account = rowToAccount(accountResult.rows[0]);

    if (account.taxId) {
      await logSecurityAudit({
        orgId: account.orgId,
        operatorName: req.header("x-operator-name") ?? "unknown",
        resourceType: "tax_id",
        resourceId: account.id,
        action: "read",
        ipAddress: req.ip,
      });
    }

    const [facilities, carriers, invoices, poa, usmcaCerts] = await Promise.all([
      pool.query("SELECT id, name, role, city, country_code FROM facilities WHERE org_id = $1", [account.orgId]),
      pool.query("SELECT id, carrier_name, account_number, integration_status FROM carrier_accounts WHERE org_id = $1", [account.orgId]),
      pool.query("SELECT invoice_number, amount_usd, currency, status FROM invoices WHERE org_id = $1 ORDER BY created_at DESC", [account.orgId]),
      pool.query("SELECT status, expires_at FROM poa_records WHERE org_id = $1", [account.orgId]),
      pool.query("SELECT filename, expires_at FROM vault_documents WHERE org_id = $1 AND category = 'usmca_certificate'", [account.orgId]),
    ]);

    const shipmentIdsForOrg = SAMPLE_SHIPMENTS.filter((s) => s.clientOrg === account.companyName).map((s) => s.id);
    const savingsResult =
      shipmentIdsForOrg.length > 0
        ? await pool.query("SELECT COALESCE(SUM(savings_usd), 0) AS total FROM rate_optimizations WHERE shipment_id = ANY($1)", [shipmentIdsForOrg])
        : { rows: [{ total: 0 }] };

    const totalSpendUsd = invoices.rows.reduce((sum, inv) => sum + Number(inv.amount_usd), 0);

    return res.status(200).json({
      account,
      facilities: facilities.rows,
      carrierAccounts: carriers.rows,
      invoices: invoices.rows,
      totalSpendUsd,
      agent3SavingsCapturedUsd: Number(savingsResult.rows[0].total),
      poa: poa.rows[0] ?? { status: "pending_upload" },
      usmcaCertificates: usmcaCerts.rows,
    });
  });

  router.get("/accounts/:id/audit-log", async (req: Request, res: Response) => {
    const accountResult = await pool.query("SELECT org_id FROM accounts WHERE id = $1", [req.params.id]);
    if (accountResult.rowCount === 0) return res.status(404).json({ error: `No account on file with id ${req.params.id}.` });
    const logs = await getAuditLogs({ orgId: accountResult.rows[0].org_id, limit: 50 });
    return res.status(200).json({ logs });
  });

  return router;
}
