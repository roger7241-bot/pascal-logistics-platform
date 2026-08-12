// ============================================================================
// OPERATIONAL BASELINE TYPES
// Facility directory, frequent commodities, and alert preferences captured
// during onboarding — this is what the Client Shipment Intake Wizard's
// "Smart Address Lookup" and HTS auto-suggest should draw from.
// ============================================================================

export type FacilityRole = "shipper" | "consignee" | "both";

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
