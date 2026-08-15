// ============================================================================
// RAPID DISPATCH DESK — client-side type mirror of server/src/types/dispatch.ts
// ============================================================================

export type PackagingType = "standard_48x40" | "chep_pallet" | "reefer_tote" | "parcel_carton";
export type StagingStatus = "staged" | "loaded" | "dispatched" | "cancelled";

export const PACKAGING_LABEL: Record<PackagingType, string> = {
  standard_48x40: "Standard 48x40 Pallet",
  chep_pallet: "CHEP Pallet",
  reefer_tote: "Reefer Tote (-18°C)",
  parcel_carton: "Parcel Carton",
};

export const PACKAGING_DEFAULT_LBS_PER_UNIT: Record<PackagingType, number> = {
  standard_48x40: 1250,
  chep_pallet: 1250,
  reefer_tote: 600,
  parcel_carton: 45,
};

export interface ConsigneeOption {
  id: string;
  name: string;
  city: string;
  stateOrProvince: string;
  countryCode: string;
  receivingHoursStart: string;
  receivingHoursEnd: string;
  freeTimeMinutes: number;
  detentionRateUsdPerHour: number;
  isCrossBorderCandidate: boolean;
  stagingCount: number;
}

export interface CarrierCutoffInfo {
  id: string;
  carrierName: string;
  dailyCutoffLocalTime?: string;
  cutoffTimezone: string;
  minutesToCutoff?: number;
  urgency: "urgent" | "soon" | "normal" | "past_cutoff" | "unknown";
}

export interface WeightBaseline {
  packagingType: PackagingType;
  avgGrossWeightLbs: number;
  sampleSize: number;
}

export interface OutboundStagingRecord {
  id: string;
  orgId: string;
  poNumber?: string;
  bolNumber?: string;
  sku?: string;
  consigneeFacilityId?: string;
  consigneeName?: string;
  carrierAccountId?: string;
  carrierName?: string;
  packagingType: PackagingType;
  palletCount: number;
  grossWeightLbs: number;
  freightClass?: string;
  isCrossBorder: boolean;
  papsParsBarcode?: string;
  status: StagingStatus;
  driverPhone?: string;
  stagedBy?: string;
  stagedAtIso: string;
  dispatchedAtIso?: string;
}

export interface MagicUploadTokenResult {
  token: string;
  uploadUrl: string;
  qrCodeDataUri: string;
  expiresAtIso: string;
}
