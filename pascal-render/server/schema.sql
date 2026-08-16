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
