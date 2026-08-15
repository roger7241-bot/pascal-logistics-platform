// ============================================================================
// SHARED SHIPMENT & PIPELINE TYPES
// ============================================================================

export interface PartyDetails {
  facilityName?: string;
  contactPerson?: string;
  phoneE164?: string;
  email?: string;
  street?: string;
  city?: string;
  stateOrProvince?: string;
  countryCode?: string;
  postalCode?: string;
}

export interface HandlingUnit {
  quantity: number;
  packagingType: string;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  stackable?: boolean;
}

export interface HazmatDetails {
  unNumber?: string;
  properShippingName?: string;
  hazardClass?: string;
  packingGroup?: "I" | "II" | "III";
  emergencyPhone?: string;
  sdsAttached?: boolean;
}

export interface TimeWindow {
  dateIso?: string;
  startTime?: string; // "HH:MM"
  endTime?: string;
  strictAppointment?: boolean; // "an appointment is required" — used on both pickup and delivery windows
  dockAvailable?: boolean; // pickup-window only in practice: does the shipper's facility have a dock, or is this a residential/no-dock pickup?
}

export interface CargoDetails {
  handlingUnits: HandlingUnit[];
  totalWeightLbs?: number;
  totalWeightKg?: number;
  totalPallets?: number;
  totalCartons?: number;
  freightClass?: string; // NMFC
  mode?: "LTL" | "FTL";
  equipmentType?: "dry_van_53" | "dry_van_48" | "reefer_53" | "flatbed_48" | "stepdeck" | "ltl_pallet";
  reeferTempF?: number;
  reeferTempC?: number;
  tailgateRequired?: boolean;
  isHazmat: boolean;
  hazmat?: HazmatDetails;
}

export interface CustomsDetails {
  portOfEntry?: string;
  commercialInvoiceValue?: number;
  currency?: "USD" | "CAD" | "EUR";
  htsCode?: string;
  countryOfOrigin?: string;
  usmcaPreferenceCriterion?: "A" | "B" | "C" | "D";
  importerOfRecordName?: string;
  importerTaxId?: string;
  pgaFlags: string[];
  papsParsBarcode?: string;
  customsBrokerName?: string;
  documentsSentToBroker?: boolean; // self-reported by the shipper at booking time — not independently verified; Pascal confirms with the broker directly before dispatch either way
}

export interface BillingDetails {
  billingTerms?: "Prepaid" | "Collect" | "Third-Party";
  carrierAccountName?: string;
  carrierName?: string;
  carrierAccountNumber?: string;
}

export interface ModeSpecificRouting {
  // Road / Truck
  borderCrossing?: string;
  // Intermodal Rail
  railRampOrigin?: string;
  railRampDestination?: string;
  containerNumber?: string;
  chassisNumber?: string;
  // Ocean
  portOfLoading?: string;
  portOfDischarge?: string;
  containerType?: "fcl_20" | "fcl_40" | "fcl_45hc" | "lcl" | "breakbulk";
  // Air
  originAirportIata?: string;
  destAirportIata?: string;
  airServiceLevel?: "standard" | "priority_express" | "charter";
}

/** The canonical inbound payload shape for POST /api/shipments/ingest. */
export interface NewShipmentPayload {
  transportMode?: TransportMode;
  poNumber?: string;
  routing?: ModeSpecificRouting;
  shipper: PartyDetails;
  consignee: PartyDetails;
  cargo: CargoDetails;
  customs: CustomsDetails;
  billing: BillingDetails;
  readyDateIso?: string;
  pickupWindow?: TimeWindow;
  deliveryWindow?: TimeWindow;
  source: "client_portal" | "email_intake" | "manual_operator";
}

export type ApprovalStatus = "AUTO_DISPATCHED" | "PENDING_ROGER_APPROVAL";

export interface PipelineResult {
  shipmentId: string;
  payload: NewShipmentPayload;
  confidenceScore: number;
  validationErrors: string[];
  approvalStatus: ApprovalStatus;
  autoActionExecuted: boolean;
  complianceFlags: string[];
  rateOptimization?: {
    contractedRateUsd: number;
    benchmarkSpotRateUsd: number;
    savingsPct: number;
    savingsFlagged: boolean; // true when savings >= 15%
  };
  equipmentRecommendation?: {
    recommended: string;
    reasoning: string;
  };
  createdAtIso: string;
}

export type TransportMode = "road" | "rail" | "ocean" | "air";

export type RoadMilestone = "pickup" | "export_manifest" | "poe_inspection" | "paps_pars_release" | "delivery";
export type RailMilestone = "pickup" | "rail_ramp_origin_gate_in" | "rail_transit" | "rail_ramp_destination_arrival" | "drayage_delivery";
export type OceanMilestone = "container_loaded" | "port_origin_gate_in" | "vessel_departure" | "transshipment" | "port_destination_arrival" | "customs_clearance" | "drayage_delivery";
export type AirMilestone = "acceptance_at_terminal" | "customs_export_release" | "flight_departure" | "import_airport_arrival" | "pga_customs_clearance" | "final_mile_delivery";

export type ShipmentMilestone = RoadMilestone | RailMilestone | OceanMilestone | AirMilestone;

export interface ClientShipmentSummary {
  id: string;
  transportMode: TransportMode;
  currentMilestone: ShipmentMilestone;
  statusChip: "paps_pars_released" | "customs_hold_flagged" | "vessel_en_route" | "flight_departed" | "in_transit" | "delivered";
  lane: string;
  updatedAtIso: string;
  driverName?: string;
  driverPhone?: string;
  vesselName?: string;
  flightNumber?: string;
  htsCode?: string;
  linkedDocuments: { filename: string; category: string; url?: string }[];
}



export type CarrierMilestone = "PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED_CLEAN" | "EXCEPTION" | "UNKNOWN";

export interface LegacyTrackingRequest {
  carrierName: string;
  trackingUrlTemplate: string; // must contain {trackingNumber} placeholder
  trackingNumber: string;
}

export interface LegacyTrackingResult {
  carrierName: string;
  trackingNumber: string;
  milestone: CarrierMilestone;
  rawStatusText?: string;
  blocked: boolean;
  blockReason?: string;
  checkedAtIso: string;
}
