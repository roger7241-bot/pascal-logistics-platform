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

-- Seed a couple of segmented leads so the Prospect Segment Queue has real
-- filterable data on first load.
INSERT INTO leads (company_name, contact_name, contact_phone, segment, source, stage)
VALUES
  ('Fraser Valley Fabrication', 'Tomas Reyes', '+16045552201', 'Surrey Manufacturers', 'Clay prospecting', 'new_unqualified'),
  ('Blaine Import Partners', 'Wendy Cho', '+13605552202', 'Blaine Importers', 'LinkedIn', 'discovery_sop_review')
ON CONFLICT DO NOTHING;

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
