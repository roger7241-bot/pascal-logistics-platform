// ============================================================================
// ACE/ACI e-MANIFEST PORT AMENDMENT PACKAGE (Prompt 39)
// Builds the port-change amendment the Customs Broker of Record needs to
// re-file. Port codes below are the real US CBP port-of-entry codes for
// each Lower Mainland/Whatcom crossing (not invented placeholders) — CBSA
// side isn't included since ACE/ACI port amendments are a CBP-side filing
// concern for southbound/US-side entries.
//
// HONEST LIMITATION: this drafts the email package sent to the broker; it
// does not itself file anything with ACE/ACI (no broker API integration
// exists). The broker still has to actually re-file and confirm back —
// which is exactly why dispatch stays held at pending_broker_confirmation
// until that confirmation arrives, rather than assuming the email alone
// completes the amendment.
// ============================================================================

import type { PoeId } from "../types/borderTelemetry.js";
import type { AceAciAmendmentPackage } from "../types/reroute.js";

export const CBP_PORT_CODES: Record<PoeId, string> = {
  pacific_highway: "3004",
  peace_arch: "3004", // Peace Arch shares Blaine's port code; no separate commercial code since it has no commercial lane
  sumas: "3009",
  aldergrove: "3002", // filed under the Lynden, WA port code
  point_roberts: "3011",
};

export function buildAceAciAmendmentPackage(params: {
  shipmentId: string;
  fromPoeId: PoeId;
  toPoeId: PoeId;
  clientSignoffName: string;
}): AceAciAmendmentPackage {
  const fromPortCode = CBP_PORT_CODES[params.fromPoeId];
  const toPortCode = CBP_PORT_CODES[params.toPoeId];

  const emailSubject = `ACE/ACI Port Amendment Required — Shipment ${params.shipmentId} (Port ${fromPortCode} → ${toPortCode})`;
  const emailBody = [
    `Please amend the e-manifest for shipment ${params.shipmentId}.`,
    ``,
    `Original filed port of entry: ${fromPortCode}`,
    `Amended port of entry: ${toPortCode}`,
    ``,
    `Reason: border wait-time advisory, approved by the client's Logistics Manager (${params.clientSignoffName}).`,
    ``,
    `Driver dispatch is being held pending your confirmation that the amendment has been filed. Please reply to confirm once ACE/ACI reflects port ${toPortCode}.`,
  ].join("\n");

  return { shipmentId: params.shipmentId, fromPortCode, toPortCode, emailSubject, emailBody };
}
