-- ============================================================================
-- Pascal Logistics — Database Schema
-- Run against DATABASE_URL on first deploy. Replaces the in-memory Map
-- stores that were standing in for persistence pending this schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('shipper', 'consignee', 'both')),
  name TEXT NOT NULL,
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  state_or_province TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL,
  postal_code TEXT NOT NULL DEFAULT '',
  contact_phone_e164 TEXT,
  dock_height BOOLEAN NOT NULL DEFAULT false,
  drive_in_ramp BOOLEAN NOT NULL DEFAULT false,
  liftgate_required BOOLEAN NOT NULL DEFAULT false,
  forklift_on_site BOOLEAN NOT NULL DEFAULT false,
  max_trailer_length TEXT NOT NULL DEFAULT '53ft' CHECK (max_trailer_length IN ('53ft', '48ft', 'straight_truck')),
  receiving_hours_start TEXT NOT NULL DEFAULT '08:00',
  receiving_hours_end TEXT NOT NULL DEFAULT '16:00',
  lunch_break_closure TEXT,
  appointment_required BOOLEAN NOT NULL DEFAULT false,
  pickup_lead_time_hours INTEGER NOT NULL DEFAULT 24,
  driver_ppe TEXT[] NOT NULL DEFAULT '{}',
  twic_card_required BOOLEAN NOT NULL DEFAULT false,
  check_in_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facilities_org_id ON facilities (org_id);

CREATE TABLE IF NOT EXISTS commodities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  description TEXT,
  hts_code TEXT NOT NULL,
  country_of_origin TEXT NOT NULL,
  usmca_eligible BOOLEAN NOT NULL,
  is_hazmat BOOLEAN NOT NULL DEFAULT false,
  hazmat_un_number TEXT,
  hazmat_hazard_class TEXT,
  hazmat_packing_group TEXT,
  hazmat_sds_on_file BOOLEAN NOT NULL DEFAULT false,
  preferred_poe TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commodities_org_id ON commodities (org_id);

CREATE TABLE IF NOT EXISTS alert_preferences (
  org_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ceo', 'logistics_manager', 'driver')),
  channels TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role)
);

CREATE TABLE IF NOT EXISTS exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('missed_pickup', 'missed_delivery')),
  minutes_past_window INTEGER NOT NULL,
  fault_classification TEXT NOT NULL CHECK (fault_classification IN ('carrier_fault', 'facility_fault', 'force_majeure')),
  fault_reasoning TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exceptions_shipment_id ON exceptions (shipment_id);

-- Customs POA lifecycle — closes the gap where the simulation engine had a
-- hardcoded org->status map standing in for this.
CREATE TABLE IF NOT EXISTS poa_records (
  org_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending_upload', 'uploaded_pending_broker_review', 'active_in_ace_aci', 'expired_needs_renewal')),
  document_id TEXT,
  uploaded_at TIMESTAMPTZ,
  broker_notified_at TIMESTAMPTZ,
  broker_name TEXT,
  broker_email TEXT,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the demo org as already-onboarded with an active POA — reflects a
-- real established client, not a brand-new signup, for demo/simulation
-- purposes. Idempotent: safe to re-run this script against an existing DB.
INSERT INTO poa_records (org_id, status, broker_name, broker_email, activated_at, expires_at)
VALUES ('org_meridian', 'active_in_ace_aci', 'Pacific Gateway Brokerage', 'broker@pacificgateway.com', now(), now() + interval '300 days')
ON CONFLICT (org_id) DO NOTHING;

-- ============================================================================
-- OPERATOR CONTROL TOWER — added to close the gap flagged after the client
-- was fully built and deployed: the operator side didn't exist yet in this
-- Render backend.
-- ============================================================================

-- CRM & Account Directory (Operator desk #6)
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  primary_contact_name TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,
  tax_id TEXT,
  credit_limit_usd NUMERIC(12,2),
  retainer_tier TEXT,
  retainer_monthly_usd NUMERIC(10,2),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'onboarding', 'suspended', 'churned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carrier Desk (Agent 7) — carrier accounts on file per org
CREATE TABLE IF NOT EXISTS carrier_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  carrier_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_format_valid BOOLEAN,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carrier_accounts_org_id ON carrier_accounts (org_id);

-- Billing & Admin Desk (Agent 8)
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  shipment_id TEXT,
  amount_usd NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'disputed')),
  pod_audit_passed BOOLEAN,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices (org_id);

