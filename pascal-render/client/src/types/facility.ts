// ============================================================================
// FACILITY MANAGEMENT & WAREHOUSE RULES HUB — client-side type mirror of
// server/src/types/facility.ts (client build doesn't reach across into
// server/, same pattern as client/src/types/shipment.ts).
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
  dockHeight: boolean;
  driveInRamp: boolean;
  liftgateRequired: boolean;
  forkliftOnSite: boolean;
  maxTrailerLength: "53ft" | "48ft" | "straight_truck";
  receivingHoursStart: string;
  receivingHoursEnd: string;
  lunchBreakClosure?: string;
  appointmentRequired: boolean;
  pickupLeadTimeHours: number;
  driverPPE: string[];
  twicCardRequired: boolean;
  checkInInstructions?: string;

  dockContactName?: string;
  dockContactPhone?: string;
  receivingEmail?: string;
  breakWindow?: string;
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

export interface BoundShipmentSummary {
  id: string;
  lane: string;
  statusChip: string;
  driverName?: string;
  driverPhone?: string;
  etaIso?: string;
  carrierName?: string;
}
