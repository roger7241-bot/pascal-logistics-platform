// ============================================================================
// OPERATIONAL BASELINE TYPES
// Facility directory, frequent commodities, and alert preferences captured
// during onboarding — this is what the Client Shipment Intake Wizard's
// "Smart Address Lookup" and HTS auto-suggest should draw from.
// ============================================================================

export type FacilityRole = "shipper" | "consignee" | "both";

export type FacilityCapability = "cold_storage" | "cross_dock" | "hazmat_approved" | "overhead_crane";

export interface FacilityProfile {
  id: string;
  orgId: string;
  role: FacilityRole;
  name: string;
  street: string;
  city: string;
  stateOrProvince: string;
  countryCode: string;
  postalCode: string;
  contactPhoneE164?: string;
  // Loading constraints
  dockHeight: boolean;
  driveInRamp: boolean;
  liftgateRequired: boolean;
  forkliftOnSite: boolean;
  maxTrailerLength: "53ft" | "48ft" | "straight_truck";
  // Appointment & hours
  receivingHoursStart: string; // "HH:MM"
  receivingHoursEnd: string;
  lunchBreakClosure?: string; // e.g. "12:00-13:00"
  appointmentRequired: boolean;
  pickupLeadTimeHours: number;
  // Site rules & security
  driverPPE: string[];
  twicCardRequired: boolean;
  checkInInstructions?: string;

  // --- Facility Management & Warehouse Rules Hub fields (operator-entry) ---
  dockContactName?: string;
  dockContactPhone?: string;
  receivingEmail?: string;
  breakWindow?: string; // e.g. "12:00-12:30"
  dockDoorCount?: number;
  isoContainerCapable: boolean;
  scaleOnSite: boolean;
  hardHatRequired: boolean;
  steelToeRequired: boolean;
  driverStagingNotes?: string;
  stagingMapUrl?: string;
  freeTimeMinutes: number;
  detentionRateUsdPerHour: number;
  capabilities: FacilityCapability[];
  isArchived: boolean;
  addedBy: "client_portal" | "operator";
  createdAtIso?: string;
}

/** Payload shape for POST/PATCH from the operator-side Add/Edit Facility SOP modal. */
export interface FacilityUpsertPayload {
  orgId: string;
  role?: FacilityRole;
  name: string;
  street: string;
  city: string;
  stateOrProvince?: string;
  countryCode: string;
  postalCode?: string;
  dockContactName?: string;
  dockContactPhone?: string;
  receivingEmail?: string;
  receivingHoursStart?: string;
  receivingHoursEnd?: string;
  breakWindow?: string;
  maxTrailerLength?: FacilityProfile["maxTrailerLength"];
  isoContainerCapable?: boolean;
  dockDoorCount?: number;
  liftgateRequired?: boolean;
  scaleOnSite?: boolean;
  hardHatRequired?: boolean;
  steelToeRequired?: boolean;
  twicCardRequired?: boolean;
  driverStagingNotes?: string;
  stagingMapUrl?: string;
  freeTimeMinutes?: number;
  detentionRateUsdPerHour?: number;
  capabilities?: FacilityCapability[];
}

/** A shipment currently bound for a given facility, resolved by matching the
 * shipment's lane destination city against the facility's city.
 * HONEST LIMITATION: shipments in this platform don't carry a facilityId
 * foreign key today (see server/src/routes/client.ts) — this is a
 * text-match heuristic against the in-memory sample shipment set, not a
 * guaranteed relational binding. Good enough to populate the drawer with
 * real, live-looking data; wire a real facility_id column once shipments
 * are persisted. */
export interface BoundShipmentSummary {
  id: string;
  lane: string;
  statusChip: string;
  driverName?: string;
  driverPhone?: string;
  etaIso?: string;
  carrierName?: string;
}

export interface CommodityProfile {
  id: string;
  orgId: string;
  productName: string;
  description?: string;
  htsCode: string;
  countryOfOrigin: string;
  usmcaEligible: boolean;
  isHazmat: boolean;
  hazmat?: { unNumber?: string; hazardClass?: string; packingGroup?: string; sdsOnFile: boolean };
  preferredPoe?: string; // omitted = "let Agent 4 auto-route"
}

export type AlertChannel = "sms" | "email" | "whatsapp";
export type AlertRole = "ceo" | "logistics_manager" | "driver";

export interface AlertPreference {
  role: AlertRole;
  channels: AlertChannel[];
}

export interface OperationalBaseline {
  orgId: string;
  facilities: FacilityProfile[];
  commodities: CommodityProfile[];
  alertPreferences: AlertPreference[];
  temperatureBaselineF?: { chilled: [number, number]; frozen: [number, number] };
  brokerPreference: "pascal_direct" | "third_party";
  thirdPartyBrokerName?: string;
}