-- Sales & Social Leads Desk (Agent 10)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  segment TEXT, -- e.g. "Surrey Manufacturers", "Blaine Importers" — the Prospect Segment Queue filters on this
  source TEXT,
  stage TEXT NOT NULL DEFAULT 'new_unqualified' CHECK (stage IN ('new_unqualified', 'discovery_sop_review', 'rfq_issued', 'retainer_sent', 'closed_won', 'lost')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document Vault (Operator desk #8) — Commercial Invoices, POAs, BOLs, SDS sheets
CREATE TABLE IF NOT EXISTS vault_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  shipment_id TEXT,
  filename TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('commercial_invoice', 'poa', 'bill_of_lading', 'sds', 'usmca_certificate', 'other')),
  extracted_fields JSONB,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_documents_org_id ON vault_documents (org_id);

-- Shared Logistics Calendar (Operator desk #9, Client Portal #6)
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('pickup', 'delivery', 'laycan', 'demurrage_deadline', 'poa_expiry', 'other')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  shipment_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_org_id ON calendar_events (org_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_starts_at ON calendar_events (starts_at);

-- Executive Review Drawer (Agent 9) — persists PENDING_ROGER_APPROVAL drafts
-- so they can be listed and actioned, not just returned transiently from
-- the ingest response.
CREATE TABLE IF NOT EXISTS executive_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT NOT NULL,
  draft_type TEXT NOT NULL CHECK (draft_type IN ('shipment_approval', 'dispute_letter')),
  subject TEXT,
  body TEXT,
  rationale TEXT,
  confidence_score NUMERIC(3,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_executive_drafts_status ON executive_drafts (status);

-- Seed one CRM account matching the demo org used throughout this platform,
-- and a few carrier accounts, so the operator desks have something real to
-- display immediately rather than an empty state on first load.
INSERT INTO accounts (org_id, company_name, primary_contact_name, primary_contact_email, primary_contact_phone, tax_id, credit_limit_usd, retainer_tier, retainer_monthly_usd, account_status)
VALUES ('org_meridian', 'Meridian Cold Chain', 'Alicia Ford', 'a.ford@meridiancoldchain.com', '+16045551234', '742690123', 250000, 'Dual-Side Standard', 3200, 'active')
ON CONFLICT (org_id) DO NOTHING;

-- Real bug fix, same class as the earlier leads duplication: this INSERT's
-- bare ON CONFLICT DO NOTHING had no actual unique constraint to match
-- against, so every schema re-run (including future redeploys, not just
-- this session's repeated testing) silently added another duplicate ODFL
-- row. Deduplicate existing rows first, then add a real constraint.
DELETE FROM carrier_accounts a USING carrier_accounts b
WHERE a.org_id = b.org_id AND a.carrier_name = b.carrier_name AND a.account_number = b.account_number AND a.created_at > b.created_at;

DO $$
BEGIN
  ALTER TABLE carrier_accounts ADD CONSTRAINT carrier_accounts_org_carrier_account_unique UNIQUE (org_id, carrier_name, account_number);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

INSERT INTO carrier_accounts (org_id, carrier_name, account_number, account_format_valid, last_verified_at)
VALUES ('org_meridian', 'ODFL', 'MCC-1102', true, now())
ON CONFLICT (org_id, carrier_name, account_number) DO NOTHING;

-- ============================================================================
-- CALL ACTIVITY & COMPLIANCE (Desk #5/#6) — human-initiated call logging
-- with AI-assisted post-call transcription analysis, and a real DNC
-- registry that gates future outreach. Deliberately does NOT include any
-- autodialer/outbound-calling infrastructure — every call log here
-- represents a call a human operator actually placed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dnc_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_value TEXT NOT NULL UNIQUE, -- phone or email, normalized lowercase/digits-only
  contact_name TEXT,
  reason TEXT,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_name TEXT,
  contact_phone TEXT,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_minutes INTEGER,
  transcript_text TEXT,
  sentiment TEXT CHECK (sentiment IN ('hot_lead', 'needs_information', 'not_interested')),
  extracted_entities JSONB,
  next_steps TEXT,
  operator_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id ON call_logs (lead_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_called_at ON call_logs (called_at);

-- ============================================================================
-- MIGRATIONS — CRMCallAssistEngine extension
-- CREATE TABLE IF NOT EXISTS silently skips tables that already exist (true
-- for every environment this has already been deployed to, including
-- Render), so new columns on existing tables need explicit ALTER
-- statements to actually apply on redeploy rather than only in a fresh DB.
-- ============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS segment TEXT;

-- Human-selected call outcome, distinct from the AI-inferred `sentiment`
-- column — an operator explicitly picks one of these five after the call,
-- rather than it being purely inferred from the transcript.
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS call_outcome TEXT
  CHECK (call_outcome IN ('connected', 'voicemail', 'not_interested', 'hot_lead', 'opt_out_dnc'));
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- ORDERING FIX: the seed INSERT below used to run here, before the
-- leads_stage_check constraint swap further down remaps stage values to
-- the new vocabulary. On a database that already has the OLD constraint
-- (pre-dating this round), 'new_unqualified' isn't allowed yet at this
-- point in the transaction, so the insert was rejected with a check
-- constraint violation. Moved to after the DROP/remap/ADD CONSTRAINT
-- block below, where the new stage values are actually valid.

-- ============================================================================
-- CEO HUB OVERHAUL — real activity audit trail and persisted Agent 3
-- savings history. This genuinely fixes the earlier $0 mtdCapitalSavedUsd
-- gap: previously nothing captured rate-optimization results per shipment,
-- so "capital saved" could only reflect paid invoices. Now the pipeline
-- persists every Agent 3 result, and CEO metrics sum the real history.
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL, -- e.g. 'paps_released', 'rate_savings_captured', 'reroute_triggered', 'executive_decision'
  shipment_id TEXT,
  message TEXT NOT NULL,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_occurred_at ON activity_log (occurred_at DESC);

CREATE TABLE IF NOT EXISTS rate_optimizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT NOT NULL,
  contracted_rate_usd NUMERIC(10,2) NOT NULL,
  benchmark_spot_rate_usd NUMERIC(10,2) NOT NULL,
  savings_usd NUMERIC(10,2) NOT NULL,
  savings_flagged BOOLEAN NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_optimizations_captured_at ON rate_optimizations (captured_at);

ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ============================================================================
-- CARRIER DESK OVERHAUL — multi-mode carrier directory, real scorecard
-- fields. On-time %/claims rate are manually-entered here (real EDI/carrier
-- scorecard data an operator would actually have), not computed — there's
-- no persisted delivery-outcome history to derive them from yet. Border
-- clearance velocity IS computed live from the real telemetry service
-- (no new column needed for that).
-- ============================================================================

ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS carrier_mode TEXT DEFAULT 'road' CHECK (carrier_mode IN ('road', 'ocean', 'air', 'broker'));
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS scac_code TEXT;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS iata_code TEXT;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS fmc_number TEXT;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS integration_status TEXT DEFAULT 'legacy_scraper' CHECK (integration_status IN ('live_api', 'edi_ftp', 'legacy_scraper'));
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS emergency_phone TEXT;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS dispatch_email TEXT;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS account_exec_name TEXT;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS coi_expires_at TIMESTAMPTZ;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS dot_mc_rating TEXT;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS twic_ctpat_cert BOOLEAN DEFAULT false;
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS on_time_pct NUMERIC(5,2);
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS claims_rate_pct NUMERIC(5,2);

-- Backfill the seeded ODFL account with real-shaped scorecard data so the
-- desk has something genuine to display on first load.
UPDATE carrier_accounts SET
  carrier_mode = 'road', scac_code = 'ODFL', integration_status = 'edi_ftp',
  emergency_phone = '+18007742930', dispatch_email = 'dispatch@odfl.com',
  account_exec_name = 'Karen Whitmore', coi_expires_at = now() + interval '120 days',
  dot_mc_rating = 'Satisfactory', twic_ctpat_cert = true, on_time_pct = 96.4, claims_rate_pct = 0.8
WHERE carrier_name = 'ODFL' AND scac_code IS NULL;

-- ============================================================================
-- BILLING & ADMIN DESK OVERHAUL — multi-currency Financial Command Center.
-- HONEST LIMITATION: "Send Quick Pay Link" generates a real shareable link
-- and sends it via the real AgentMail module already verified elsewhere in
-- this platform, but no live payment processor is wired — clicking the
-- link doesn't actually collect money yet. Flagged in the API response,
-- not hidden.
-- ============================================================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('CAD', 'USD', 'MXN'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_entity TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_id_type TEXT CHECK (tax_id_type IN ('CA_BN_GST_PST', 'US_EIN', 'MX_RFC'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'net30' CHECK (payment_terms IN ('net15', 'net30'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pod_status TEXT DEFAULT 'missing' CHECK (pod_status IN ('verified', 'missing'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS carrier_invoice_amount_usd NUMERIC(10,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS agent3_quoted_amount_usd NUMERIC(10,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dispute_flags JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quick_pay_token TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quick_pay_sent_at TIMESTAMPTZ;

-- Real seed data so the desk has genuine multi-currency invoices to
-- display on first load, spanning all 3 currencies and both POD states.
INSERT INTO invoices (org_id, invoice_number, shipment_id, amount_usd, status, currency, client_entity, tax_id, tax_id_type, pod_status, carrier_invoice_amount_usd, agent3_quoted_amount_usd)
VALUES
  ('org_meridian', 'INV-CAD-2201', 'SHIP-2026-4402', 10450, 'sent', 'CAD', 'Meridian Cold Chain (CA)', '123456789RT0001', 'CA_BN_GST_PST', 'verified', 8400, 8400),
  ('org_meridian', 'INV-USD-2202', 'SHIP-2026-8801', 20000, 'paid', 'USD', 'Meridian Cold Chain (US)', '84-1234567', 'US_EIN', 'verified', 3520, 3520),
  ('org_meridian', 'INV-MXN-2203', 'SHIP-2026-0774', 168000, 'disputed', 'MXN', 'Meridian Cold Chain (MX)', 'MECC850101AB1', 'MX_RFC', 'missing', 9200, 8400)
ON CONFLICT (invoice_number) DO NOTHING;

-- ============================================================================
-- SALES & LEADS DESK OVERHAUL — real pipeline stages, lead channel badges,
-- trade-corridor detail fields, and timestamps for a genuine sales-velocity
-- calculation (not a fabricated number).
-- ============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_annual_value_usd NUMERIC(12,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_monthly_volume TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS primary_transport_mode TEXT CHECK (primary_transport_mode IN ('road', 'ocean', 'air'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS target_border_crossing TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS legal_entity TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS operating_regions TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS commodities TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS target_lanes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_channel TEXT CHECK (lead_channel IN ('linkedin_inmail', 'inbound_rfq', 'cold_outreach', 'referral', 'web_intake'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- Real stage re-mapping: the spec's 5 pipeline stages don't match the
-- original enum, and existing rows already hold the old values — remap
-- them before swapping the constraint, so this migration is safe against
-- real, already-seeded data, not just a fresh table. Idempotent: the
-- WHERE clause only touches rows still on old-style values, so re-running
-- this is a no-op on rows already migrated.
--
-- ORDERING BUG FIX: the constraint must be dropped BEFORE the UPDATE
-- runs, not after — the old CHECK constraint would otherwise reject the
-- new stage values mid-migration (caught by actually running this against
-- real accumulated data, not just a fresh table).
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;

UPDATE leads SET stage = CASE stage
  WHEN 'new' THEN 'new_unqualified'
  WHEN 'contacted' THEN 'discovery_sop_review'
  WHEN 'qualified' THEN 'rfq_issued'
  WHEN 'onboarding_triggered' THEN 'retainer_sent'
  WHEN 'won' THEN 'closed_won'
  ELSE stage
END
WHERE stage NOT IN ('new_unqualified', 'discovery_sop_review', 'rfq_issued', 'retainer_sent', 'closed_won', 'lost');

DO $$
BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_stage_check CHECK (stage IN ('new_unqualified', 'discovery_sop_review', 'rfq_issued', 'retainer_sent', 'closed_won', 'lost'));
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- Seed a couple of segmented leads so the Prospect Segment Queue has real
-- filterable data on first load. Runs here, AFTER the constraint above
-- already permits the new stage vocabulary — moved from earlier in this
-- file where it previously hit the OLD (pre-remap) constraint on any
-- database that had already been deployed to before this round.
INSERT INTO leads (company_name, contact_name, contact_phone, segment, source, stage)
VALUES
  ('Fraser Valley Fabrication', 'Tomas Reyes', '+16045552201', 'Surrey Manufacturers', 'Clay prospecting', 'new_unqualified'),
  ('Blaine Import Partners', 'Wendy Cho', '+13605552202', 'Blaine Importers', 'LinkedIn', 'discovery_sop_review')
ON CONFLICT DO NOTHING;

-- Real bug fix: the original leads seed used ON CONFLICT DO NOTHING with
-- no actual unique constraint to conflict on, so re-running this schema
-- across sessions silently created duplicate rows every time (caught by
-- querying real accumulated data — 5 copies of each seeded lead existed).
-- Deduplicate first, keeping the earliest row per company.
DELETE FROM leads a USING leads b
WHERE a.company_name = b.company_name AND a.created_at > b.created_at;

-- Postgres has no native "ADD CONSTRAINT IF NOT EXISTS" — DROP-then-ADD
-- (used above for the CHECK constraint) turned out insufficient once this
-- ran inside Render's actual migrate.ts, which executes the whole file as
-- ONE implicit transaction: a later unrelated error rolled back an
-- earlier successful DROP within the same run, so on the next attempt the
-- ADD below could still hit "already exists." This exception-catching
-- form is genuinely safe regardless of what happened earlier in the same
-- transaction — verified by running the real migrate.ts back-to-back.
DO $$
BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_company_name_unique UNIQUE (company_name);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- Backfill the 2 seeded leads with real-shaped trade-corridor data so the
-- desk has genuine detail to display on first load.
UPDATE leads SET
  estimated_annual_value_usd = 145000, estimated_monthly_volume = '12 LTL shipments/mo',
  primary_transport_mode = 'road', target_border_crossing = 'pacific_highway',
  operating_regions = 'Fraser Valley to Metro Vancouver / WA Corridor',
  commodities = 'Steel fabrication components, machinery parts',
  target_lanes = 'Canada -> US Pacific Northwest',
  lead_channel = 'referral', first_contact_at = created_at
WHERE company_name = 'Fraser Valley Fabrication' AND estimated_annual_value_usd IS NULL;

UPDATE leads SET
  estimated_annual_value_usd = 210000, estimated_monthly_volume = '4 FTL + 2 FCL/mo',
  primary_transport_mode = 'road', target_border_crossing = 'pacific_highway',
  operating_regions = 'Blaine, WA -> Lower Mainland BC',
  commodities = 'Frozen poultry, cold chain goods',
  target_lanes = 'US -> Canada',
  lead_channel = 'linkedin_inmail', first_contact_at = created_at
WHERE company_name = 'Blaine Import Partners' AND estimated_annual_value_usd IS NULL;

-- ============================================================================
-- CALL ACTIVITY DESK OVERHAUL — real operator attribution on DNC entries
-- (for the compliance audit table), and a real key-notes summary column
-- distinct from the full transcript (so the call log table can show a
-- short summary without dumping the entire transcript inline).
-- ============================================================================

ALTER TABLE dnc_registry ADD COLUMN IF NOT EXISTS operator_name TEXT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS key_notes_summary TEXT;

-- ============================================================================
-- CRM ACCOUNT DIRECTORY OVERHAUL — real cross-border identifiers, contract
-- terms, and compliance opt-ins. Pure additions only (accounts.org_id is
-- already a real unique key from the first round), so no remapping risk
-- like the leads-stage migration two rounds back.
-- ============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS legal_entity_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS operating_dba TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS operations_manager_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_phone TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS us_ein TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ca_bn TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mx_rfc TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS country_of_incorporation TEXT CHECK (country_of_incorporation IN ('US', 'CA', 'MX', 'INTL'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS billing_currency TEXT NOT NULL DEFAULT 'USD' CHECK (billing_currency IN ('USD', 'CAD', 'MXN'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS payment_terms TEXT NOT NULL DEFAULT 'net30' CHECK (payment_terms IN ('net15', 'net30', 'credit_card'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS house_spot_benchmark_opt_in BOOLEAN NOT NULL DEFAULT false;

-- Backfill the seeded Meridian Cold Chain account with real-shaped detail
-- so the directory has genuine cross-border data to display immediately.
UPDATE accounts SET
  legal_entity_name = 'Meridian Cold Chain Logistics Inc.', operating_dba = 'Meridian Cold Chain',
  operations_manager_name = 'Priya Nathan', ap_email = 'ap@meridiancoldchain.com', ap_phone = '+16045559001',
  us_ein = '84-1234567', ca_bn = '123456789RT0001', country_of_incorporation = 'CA',
  billing_currency = 'USD', payment_terms = 'net30', house_spot_benchmark_opt_in = true
WHERE org_id = 'org_meridian' AND legal_entity_name IS NULL;

-- ============================================================================
-- FACILITY MANAGEMENT & WAREHOUSE RULES HUB OVERHAUL — direct operator
-- entry (no longer client-portal-only), dock contact & receiving email,
-- break windows, dock/equipment constraints, safety/PPE, free-time &
-- detention policy, capability tags for filtering, and soft-archive.
-- ORDERING NOTE: follows the same lesson as the leads migration above —
-- all of the following are additive ALTER TABLE ... ADD COLUMN IF NOT
-- EXISTS statements with safe defaults, so there's no CHECK-constraint
-- ordering risk against already-seeded rows.
-- ============================================================================

ALTER TABLE facilities ADD COLUMN IF NOT EXISTS dock_contact_name TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS dock_contact_phone TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS receiving_email TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS break_window TEXT; -- e.g. "12:00-12:30"
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS dock_door_count INTEGER;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS iso_container_capable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS scale_on_site BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS hard_hat_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS steel_toe_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS driver_staging_notes TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS staging_map_url TEXT;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS free_time_minutes INTEGER NOT NULL DEFAULT 120;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS detention_rate_usd_per_hour NUMERIC(8,2) NOT NULL DEFAULT 75.00;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS capabilities TEXT[] NOT NULL DEFAULT '{}';
  -- allowed tags enforced at the app layer: cold_storage, cross_dock, hazmat_approved, overhead_crane
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS added_by TEXT NOT NULL DEFAULT 'client_portal' CHECK (added_by IN ('client_portal', 'operator'));

-- Real seed data so the Facility Management Hub is never empty on first
-- load, spanning the 3 profiles the operator sees on day one. Uses the
-- same dedupe-safe pattern as the leads seed above: no unique constraint
-- exists on (org_id, name) yet, so guard with a NOT EXISTS check instead
-- of a bare ON CONFLICT that would silently no-op against nothing.
INSERT INTO facilities (
  org_id, role, name, street, city, state_or_province, country_code, postal_code,
  dock_contact_name, dock_contact_phone, receiving_email,
  dock_height, liftgate_required, forklift_on_site, max_trailer_length,
  receiving_hours_start, receiving_hours_end, break_window,
  dock_door_count, iso_container_capable, scale_on_site,
  hard_hat_required, steel_toe_required, twic_card_required, driver_staging_notes, staging_map_url,
  free_time_minutes, detention_rate_usd_per_hour, capabilities, added_by
)
SELECT * FROM (VALUES
  ('org_meridian', 'both', 'Surrey Main Manufacturing Plant', '18800 96 Ave', 'Surrey', 'BC', 'CA', 'V4N 3P3',
   'Dale Whitfield', '+16045557711', 'receiving@surreymfg.example.com',
   true, false, true, '53ft',
   '06:00', '18:00', '12:00-12:30',
   6, false, true,
   true, true, false, 'Stage in Lane 3, check in at the guard shack before backing to a door.', 'https://maps.example.com/surrey-main-plant',
   120, 75.00, ARRAY['cross_dock'], 'operator'),
  ('org_meridian', 'consignee', 'Blaine Border Distribution Center', '1400 Peace Portal Dr', 'Blaine', 'WA', 'US', '98230',
   'Renee Castillo', '+13605558822', 'dock@blainedist.example.com',
   true, true, true, '53ft',
   '05:00', '17:00', '11:30-12:00',
   10, true, true,
   true, true, true, 'TWIC required at gate. Customs staging lot is separate from the receiving dock — follow signage.', 'https://maps.example.com/blaine-border-dc',
   120, 85.00, ARRAY['cold_storage', 'cross_dock'], 'operator'),
  ('org_meridian', 'consignee', 'Harrison Hot Springs Depot', '250 Hot Springs Rd', 'Harrison Hot Springs', 'BC', 'CA', 'V0M 1K0',
   'Grant Pelletier', '+16045553344', 'depot@harrisonhs.example.com',
   false, false, false, '48ft',
   '07:00', '15:30', '',
   2, false, false,
   true, true, false, 'Flatbed receiving only — overhead crane operator must be on-site to unload, call ahead.', 'https://maps.example.com/harrison-hot-springs-depot',
   90, 65.00, ARRAY['overhead_crane'], 'operator')
) AS seed(org_id, role, name, street, city, state_or_province, country_code, postal_code,
  dock_contact_name, dock_contact_phone, receiving_email,
  dock_height, liftgate_required, forklift_on_site, max_trailer_length,
  receiving_hours_start, receiving_hours_end, break_window,
  dock_door_count, iso_container_capable, scale_on_site,
  hard_hat_required, steel_toe_required, twic_card_required, driver_staging_notes, staging_map_url,
  free_time_minutes, detention_rate_usd_per_hour, capabilities, added_by)
WHERE NOT EXISTS (SELECT 1 FROM facilities f WHERE f.name = seed.name);

-- ============================================================================
-- SCHEDULING HUB OVERHAUL — Logistics Calendar becomes an interactive,
-- category-driven scheduling surface shared by both the Operator Control
-- Tower and the Client Portal. Consolidates the original 6 event_type
-- values into the 4 requested category badges (dock appointments, ocean
-- laycan/demurrage, border clearance/PAPS windows, discovery calls &
-- client meetings), plus facility linkage, timezone, reminder
-- thresholds/channels, and a real status lifecycle for reschedule/cancel.
--
-- ORDERING: same lesson as the leads_stage_check fix earlier in this file
-- — DROP the old CHECK constraint, remap existing rows, THEN add the new
-- CHECK constraint, all before anything downstream tries to insert or
-- update using the new vocabulary.
-- ============================================================================

ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_event_type_check;

UPDATE calendar_events SET event_type = CASE event_type
  WHEN 'pickup' THEN 'dock_appointment'
  WHEN 'delivery' THEN 'dock_appointment'
  WHEN 'laycan' THEN 'ocean_demurrage'
  WHEN 'demurrage_deadline' THEN 'ocean_demurrage'
  WHEN 'poa_expiry' THEN 'border_clearance'
  ELSE event_type
END;

-- Real backfill, not a guess: the hot-lead auto-scheduler in calls.ts has
-- been inserting these with event_type='other' + a predictable title
-- prefix since the CRM Call Assist round — this reclassifies rows that
-- already exist in a deployed database so they show up under the correct
-- badge retroactively, not just going forward.
UPDATE calendar_events SET event_type = 'discovery_call' WHERE event_type = 'other' AND title ILIKE 'Discovery call%';

ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_event_type_check
  CHECK (event_type IN ('dock_appointment', 'ocean_demurrage', 'border_clearance', 'discovery_call', 'other'));

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS poe_id TEXT CHECK (poe_id IS NULL OR poe_id IN ('peace_arch', 'pacific_highway', 'aldergrove', 'sumas', 'point_roberts'));
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES facilities(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles' CHECK (timezone IN ('America/Los_Angeles', 'America/New_York', 'UTC'));
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS reminder_thresholds TEXT[] NOT NULL DEFAULT '{}'; -- e.g. '15m', '1h', '24h'
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] NOT NULL DEFAULT '{}'; -- e.g. 'email', 'sms'
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'rescheduled', 'cancelled'));

-- Real seed events so the Scheduling Hub is never blank on first load.
-- Uses relative offsets from NOW() rather than hardcoded dates so "Today"
-- and "Tomorrow" stay genuinely true no matter when this migration runs,
-- and links directly to real existing entities (SHIP-2026-8801 from the
-- sample shipment set, the Surrey Main Manufacturing Plant facility
-- seeded in the Facility Hub round, and the Fraser Valley
-- Fabrication / Blaine Import Partners leads from the Sales & Leads
-- round) rather than inventing disconnected placeholder IDs.
INSERT INTO calendar_events (org_id, title, event_type, starts_at, ends_at, shipment_id, poe_id, facility_id, timezone, reminder_thresholds, reminder_channels, notes)
SELECT
  'org_meridian',
  'Dock Appointment: Surrey Main Plant',
  'dock_appointment',
  date_trunc('day', now()) + interval '14 hours',
  date_trunc('day', now()) + interval '15 hours',
  'SHIP-2026-8801',
  NULL,
  (SELECT id FROM facilities WHERE name = 'Surrey Main Manufacturing Plant' LIMIT 1),
  'America/Los_Angeles',
  ARRAY['1h', '24h'],
  ARRAY['sms'],
  'Reefer 53ft — confirm dock door assignment on arrival.'
WHERE NOT EXISTS (SELECT 1 FROM calendar_events WHERE title = 'Dock Appointment: Surrey Main Plant' AND shipment_id = 'SHIP-2026-8801');

INSERT INTO calendar_events (org_id, title, event_type, starts_at, poe_id, timezone, reminder_thresholds, reminder_channels, notes)
SELECT
  'org_meridian',
  'Demurrage Free Time Expiration',
  'ocean_demurrage',
  date_trunc('day', now()) + interval '1 day 17 hours',
  NULL,
  'America/Los_Angeles',
  ARRAY['24h', '1h'],
  ARRAY['email', 'sms'],
  'Port of Vancouver — 40'' HC container, free time expires at the deadline above.'
WHERE NOT EXISTS (SELECT 1 FROM calendar_events WHERE title = 'Demurrage Free Time Expiration');

INSERT INTO calendar_events (org_id, title, event_type, starts_at, poe_id, timezone, reminder_thresholds, reminder_channels, notes)
SELECT
  'org_meridian',
  'Customs Clearance Window: Sumas POE',
  'border_clearance',
  date_trunc('day', now()) + interval '2 days 9 hours',
  'sumas',
  'America/Los_Angeles',
  ARRAY['1h'],
  ARRAY['sms'],
  'Fraser Valley Fabrication — PAPS pre-filed, confirm release before crossing.'
WHERE NOT EXISTS (SELECT 1 FROM calendar_events WHERE title = 'Customs Clearance Window: Sumas POE');

INSERT INTO calendar_events (org_id, title, event_type, starts_at, ends_at, timezone, reminder_thresholds, reminder_channels, notes)
SELECT
  'org_meridian',
  'Discovery Call: Blaine Import Partners',
  'discovery_call',
  date_trunc('day', now()) + interval '3 days 11 hours',
  date_trunc('day', now()) + interval '3 days 11 hours 30 minutes',
  'America/Los_Angeles',
  ARRAY['15m'],
  ARRAY['email'],
  'Zoom Phone — contact: Wendy Cho.'
WHERE NOT EXISTS (SELECT 1 FROM calendar_events WHERE title = 'Discovery Call: Blaine Import Partners');

-- ============================================================================
-- CONSULTATIVE REROUTE & BROKER NOTIFICATION WORKFLOW (Prompts 36 & 39)
-- Non-unilateral by design — see server/src/types/reroute.ts for the full
-- status lifecycle. No auto-rerouting: every advisory sits at
-- 'pending_client_signoff' until a named Client Logistics Manager approves
-- it, which is the only thing that triggers the broker email dispatch;
-- driver dispatch stays held at 'pending_broker_confirmation' until the
-- broker confirms back.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reroute_advisories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT NOT NULL,
  from_poe_id TEXT NOT NULL,
  to_poe_id TEXT NOT NULL,
  from_wait_minutes INTEGER NOT NULL,
  to_wait_minutes INTEGER NOT NULL,
  delta_minutes INTEGER NOT NULL CHECK (delta_minutes > 30), -- 30-Min Delay Threshold Guard, enforced at the DB level too
  net_time_saved_minutes INTEGER NOT NULL,
  net_value_usd NUMERIC(8,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_client_signoff' CHECK (status IN (
    'pending_client_signoff', 'client_approved', 'client_declined',
    'pending_broker_confirmation', 'broker_confirmed', 'dispatch_released'
  )),
  client_signoff_name TEXT, -- the Client's Logistics Manager, never the operator — enforced at the API layer
  client_signoff_at TIMESTAMPTZ,
  broker_email TEXT,
  original_port_code TEXT,
  amended_port_code TEXT,
  broker_confirmed_at TIMESTAMPTZ,
  dispatch_released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reroute_advisories_shipment_id ON reroute_advisories (shipment_id);
CREATE INDEX IF NOT EXISTS idx_reroute_advisories_status ON reroute_advisories (status);

-- ============================================================================
-- SECURITY AUDIT LOGGER + S3-KMS SIGNED DOWNLOAD URLS
-- Append-only audit trail for every operator read/export of client tax IDs
-- (EIN/BN/RFC) and POA documents, plus real short-lived signed URLs for
-- Document Vault downloads.
--
-- HONEST LIMITATION: vault_documents has never had a binary file upload
-- path — POST /api/operator/vault stores filename + OCR-extracted text
-- fields only (see routes/vault.ts). s3_key is added here so the signed-
-- URL service and audit logger are real and ready, but it stays NULL
-- until a real upload flow (presigned PUT + client file picker) exists.
-- Until then, generateVaultDownloadUrl only produces a working link for
-- documents that were seeded/backfilled with a real key.
-- ============================================================================

ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS s3_key TEXT;

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('tax_id', 'poa_document', 'vault_document')),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'export', 'download')),
  ip_address TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_org_id ON security_audit_logs (org_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_resource ON security_audit_logs (resource_type, resource_id);

-- ============================================================================
-- RAPID DISPATCH DESK — warehouse shipping-clerk outbound staging.
-- Real historical data source for the Weight Anomaly Sentinel (averages
-- computed from actual prior outbound_staging rows, not invented), real
-- carrier cutoff times, and a genuinely public (no-login) magic-upload
-- token flow for the mobile dock-camera BOL capture.
-- ============================================================================

ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS daily_cutoff_local_time TEXT; -- e.g. '17:00'
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS cutoff_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';

CREATE TABLE IF NOT EXISTS outbound_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  po_number TEXT,
  bol_number TEXT,
  sku TEXT,
  consignee_facility_id UUID REFERENCES facilities(id),
  carrier_account_id UUID REFERENCES carrier_accounts(id),
  packaging_type TEXT NOT NULL CHECK (packaging_type IN ('standard_48x40', 'chep_pallet', 'reefer_tote', 'parcel_carton')),
  pallet_count INTEGER NOT NULL DEFAULT 1,
  gross_weight_lbs NUMERIC(10,2) NOT NULL,
  freight_class TEXT,
  is_cross_border BOOLEAN NOT NULL DEFAULT false,
  paps_pars_barcode TEXT,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'loaded', 'dispatched', 'cancelled')),
  driver_phone TEXT,
  staged_by TEXT,
  staged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbound_staging_org_status ON outbound_staging (org_id, status);
CREATE INDEX IF NOT EXISTS idx_outbound_staging_staged_at ON outbound_staging (staged_at DESC);

CREATE TABLE IF NOT EXISTS magic_upload_tokens (
  token TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  outbound_staging_id UUID REFERENCES outbound_staging(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

-- ============================================================================
-- CLIENT EXPERIENCE SUITE — Executive Brief, Public Tracker & Webhooks
-- ============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS teams_webhook_url TEXT;

-- Rapid Dispatch quick-add carrier modal — service_type is distinct from
-- carrier_mode (road/ocean/air/broker): LTL/FTL/Reefer is a service-level
-- classification within road freight, not a transport mode, so it's a
-- separate additive column rather than overloading carrier_mode.
ALTER TABLE carrier_accounts ADD COLUMN IF NOT EXISTS service_type TEXT CHECK (service_type IS NULL OR service_type IN ('LTL', 'FTL', 'Reefer'));

-- ============================================================================
-- ENTERPRISE ACCOUNT INTAKE — jurisdiction identifiers, broker/POA,
-- retainer/overage terms, and operations profile defaults.
-- ORDERING: payment_terms CHECK extension follows the safe DROP -> ADD
-- pattern used earlier in this file — no existing rows use a value this
-- removes, so no remap step is needed, just widen the allowed list.
-- ============================================================================

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_payment_terms_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_payment_terms_check CHECK (payment_terms IN ('net15', 'net30', 'due_upon_receipt', 'credit_card'));

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS us_dot_number TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mc_ff_number TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ca_bn_program_suffix TEXT DEFAULT 'RM0001'; -- CBSA import/export program identifier appended to the 9-digit BN

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customs_broker_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customs_broker_account_ref TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customs_broker_email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customs_broker_ops_phone TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS customs_poa_status TEXT CHECK (customs_poa_status IS NULL OR customs_poa_status IN ('active_verified', 'pending_signature', 'exempt'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_poe_preference TEXT; -- e.g. "Blaine 3004", "Sumas 3009"

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS overage_rate_usd NUMERIC(8,2);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_contact_name TEXT;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS primary_commodities TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS requires_reefer BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS requires_hazmat BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferred_carrier_scacs TEXT[] NOT NULL DEFAULT '{}';

-- Rapid Dispatch: richer staging capture per Roger's system-check request —
-- driver name (phone already existed), trailer/seal number for real
-- chain-of-custody tracking, dock door assignment, and freeform handling
-- notes for anything unusual at dispatch time.
ALTER TABLE outbound_staging ADD COLUMN IF NOT EXISTS driver_name TEXT;
ALTER TABLE outbound_staging ADD COLUMN IF NOT EXISTS trailer_seal_number TEXT;
ALTER TABLE outbound_staging ADD COLUMN IF NOT EXISTS dock_door TEXT;
ALTER TABLE outbound_staging ADD COLUMN IF NOT EXISTS handling_notes TEXT;

-- Company profile basics that were genuinely missing from the base accounts
-- table since its original creation — a real gap Roger caught: no address
-- at all on the account record itself (distinct from operational facility
-- addresses in the facilities table). Also adding website and industry,
-- standard basics for any B2B account record.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address_street TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address_city TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address_state_or_province TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address_postal_code TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address_country_code TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS industry TEXT;

-- Shipping department contact — distinct from primary_contact (general
-- business contact) and ap_contact (billing): the person Pascal's
-- operators actually coordinate with day-to-day for pickups, appointments,
-- and shipment-specific questions at the client's own warehouse/facility.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS shipping_contact_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS shipping_contact_email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS shipping_contact_phone TEXT;

-- Address line 2 (suite/unit) and a genuine secondary contact — distinct
-- from primary, AP/billing, and shipping department contacts, for when
-- the primary contact is unavailable.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS secondary_contact_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS secondary_contact_email TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS secondary_contact_phone TEXT;

-- ============================================================================
-- REAL AUTHENTICATION — closes the "no auth layer" gap that was previously
-- documented as a known limitation (DEMO_ORG_ID hardcoded, org_id trusted
-- from request params). password_hash is bcrypt, never plaintext.
-- role='operator' users have org_id NULL (internal Pascal staff, not
-- scoped to one client). role='client' users are scoped to exactly one
-- org_id and can only ever see that org's data once middleware is wired.
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT, -- NULL for operator/internal users
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('operator', 'client')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users (org_id);

-- Seed real login accounts so the deployed app isn't immediately locked
-- out with zero users once auth is required. Password for BOTH accounts
-- below is "PascalTest2026!" — a temporary, testing-only shared secret.
-- Change this the moment a real client is onboarded (there's a real
-- POST /api/auth/change-password endpoint for this).
INSERT INTO users (org_id, email, password_hash, display_name, role)
VALUES (NULL, 'operator@pascallogistics.com', '$2b$10$Hvj1xKyh3tFJ.fQnu8n75OvXYjtvt1yf5vQHZGsQAWKU046aIrxs.', 'Roger Jervis', 'operator')
ON CONFLICT (email) DO NOTHING;

INSERT INTO users (org_id, email, password_hash, display_name, role)
VALUES ('org_meridian', 'client@meridiancoldchain.com', '$2b$10$Hvj1xKyh3tFJ.fQnu8n75OvXYjtvt1yf5vQHZGsQAWKU046aIrxs.', 'Alicia Ford', 'client')
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- CLIENT CARRIER RATES ON FILE — per-client, per-lane incumbent carrier
-- rates for the Priority1 quote comparison feature. Not a foreign key to
-- accounts (org_id) because rates are a lane×carrier fact keyed to a
-- tenant, not a client "profile" attribute — and adding a full FK would
-- couple this to accounts row lifecycle in ways that hurt rate history.
-- Kept as a plain org_id TEXT scope, same pattern the rest of the schema
-- uses. rate_source lets us tell "manual entry" apart from
-- "extracted-from-invoice" (Document Vault) later.
-- ============================================================================
CREATE TABLE IF NOT EXISTS client_carrier_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  origin_zip VARCHAR(10) NOT NULL,
  destination_zip VARCHAR(10) NOT NULL,
  carrier_name TEXT NOT NULL,
  service_level TEXT,
  transit_days INT,
  total_rate_usd NUMERIC(10,2) NOT NULL,
  rate_source TEXT NOT NULL DEFAULT 'manual',
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_carrier_rates_org_id ON client_carrier_rates (org_id);
CREATE INDEX IF NOT EXISTS idx_client_carrier_rates_lane ON client_carrier_rates (org_id, origin_zip, destination_zip);

-- ============================================================================
-- CLIENT CAPABILITIES — per-account feature flags derived from the client's
-- shipping profile. Populated at onboarding, editable later. Domestic-only
-- clients don't get tariff monitoring / USMCA panels etc. surfaced in
-- their portal — those features are enabled only for cross-border profiles.
-- JSONB (not a set of boolean columns) because the profile evolves and
-- fields like trackedHsCodes are variable-length arrays. Default '{}' so
-- an existing account without a profile just gets nothing extra rendered.
-- ============================================================================
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS client_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_accounts_capabilities_gin ON accounts USING GIN (client_capabilities);

-- ============================================================================
-- BOOKING REQUESTS — client-initiated intent to book a specific carrier
-- from a Spot Rate Explorer comparison. Not an actual booking; the
-- operator confirms carrier capacity, PARS/PAPS readiness, DG, and
-- everything else before the load dispatches. status: 'pending' (client
-- clicked Request), 'accepted' (operator confirmed and booked), 'declined'
-- (operator can't fulfill), 'expired' (stale).
-- ============================================================================
CREATE TABLE IF NOT EXISTS booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  requested_by_email TEXT,
  carrier_name TEXT NOT NULL,
  service_level TEXT,
  mode TEXT NOT NULL DEFAULT 'LTL' CHECK (mode IN ('LTL', 'FTL')),
  origin_zip VARCHAR(10) NOT NULL,
  destination_zip VARCHAR(10) NOT NULL,
  pickup_date_iso TIMESTAMPTZ NOT NULL,
  total_usd NUMERIC(10,2) NOT NULL,
  transit_days INT,
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  operator_notes TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_requests_org_status ON booking_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_requests_status_created ON booking_requests (status, created_at DESC);

-- ============================================================================
-- TARIFF UPDATES — the source of truth for the tariff-monitoring service.
-- Rows are produced by a cron that polls the Federal Register, USITC HTS
-- API, and CBSA D-Memoranda, then uses Claude to summarize each policy
-- action in plain English + tag it with the affected HS code(s), direction
-- (US↔CA), and mechanism (Section 232 / 301 / USMCA / CBSA D-Memo / etc.).
-- Client Portal filters this table by the client's tracked_hs_codes
-- capability so a bedliner importer doesn't see steel policy notices.
--
-- Demo seed rows below are illustrative — they read as realistic policy
-- actions but are not automatically kept current until the poll cron is
-- wired up. ON CONFLICT DO NOTHING makes the seed idempotent across
-- deploys.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tariff_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref TEXT UNIQUE,
  hs_code TEXT NOT NULL,
  hs_description TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('US_TO_CA', 'CA_TO_US', 'US_INBOUND', 'CA_INBOUND', 'BILATERAL')),
  mechanism TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  old_rate NUMERIC(6,2),
  new_rate NUMERIC(6,2),
  rate_delta_pct NUMERIC(6,2),
  effective_date DATE,
  source_url TEXT,
  severity TEXT NOT NULL DEFAULT 'notice' CHECK (severity IN ('critical', 'notice', 'info')),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tariff_updates_hs ON tariff_updates (hs_code);
CREATE INDEX IF NOT EXISTS idx_tariff_updates_published ON tariff_updates (published_at DESC);

INSERT INTO tariff_updates (external_ref, hs_code, hs_description, direction, mechanism, headline, summary, old_rate, new_rate, rate_delta_pct, effective_date, source_url, severity, published_at)
VALUES
  ('SEED-232-STEEL-7208', '7208.10', 'Hot-rolled steel, in coils', 'CA_TO_US', 'Section 232', 'Section 232: HS 7208.10 assessed at 25% on Canadian-origin steel', 'USTR modifies the Section 232 derivative-steel list; hot-rolled coils entering the US from Canada now assessed at 25% ad valorem regardless of USMCA origin. Prior exemption withdrawn for material entered after the effective date.', 0.0, 25.0, 25.0, CURRENT_DATE + INTERVAL '2 days', 'https://www.federalregister.gov/', 'critical', now() - INTERVAL '18 hours'),
  ('SEED-301-TEXTILE-6302', '6302.32', 'Bed linens, man-made fibres', 'US_INBOUND', 'Section 301', 'CBP ruling: Chinese-origin textiles finished in Canada do not confer substantial transformation', 'CBP Ruling HQ H329844 confirms that cut-and-sew of Chinese-origin bed linens in Canada is insufficient for substantial transformation under 19 CFR 102.21. Section 301 rate of 27.5% now applies at US entry.', 12.5, 27.5, 15.0, CURRENT_DATE - INTERVAL '3 days', 'https://rulings.cbp.gov/', 'critical', now() - INTERVAL '2 days'),
  ('SEED-CBSA-D11-VALUATION', '9999.99', 'All commodities', 'US_TO_CA', 'CBSA D-Memo', 'CBSA D11-4-2 amendment: revised valuation guidance for related-party transactions', 'CBSA has published D-Memo amendments to D11-4-2 clarifying transfer-pricing adjustments as post-importation changes to declared value. Applies to entries filed on or after the effective date.', NULL, NULL, NULL, CURRENT_DATE + INTERVAL '7 days', 'https://www.cbsa-asfc.gc.ca/', 'notice', now() - INTERVAL '4 days'),
  ('SEED-USMCA-AUTO-8703', '8703.23', 'Passenger vehicles, 1500–3000cc engine', 'BILATERAL', 'USMCA', 'USMCA rules-of-origin: annual RVC threshold advances to 75%', 'The regional value content requirement for passenger vehicles under USMCA advances to 75% on the scheduled step-up date. Vehicles not meeting the new threshold lose preferential treatment and revert to MFN rates.', 0.0, 2.5, 2.5, CURRENT_DATE + INTERVAL '90 days', 'https://ustr.gov/usmca', 'notice', now() - INTERVAL '5 days'),
  ('SEED-321-DEMINIMIS-REVIEW', '9999.99', 'De minimis shipments', 'US_INBOUND', 'Section 321', 'USTR proposes further tightening of Section 321 de minimis for Chinese-origin goods', 'Notice of proposed rulemaking further narrows the Section 321 $800 de minimis window for goods of Chinese origin regardless of routing. Comments open for 30 days. Not yet in force.', NULL, NULL, NULL, NULL, 'https://ustr.gov/', 'info', now() - INTERVAL '7 days'),
  ('SEED-BEEF-0201-QUOTA', '0201.20', 'Beef, boneless, chilled', 'CA_TO_US', 'TRQ', 'US TRQ on Canadian beef: quarterly quota 68% filled', 'Quarter-to-date fill on the tariff-rate quota for Canadian-origin boneless beef stands at 68%. Over-quota rate remains 26.4%. Historical patterns suggest quota exhaustion around week 11.', 0.0, 0.0, NULL, CURRENT_DATE - INTERVAL '1 day', 'https://www.usitc.gov/tata/hts', 'info', now() - INTERVAL '8 days')
ON CONFLICT (external_ref) DO NOTHING;

-- ============================================================================
-- AGENT REGISTRY + DRAFT INBOX — the backbone for Agents 6–11 (back-office
-- AI staff). Every agent registers here with a status and last-run signal
-- so the operator has one page that says "what's my AI staff doing right
-- now, and what's waiting on my sign-off." Client-facing agents 1–5 are
-- also registered for completeness — they can share the observability
-- surface without changing their existing wiring.
--
-- agent_drafts is the human-in-the-loop review queue. Every external
-- action an agent proposes (email response, invoice categorization,
-- LinkedIn post, contract renewal alert acknowledgement, etc.) is
-- persisted as a draft. Roger reviews and either sends, edits, or
-- rejects. Nothing goes out without approval.
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key TEXT UNIQUE NOT NULL,
  agent_number INT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'planned', 'paused', 'deprecated')),
  human_in_loop BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_status ON agent_registry (status);

CREATE TABLE IF NOT EXISTS agent_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key TEXT NOT NULL REFERENCES agent_registry (agent_key) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  category TEXT,
  subject TEXT,
  source_ref TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent', 'archived')),
  operator_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewer_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_drafts_status_created ON agent_drafts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_drafts_agent ON agent_drafts (agent_key, status);

-- Seed the eleven agents. ON CONFLICT keeps this idempotent so Roger's
-- config on any agent (e.g., PAUSED while wiring Gmail) survives re-deploy.
INSERT INTO agent_registry (agent_key, agent_number, name, role, description, status, human_in_loop) VALUES
  ('agent1_sanitizer',        1, 'Sanitizer',                  'Client-facing',    'Reads incoming PDFs, emails, and phone-call transcripts; extracts structured shipment data.',                     'active',  TRUE),
  ('agent2_compliance',       2, 'Compliance',                 'Client-facing',    'Flags HS classification, valuation, and rules-of-origin issues before entry; monitors tariff changes.',            'active',  TRUE),
  ('agent3_rate_optimization',3, 'Rate Optimization',          'Client-facing',    'Audits carrier invoices; benchmarks vs spot market; identifies overcharges and refund opportunities.',            'active',  TRUE),
  ('agent4_equipment',        4, 'Equipment',                  'Client-facing',    'Matches loads to trailer type, mode, DG requirements; flags equipment gaps.',                                     'active',  TRUE),
  ('agent5_client_chat',      5, 'Client Chat',                'Client-facing',    'Portal chat for client questions; escalates complex issues to the operator.',                                     'active',  TRUE),
  ('agent6_chief_of_staff',   6, 'Chief of Staff',             'Back-office',      'Inbox triage, calendar coordination, task follow-through, morning brief for Roger.',                              'active',  TRUE),
  ('agent7_executive_assist', 7, 'Executive Assistant',        'Back-office',      'Scheduling, meeting preparation, follow-up drafting.',                                                             'planned', TRUE),
  ('agent8_finance',          8, 'Finance Operator',           'Back-office',      'Stripe/QuickBooks reconciliation, expense categorization, monthly P&L drafting.',                                  'planned', TRUE),
  ('agent9_marketing',        9, 'Marketing Operator',         'Back-office',      'Weekly newsletter drafts, LinkedIn post drafts, cold-outreach drafts personalized per prospect.',                  'planned', TRUE),
  ('agent10_legal_watcher',  10, 'Legal & Compliance Watcher', 'Back-office',      'Contract renewal alerts, insurance expiries, regulatory deadlines, POA renewals, DG cert renewals.',               'planned', TRUE),
  ('agent11_hr',             11, 'HR & Onboarding',            'Back-office',      'Draft offer letters, employee onboarding checklists, policy responses. Deferred until first hire.',                'planned', TRUE)
ON CONFLICT (agent_key) DO NOTHING;

-- Four additional client-facing agents. Insertion order in the freight flow:
--   Equipment → Carrier Vetting → Booking → Customs → Customer Service → Claims
-- agent_key names stay stable (creation-order) so existing draft rows stay
-- linked to their agent. Display order is driven entirely by agent_number.
-- Slot 13 is intentionally never reused (Roger's preference — 15 total).
INSERT INTO agent_registry (agent_key, agent_number, name, role, description, status, human_in_loop) VALUES
  ('agent12_booking_dispatch', 6, 'Booking & Dispatch', 'Client-facing', 'Tenders load to selected carrier, confirms pickup, polls in-transit milestones, flags exceptions, closes out POD.', 'active', TRUE),
  ('agent13_customs_liaison',  7, 'Customs Liaison',    'Client-facing', 'Coordinates with client''s broker of record (we do not file entries). Confirms doc packet, tracks entry status, flags holds/exams, confirms release.', 'active', TRUE),
  ('agent14_carrier_vetting',  5, 'Carrier Vetting & Compliance', 'Client-facing', 'Verifies MC/DOT active, cargo + auto-liability insurance current, SMS BASIC safety scores, W9 on file. Monthly re-verification, insurance-lapse alerts. Blocks tenders to red-flagged carriers until operator override.', 'active', TRUE),
  ('agent15_claims_osd',       9, 'Claims & OS&D',      'Client-facing', 'Overage / shortage / damage claim intake, valuation, drafting to carrier, follow-through to resolution. Chases past-due claims automatically. Takes warm handoff from Customer Service.', 'active', TRUE)
ON CONFLICT (agent_key) DO NOTHING;

-- Renumber so display order reflects the actual freight flow:
--   Sanitizer → Compliance → Rate → Equipment → Carrier Vetting → Booking →
--   Customs → Customer Service → Claims → Chief of Staff → EA → Finance →
--   Marketing → Legal → HR
-- Idempotent — WHERE-guarded to be a no-op if already correct.
UPDATE agent_registry SET agent_number = 8,  updated_at = now() WHERE agent_key = 'agent5_client_chat'      AND agent_number <> 8;

-- Agent 5 was seeded as "Client Chat" — expand scope to full Customer Service:
-- WISMO deflection, proactive exception notification, order modifications /
-- accessorial coordination, sentiment triage + warm human escalation. Sits
-- downstream of Agent 5 Booking & Dispatch and Agent 6 Customs Liaison and
-- is the client-facing voice for both.
UPDATE agent_registry
   SET name = 'Customer Service',
       description = 'Client-facing coordinator across email / portal / SMS. WISMO tracking + doc retrieval (POD, invoices, clearances), proactive delay alerts with revised ETAs, in-flight order changes / accessorials, sentiment scoring, warm escalation to Roger for OS&D / claims / rate disputes.',
       updated_at = now()
 WHERE agent_key = 'agent5_client_chat'
   AND name <> 'Customer Service';
UPDATE agent_registry SET agent_number = 10, updated_at = now() WHERE agent_key = 'agent6_chief_of_staff'   AND agent_number <> 10;
UPDATE agent_registry SET agent_number = 11, updated_at = now() WHERE agent_key = 'agent7_executive_assist' AND agent_number <> 11;
UPDATE agent_registry SET agent_number = 12, updated_at = now() WHERE agent_key = 'agent8_finance'          AND agent_number <> 12;
UPDATE agent_registry SET agent_number = 13, updated_at = now() WHERE agent_key = 'agent9_marketing'        AND agent_number <> 13;

-- Promote Finance and Marketing to active so retainer invoicing and
-- prospect outreach can start on day 1. Marketing description expands
-- to include cold outreach + newsletter + LinkedIn draft output;
-- Finance description expands to include Stripe / QuickBooks
-- reconciliation and past-due chase drafts.
UPDATE agent_registry
   SET status = 'active',
       description = 'Stripe + QuickBooks reconciliation, retainer + one-off invoice drafting, payment confirmation replies, past-due chase drafts (30/60/90 day cadence), monthly P&L snapshot for Roger.',
       updated_at = now()
 WHERE agent_key = 'agent8_finance'
   AND status <> 'active';

UPDATE agent_registry
   SET status = 'active',
       description = 'Weekly newsletter drafts (tariff moves + border cams + client wins), LinkedIn post drafts, personalized cold-outreach drafts per prospect (industry, freight volume, current pain), lightweight SEO angle suggestions. Roger reviews every send.',
       updated_at = now()
 WHERE agent_key = 'agent9_marketing'
   AND status <> 'active';

-- Promote Executive Assistant to active — client onboarding (scheduling,
-- kickoff, POA/W9 chase) and meeting prep both hit day 1 as prospects reach
-- out through the site + phone.
UPDATE agent_registry
   SET status = 'active',
       description = 'Scheduling, onboarding coordination (POA / W9 / kickoff / first shipment), meeting prep briefs for Roger, post-call recap drafts. Sits between Chief of Staff (inbox triage) and Customer Service (operational contact).',
       updated_at = now()
 WHERE agent_key = 'agent7_executive_assist'
   AND status <> 'active';
UPDATE agent_registry SET agent_number = 14, updated_at = now() WHERE agent_key = 'agent10_legal_watcher'   AND agent_number <> 14;
UPDATE agent_registry SET agent_number = 15, updated_at = now() WHERE agent_key = 'agent11_hr'              AND agent_number <> 15;


-- ============================================================================
-- AGENT ORCHESTRATION — cross-agent task handoffs
-- Every multi-step workflow (Customs finds missing USMCA → Customer Service
-- drafts client outreach → Finance flags entry-cost impact) lives in
-- agent_tasks with a trail JSONB documenting each handoff. Roger reviews at
-- named human-gate points; agents relay to each other autonomously between
-- gates. Nothing outbound crosses a gate without operator sign-off.
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'awaiting_review', 'handed_off', 'completed', 'rejected', 'blocked')),
  origin_agent_key TEXT NOT NULL REFERENCES agent_registry (agent_key) ON DELETE CASCADE,
  current_agent_key TEXT NOT NULL REFERENCES agent_registry (agent_key) ON DELETE CASCADE,
  client_org_id TEXT,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL,
  trail JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_gate_reason TEXT,
  linked_draft_id UUID REFERENCES agent_drafts (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_current ON agent_tasks (current_agent_key, status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_client ON agent_tasks (client_org_id, updated_at DESC);

-- ============================================================================
-- TIER 3 SUPPLY CHAIN MANAGER — per-client knowledge base + ERP integration
-- Every Tier 3 client gets a persistent Knowledge Base pinned into every
-- agent prompt (their SKUs, suppliers, lanes, terms, escalation ladder),
-- an ERP connection (NetSuite / QB / Dynamics / Sage / Oracle — demo mode
-- available so we can sell the tier before we buy the API licenses), KPI
-- targets they set with their team, and daily KPI snapshots we roll up so
-- the Friday exec pack has real data to compose from.
-- ============================================================================

-- Knowledge Base — the deep client knowledge an SCM would carry in their head
-- after 6 months on the job. Held as JSONB so it can grow without schema churn.
CREATE TABLE IF NOT EXISTS client_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL UNIQUE REFERENCES accounts (org_id) ON DELETE CASCADE,
  -- Structured JSONB with keys:
  --   skus:         [{ sku, description, uom, weight_lb, dims_in, hs_code, coo, safety_stock_units, moq, lead_time_days }]
  --   suppliers:    [{ name, country, terms, otif_target_pct, contact_name, contact_email, notes }]
  --   lanes:        [{ origin, destination, mode, typical_carrier, typical_transit_days, notes }]
  --   customers:    [{ name, priority_tier, otif_target_pct, sla_notes }]
  --   escalation:   [{ level, name, role, phone, email, when_to_call }]
  --   seasonality:  [{ pattern, months, notes }]
  --   erp_notes:    freeform text — anything specific to this client's ERP quirks
  knowledge JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_kb_org ON client_knowledge_base (org_id);

-- KPI targets the client's leadership sets with us. We benchmark against these
-- and flag drift on the weekly exec pack.
CREATE TABLE IF NOT EXISTS client_kpi_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL UNIQUE REFERENCES accounts (org_id) ON DELETE CASCADE,
  -- Executive-visible (weekly)
  otif_target_pct NUMERIC(5,2),           -- 95.00 = 95% OTIF
  perfect_order_target_pct NUMERIC(5,2),
  freight_to_revenue_target_pct NUMERIC(5,2),
  cash_to_cash_target_days INT,
  inventory_turns_target NUMERIC(5,2),
  -- Operational (daily)
  order_fill_rate_target_pct NUMERIC(5,2),
  supplier_otif_target_pct NUMERIC(5,2),
  damage_rate_target_pct NUMERIC(5,2),
  -- Analytical (quarterly)
  forecast_accuracy_mape_target_pct NUMERIC(5,2), -- lower is better
  dead_stock_target_pct NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Daily KPI snapshots — one row per client per day. Rolled up from ERP pull
-- + our own agent activity data.
CREATE TABLE IF NOT EXISTS client_kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  otif_pct NUMERIC(5,2),
  perfect_order_pct NUMERIC(5,2),
  freight_to_revenue_pct NUMERIC(5,2),
  cash_to_cash_days INT,
  inventory_turns NUMERIC(5,2),
  order_fill_rate_pct NUMERIC(5,2),
  supplier_otif_pct NUMERIC(5,2),
  damage_rate_pct NUMERIC(5,2),
  forecast_accuracy_mape_pct NUMERIC(5,2),
  dead_stock_pct NUMERIC(5,2),
  -- Raw counts underlying the KPIs — kept so we can drill in
  orders_total INT DEFAULT 0,
  orders_shipped_ontime INT DEFAULT 0,
  orders_shipped_infull INT DEFAULT 0,
  orders_damaged INT DEFAULT 0,
  freight_cost_usd NUMERIC(12,2),
  revenue_usd NUMERIC(12,2),
  inventory_value_usd NUMERIC(12,2),
  source TEXT NOT NULL DEFAULT 'demo' CHECK (source IN ('demo', 'erp_pull', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_client_kpi_snapshots_org_date ON client_kpi_snapshots (org_id, snapshot_date DESC);

-- ERP connection registry — per client, one active connection (they usually
-- run one ERP). Credentials stay OUT of the DB; only the pointer + status +
-- config live here. Actual OAuth tokens / API keys hold in secrets manager.
CREATE TABLE IF NOT EXISTS erp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL UNIQUE REFERENCES accounts (org_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('netsuite', 'quickbooks_online', 'quickbooks_desktop', 'dynamics_365', 'sage_intacct', 'sage_x3', 'oracle_fusion', 'sap_s4hana', 'sap_ecc', 'odoo', 'demo')),
  connection_status TEXT NOT NULL DEFAULT 'demo' CHECK (connection_status IN ('demo', 'not_connected', 'pending_auth', 'connected', 'error', 'suspended')),
  demo_mode BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_error TEXT,
  -- Provider-specific config (account ID, subsidiary, realm ID, tenant, base URL, etc.)
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_connections_org ON erp_connections (org_id);
CREATE INDEX IF NOT EXISTS idx_erp_connections_status ON erp_connections (connection_status);

-- Promote Legal Watcher (Agent 14, key agent10_legal_watcher) and HR &
-- Onboarding (Agent 15, key agent11_hr) to active. All 15 agents are now
-- live on day 1. Legal Watcher covers insurance / POA / USMCA / DG cert /
-- customs bond / W9 / contract / license / retainer term / regulatory
-- deadlines with per-category lead-time bands. HR covers offer letters,
-- contractor agreements, onboarding + offboarding, benefits, policy
-- questions, performance notes, reference requests — jurisdiction-aware
-- (WA / BC default), never quotes binding comp without Roger.
UPDATE agent_registry
   SET status = 'active',
       description = 'Watches every time-boxed obligation Pascal or its clients hold — insurance, POA, USMCA blanket, DG cert, customs bond, W9, contracts, business license, retainer term, regulatory deadlines. Drafts renewal reminders at the right lead time.',
       updated_at = now()
 WHERE agent_key = 'agent10_legal_watcher'
   AND status <> 'active';

UPDATE agent_registry
   SET status = 'active',
       description = 'Offer letters, contractor agreements, onboarding + offboarding checklists, benefits explainers, policy responses, performance notes. Jurisdiction-aware (WA + BC default). Flags anything needing employment counsel review; never quotes binding comp numbers without Roger.',
       updated_at = now()
 WHERE agent_key = 'agent11_hr'
   AND status <> 'active';

-- ============================================================================
-- OCEAN + AIR TRACKING — subscribe once, receive milestones forever
-- We subscribe to an aggregator (Terminal49 for ocean, CargoAi for air) with
-- a container / MAWB / HAWB number. The aggregator webhooks milestone events
-- as they land — booking confirmed, gated in, loaded, sailed, discharged,
-- rolled, in transit, held, released, gated out, delivered. Everything gets
-- appended to shipment_milestones. Demo adapter ships realistic events off
-- a seeded RNG so we can demo the whole client-portal timeline before wiring
-- live credentials.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tracking_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('ocean', 'air')),
  provider TEXT NOT NULL CHECK (provider IN ('terminal49', 'cargoai', 'demo')),
  tracking_number TEXT NOT NULL,       -- container # / MAWB / booking #
  carrier_scac_or_iata TEXT,            -- MSCU / MAEU / SUDU / MAERSK; IATA prefix like 020 (LH), 176 (EK)
  bill_of_lading TEXT,
  booking_number TEXT,
  reference TEXT,                       -- client's PO # or internal ref
  origin TEXT,
  destination TEXT,
  status TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'demo', 'completed', 'error', 'cancelled')),
  demo_mode BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, mode, tracking_number)
);

CREATE INDEX IF NOT EXISTS idx_tracking_sub_org ON tracking_subscriptions (org_id, mode, status);

CREATE TABLE IF NOT EXISTS shipment_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES tracking_subscriptions (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,             -- booking_confirmed / gate_in / loaded / sailed / discharged / gated_out / delivered / exception / hold / rolled / released / in_transit / arrived
  event_code TEXT,                       -- carrier's raw code (CIC / DPC / VDF ...)
  location TEXT,                         -- port name or airport IATA
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  occurred_at TIMESTAMPTZ NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_exception BOOLEAN NOT NULL DEFAULT FALSE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'demo' CHECK (source IN ('demo', 'terminal49_webhook', 'terminal49_pull', 'cargoai_webhook', 'cargoai_pull', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_sub ON shipment_milestones (subscription_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestones_exception ON shipment_milestones (is_exception, reported_at DESC);

-- Playbook continuation — remember which step to resume from when a task
-- lands in awaiting_review and Roger clears the gate.
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS next_step_index INT;

-- ============================================================================
-- SPRINT 2 — client-experience gaps
-- Branding: per-client accent color + optional logo URL for the exec dashboard
-- so the CFO sees THEIR brand on the report, not ours.
-- Notification prefs: opt-in per email channel (daily brief, weekly exec
-- pack, exception alerts). Clients that opt in get real email when Roger
-- clicks send OR when the review-queue auto-sends.
-- Onboarding: client-facing checklist so their day-1 experience is guided,
-- not "here's a portal, figure it out".
-- ============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_color TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS client_onboarding_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,               -- 'poa_us' | 'poa_ca' | 'w9' | 'kickoff' | 'stripe' | 'first_shipment' | 'portal_walkthrough' | 'brokers_confirmed'
  step_label TEXT NOT NULL,             -- human-readable label the client sees
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'not_applicable')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  ordered_position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_client_onboarding_org ON client_onboarding_steps (org_id, ordered_position);

-- ============================================================================
-- SPRINT 4 — enterprise-ready gaps
-- Multi-user access per client account, prospect pipeline, SMS
-- approve-reject tokens, calendar integration, Google SSO plumbing.
-- ============================================================================

-- Extend users with:
--   client_sub_role — owner / ops / finance / viewer for client-side users
--   google_id — for Google SSO sign-in (nullable — password path still works)
--   invited_by / accepted_at — audit trail on multi-user invites
--   last_login_at — activity signal for the account owner
ALTER TABLE users ADD COLUMN IF NOT EXISTS client_sub_role TEXT
  CHECK (client_sub_role IN ('owner', 'ops', 'finance', 'viewer'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id);
CREATE INDEX IF NOT EXISTS idx_users_org_role ON users (org_id, client_sub_role);

-- Pending invites — email sent, user hasn't accepted yet. Token is a URL-safe
-- opaque string in the accept link the invitee clicks.
CREATE TABLE IF NOT EXISTS client_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_sub_role TEXT NOT NULL CHECK (invited_sub_role IN ('owner', 'ops', 'finance', 'viewer')),
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_client_invites_org ON client_invites (org_id, status);
CREATE INDEX IF NOT EXISTS idx_client_invites_token ON client_invites (token);

-- Prospect pipeline — every prospect Marketing produces cold-email drafts
-- for lands here. Six-stage kanban board.
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_role TEXT,
  industry TEXT,
  freight_volume_monthly INT,
  current_3pl_or_broker TEXT,
  pain_signal TEXT,
  source TEXT,                          -- how we found them
  stage TEXT NOT NULL DEFAULT 'contacted' CHECK (stage IN ('contacted', 'replied', 'meeting_booked', 'proposal_sent', 'signed', 'lost')),
  next_action TEXT,
  next_action_at TIMESTAMPTZ,
  notes TEXT,
  converted_org_id TEXT REFERENCES accounts (org_id) ON DELETE SET NULL,
  lost_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects (stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_next_action ON prospects (next_action_at) WHERE next_action_at IS NOT NULL;

-- SMS approve-reject tokens. When a gate lands and Roger gets SMS'd, we
-- generate a 4-digit short code. Roger replies "YES 4271" or "NO 4271" and
-- our webhook resolves the token → applies the action to the linked draft
-- or task. Tokens expire in 24 hours; used tokens can't be replayed.
CREATE TABLE IF NOT EXISTS notification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code TEXT NOT NULL UNIQUE,      -- 4-digit numeric, e.g. '4271'
  target_type TEXT NOT NULL CHECK (target_type IN ('draft', 'task')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
  used_at TIMESTAMPTZ,
  used_action TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_tokens_code ON notification_tokens (short_code) WHERE used_at IS NULL;

-- Google Calendar OAuth tokens — one row per operator (Roger). Refresh
-- token stored so we can re-issue access tokens without asking again.
CREATE TABLE IF NOT EXISTS google_calendar_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  scope TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, google_email)
);

-- ============================================================================
-- THREE NEW PERSONA AGENTS
--   16 Marcus Vance      — Sales Consultant (middle-of-funnel)
--   17 Frank Reynolds    — Fractional VP of Supply Chain (Tier 3 anchor)
--   18 Elena Rostova     — Director of Operations (Roger's second-in-command)
-- Seed as active. Human-in-the-loop remains TRUE for all three — nothing
-- outbound goes without Roger's (or Elena's, when delegation is on) sign-off.
-- ============================================================================
INSERT INTO agent_registry (agent_key, agent_number, name, role, description, status, human_in_loop) VALUES
  ('agent16_sales_marcus',   16, 'Marcus Vance — Sales Consultant',   'Client-facing',
    'Middle-of-funnel sales conversation. Runs discovery on prospect replies, drafts objection responses in dock-level operator language, produces freight-leakage ROI estimates, nurtures the middle of the pipeline between Marketing outbound and EA scheduling.',
    'active', TRUE),
  ('agent17_scm_frank',      17, 'Frank Reynolds — Fractional VP Supply Chain', 'Client-facing',
    'Executive voice for Tier 3 clients. Authors weekly exec packs, S&OP structures, carrier-dispute rebuttal letters ($1k+), vendor routing guides, and root-cause analyses. Fires on strategic + financial questions where operator-level agents are the wrong altitude.',
    'active', TRUE),
  ('agent18_ops_elena',      18, 'Elena Rostova — Director of Operations', 'Back-office',
    'Roger''s operational second-in-command. Pre-reviews the human-in-the-loop queues, resolves within tolerance ($500 / routine patterns), escalates only what needs Roger. Cross-agent supervisor: catches downstream failures before they cascade.',
    'active', TRUE)
ON CONFLICT (agent_key) DO NOTHING;

-- Elena delegation setting — global (Roger-level). When 'elena_active',
-- gate notifications route through Elena first; she escalates to Roger on
-- her tolerance rules. Default is FALSE (Roger receives directly).
CREATE TABLE IF NOT EXISTS operator_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO operator_settings (key, value)
  VALUES ('delegation', '{"enabled": false, "delegate_agent_key": "agent18_ops_elena"}'::jsonb)
  ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- THREE HEADLESS UTILITY AGENTS — no personas, pure function
--   19 ROI Reporter          — monthly retainer-defense value narrative
--   20 AP Settlement         — carrier invoice reconciliation + voucher batch
--   21 ERP Ingestion Bridge  — webhook / poll layer feeding downstream agents
-- Signed as "Pascal Logistics Control Tower" to clients when they surface at
-- all; usually they run silently and feed the persona agents.
-- ============================================================================
INSERT INTO agent_registry (agent_key, agent_number, name, role, description, status, human_in_loop) VALUES
  ('agent19_roi_reporter',    19, 'ROI Reporter',      'Back-office',
    'Monthly retainer-defense value tally: aggregates avoided costs (rate audit wins, USMCA saves, claim recoveries, renewals-caught-in-time), packages a client-facing ROI narrative delivered through Chief of Staff or Frank depending on retainer tier.',
    'active', TRUE),
  ('agent20_ap_settlement',   20, 'AP Freight Settlement', 'Back-office',
    'Reconciles carrier invoices against original tender + BOL, generates clean voucher batches (QB / NetSuite / Dynamics), drafts dispute notices for unauthorized detention / fuel / accessorial charges. Headless utility signed as Pascal Logistics AP.',
    'active', TRUE),
  ('agent21_erp_bridge',      21, 'ERP Ingestion Bridge', 'Back-office',
    'Receives client ERP webhooks / runs scheduled polls, normalizes shipment + PO + SO data, hands to Sanitizer + downstream agents. Headless system automation; never surfaces personality.',
    'active', TRUE)
ON CONFLICT (agent_key) DO NOTHING;

-- ROI tally rollup table — every avoided cost across the platform gets
-- appended here so the reporter can pull a clean month-over-month narrative.
CREATE TABLE IF NOT EXISTS roi_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  source_agent_key TEXT NOT NULL,
  credit_type TEXT NOT NULL,   -- rate_audit_savings | claim_recovery | usmca_saved | renewal_caught | dispute_won | hours_saved | ...
  headline TEXT NOT NULL,
  dollar_value_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  hours_saved_value_usd NUMERIC(12,2),
  linked_draft_id UUID REFERENCES agent_drafts (id) ON DELETE SET NULL,
  linked_task_id UUID REFERENCES agent_tasks (id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_in_month DATE          -- populated when this credit lands in a monthly ROI report
);

CREATE INDEX IF NOT EXISTS idx_roi_credits_org_captured ON roi_credits (org_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_roi_credits_unreported ON roi_credits (org_id) WHERE reported_in_month IS NULL;

-- Freight AP settlement — carrier invoices we reconcile against tender.
CREATE TABLE IF NOT EXISTS carrier_invoice_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  carrier_name TEXT NOT NULL,
  carrier_invoice_number TEXT NOT NULL,
  shipment_ref TEXT,
  tender_amount_usd NUMERIC(12,2),
  invoiced_amount_usd NUMERIC(12,2) NOT NULL,
  variance_usd NUMERIC(12,2) GENERATED ALWAYS AS (invoiced_amount_usd - COALESCE(tender_amount_usd, 0)) STORED,
  disputed_line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved_for_pay', 'disputed', 'paid', 'refunded')),
  voucher_batch_ref TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, carrier_name, carrier_invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_carrier_settlements_org_status ON carrier_invoice_settlements (org_id, status);

-- ERP webhook ingestion log — every inbound event, dedup by external_ref.
CREATE TABLE IF NOT EXISTS erp_ingestion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,     -- netsuite | quickbooks_online | dynamics_365 | sap_s4hana | odoo | ...
  event_type TEXT NOT NULL,   -- po_created | so_shipped | inventory_adjusted | ...
  external_ref TEXT NOT NULL, -- provider-native ID
  raw_payload JSONB NOT NULL,
  normalized_payload JSONB,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'normalized', 'routed', 'error')),
  processed_at TIMESTAMPTZ,
  error_detail TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider, external_ref, event_type)
);

CREATE INDEX IF NOT EXISTS idx_erp_events_org_status ON erp_ingestion_events (org_id, processing_status, received_at DESC);

-- ============================================================================
-- LAND-FREIGHT TRACKING — LTL / TL / Rail intermodal
-- Extend tracking_subscriptions to cover the modes that are the bulk of
-- SMB freight. Same schema shape as ocean + air; carrier-facing adapter
-- lives alongside the existing ones.
-- ============================================================================
ALTER TABLE tracking_subscriptions DROP CONSTRAINT IF EXISTS tracking_subscriptions_mode_check;
ALTER TABLE tracking_subscriptions ADD CONSTRAINT tracking_subscriptions_mode_check
  CHECK (mode IN ('ocean', 'air', 'ltl', 'tl', 'rail'));

ALTER TABLE tracking_subscriptions DROP CONSTRAINT IF EXISTS tracking_subscriptions_provider_check;
ALTER TABLE tracking_subscriptions ADD CONSTRAINT tracking_subscriptions_provider_check
  CHECK (provider IN ('terminal49', 'cargoai', 'macropoint', 'project44', 'fourkites', 'carrier_direct', 'demo'));

-- Extend shipment_milestones.source check constraint to include MacroPoint
-- (LTL/TL/rail) source labels.
ALTER TABLE shipment_milestones DROP CONSTRAINT IF EXISTS shipment_milestones_source_check;
ALTER TABLE shipment_milestones ADD CONSTRAINT shipment_milestones_source_check
  CHECK (source IN ('demo', 'terminal49_webhook', 'terminal49_pull', 'cargoai_webhook', 'cargoai_pull', 'macropoint_webhook', 'macropoint_pull', 'manual', 'unknown_webhook'));

-- ============================================================================
-- CLIENT'S BROKERS OF RECORD — separate from carriers. Each client can have
-- one US broker and one CA broker (customs brokers, not freight brokers).
-- POA is the pinch point — this is where the warehouse person needs to see
-- current status at a glance.
-- ============================================================================
CREATE TABLE IF NOT EXISTS broker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES accounts (org_id) ON DELETE CASCADE,
  broker_name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('us', 'ca', 'both')),
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  ace_filer_code TEXT,                     -- US ACE filer code
  cbsa_client_id TEXT,                     -- CBSA client identifier
  poa_status TEXT NOT NULL DEFAULT 'not_on_file' CHECK (poa_status IN ('not_on_file', 'requested', 'signed', 'expired', 'on_file')),
  poa_signed_at DATE,
  poa_expires_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, broker_name, side)
);
CREATE INDEX IF NOT EXISTS idx_broker_accounts_org ON broker_accounts (org_id, side);
CREATE INDEX IF NOT EXISTS idx_broker_accounts_poa_expiring ON broker_accounts (poa_expires_at) WHERE poa_expires_at IS NOT NULL AND poa_status = 'on_file';

-- ============================================================================
-- HTS / HS classification reference — curated commercial-chapter entries
-- with US MFN + USMCA-preferential + CA MFN + CA-USMCA rates. This is a
-- warehouse-friendly lookup, not a customs advisory tool — the compliance
-- rail says every real classification decision goes to the broker of record.
-- Populated with the 40 highest-volume 6-digit subheadings for cross-border
-- SMB shippers on the Blaine / Sumas corridor.
-- ============================================================================
CREATE TABLE IF NOT EXISTS hts_reference (
  hs_code TEXT PRIMARY KEY,                -- 2/4/6/10 digit; store the canonical length we support
  chapter TEXT NOT NULL,
  short_description TEXT NOT NULL,
  full_description TEXT,
  us_mfn_rate_pct NUMERIC(6,3),
  us_usmca_rate_pct NUMERIC(6,3),
  ca_mfn_rate_pct NUMERIC(6,3),
  ca_usmca_rate_pct NUMERIC(6,3),
  us_section_232 BOOLEAN NOT NULL DEFAULT FALSE,
  us_section_301 BOOLEAN NOT NULL DEFAULT FALSE,
  add_cvd_flag BOOLEAN NOT NULL DEFAULT FALSE,
  common_synonyms TEXT[],                  -- alternate names shippers use ("widget", "bracket", etc.)
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hts_reference_chapter ON hts_reference (chapter);
CREATE INDEX IF NOT EXISTS idx_hts_reference_prefix ON hts_reference (LEFT(hs_code, 4));
CREATE INDEX IF NOT EXISTS idx_hts_reference_synonyms ON hts_reference USING gin (common_synonyms);

-- Seed a starter reference set — the classifications SMB shippers actually ship.
-- (These are best-effort general-purpose rates for the lookup; the broker of
-- record confirms binding classification and duty on every entry.)
INSERT INTO hts_reference (hs_code, chapter, short_description, us_mfn_rate_pct, us_usmca_rate_pct, ca_mfn_rate_pct, ca_usmca_rate_pct, us_section_232, common_synonyms, notes) VALUES
  ('7326.90', '73', 'Iron or steel articles — other',                       2.9, 0.0, 6.5, 0.0, TRUE,  ARRAY['steel article','iron bracket','fabricated steel'], 'Section 232 may apply on steel-derivative articles.'),
  ('7308.90', '73', 'Structures of iron or steel',                            0.0, 0.0, 6.5, 0.0, TRUE,  ARRAY['steel structure','frame','bracket assembly'], 'Section 232 possible.'),
  ('8471.30', '84', 'Portable computers ≤ 10kg (laptops)',                    0.0, 0.0, 0.0, 0.0, FALSE, ARRAY['laptop','notebook computer'], NULL),
  ('8471.41', '84', 'Data-processing machines with CPU+I/O in same housing',  0.0, 0.0, 0.0, 0.0, FALSE, ARRAY['desktop pc','all-in-one'], NULL),
  ('8443.31', '84', 'Multifunction printers/scanners/copiers',                0.0, 0.0, 0.0, 0.0, FALSE, ARRAY['printer','copier','mfp'], NULL),
  ('8481.80', '84', 'Taps, cocks, valves — other',                            2.0, 0.0, 0.0, 0.0, FALSE, ARRAY['valve','tap','cock'], NULL),
  ('8483.30', '84', 'Bearing housings and plain shaft bearings',              4.5, 0.0, 6.5, 0.0, FALSE, ARRAY['bearing housing','shaft bearing'], NULL),
  ('8501.32', '85', 'DC motors 750W-75kW',                                    2.4, 0.0, 6.0, 0.0, FALSE, ARRAY['dc motor','electric motor'], NULL),
  ('8504.40', '85', 'Static converters (rectifiers, inverters, UPS)',         1.5, 0.0, 0.0, 0.0, FALSE, ARRAY['inverter','ups','rectifier','power supply'], NULL),
  ('8517.62', '85', 'Machines for reception/transmission of data (routers)',  0.0, 0.0, 0.0, 0.0, FALSE, ARRAY['router','switch','network gear'], NULL),
  ('8536.90', '85', 'Electrical apparatus for switching — other',             2.7, 0.0, 6.0, 0.0, FALSE, ARRAY['electrical connector','terminal block'], NULL),
  ('8544.42', '85', 'Electric conductors with connectors ≤ 1000V (cables)',   2.6, 0.0, 5.5, 0.0, FALSE, ARRAY['cable assembly','wire harness'], NULL),
  ('8708.29', '87', 'Parts and accessories of motor vehicle bodies',          2.5, 0.0, 6.0, 0.0, FALSE, ARRAY['auto body part','vehicle trim'], NULL),
  ('9403.10', '94', 'Metal furniture for offices',                            0.0, 0.0, 8.0, 0.0, FALSE, ARRAY['office furniture','filing cabinet','metal desk'], NULL),
  ('9403.20', '94', 'Metal furniture — other',                                0.0, 0.0, 8.0, 0.0, FALSE, ARRAY['metal shelf','metal rack','storage furniture'], NULL),
  ('9403.60', '94', 'Wooden furniture — other',                               0.0, 0.0, 9.5, 0.0, FALSE, ARRAY['wood furniture','wooden cabinet'], NULL),
  ('3923.30', '39', 'Bottles, flasks — plastic',                              3.0, 0.0, 5.0, 0.0, FALSE, ARRAY['plastic bottle','plastic flask'], NULL),
  ('3923.90', '39', 'Plastic articles for conveyance/packing — other',        3.0, 0.0, 5.0, 0.0, FALSE, ARRAY['plastic container','plastic packaging'], NULL),
  ('4009.31', '40', 'Rubber hose, not reinforced, with fittings',             2.5, 0.0, 6.5, 0.0, FALSE, ARRAY['rubber hose','hose assembly'], NULL),
  ('4016.99', '40', 'Rubber articles — other',                                2.5, 0.0, 6.5, 0.0, FALSE, ARRAY['rubber part','rubber component'], NULL),
  ('4412.31', '44', 'Plywood, <= 6mm outer ply of tropical wood',             8.0, 0.0, 3.5, 0.0, FALSE, ARRAY['plywood','tropical plywood'], NULL)
ON CONFLICT (hs_code) DO NOTHING;
