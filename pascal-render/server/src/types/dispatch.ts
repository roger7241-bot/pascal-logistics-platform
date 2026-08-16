// ============================================================================
// RAPID DISPATCH DESK — server-side types
// ============================================================================

export type PackagingType = "standard_48x40" | "chep_pallet" | "reefer_tote" | "parcel_carton";
export type StagingStatus = "staged" | "loaded" | "dispatched" | "cancelled";

export const PACKAGING_DEFAULT_LBS_PER_UNIT: Record<PackagingType, number> = {
  standard_48x40: 1250,
  chep_pallet: 1250,
  reefer_tote: 600,
  parcel_carton: 45,
};

export interface OutboundStagingRecord {
  id: string;
  orgId: string;
  poNumber?: string;
  bolNumber?: string;
  sku?: string;
  consigneeFacilityId?: string;
  consigneeName?: string; // joined for display, not stored
  carrierAccountId?: string;
  carrierName?: string; // joined for display, not stored
  packagingType: PackagingType;
  palletCount: number;
  grossWeightLbs: number;
  freightClass?: string;
  isCrossBorder: boolean;
  papsParsBarcode?: string;
  status: StagingStatus;
  driverPhone?: string;
  driverName?: string;
  trailerSealNumber?: string;
  dockDoor?: string;
  handlingNotes?: string;
  stagedBy?: string;
  stagedAtIso: string;
  dispatchedAtIso?: string;
}

export interface CarrierCutoffInfo {
  id: string;
  carrierName: string;
  dailyCutoffLocalTime?: string;
  cutoffTimezone: string;
  minutesToCutoff?: number; // null when no cutoff time configured, or already past today's cutoff
  urgency: "urgent" | "soon" | "normal" | "past_cutoff" | "unknown";
}

export interface WeightBaseline {
  packagingType: PackagingType;
  avgGrossWeightLbs: number;
  sampleSize: number;
}

export interface MagicUploadTokenResult {
  token: string;
  uploadUrl: string;
  qrCodeDataUri: string;
  expiresAtIso: string;
}

export type CarrierServiceType = "LTL" | "FTL" | "Reefer";
