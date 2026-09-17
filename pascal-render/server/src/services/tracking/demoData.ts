// ============================================================================
// Tracking demo-data generator
// Deterministic milestone sequences seeded from the tracking number so a
// container / MAWB's timeline stays stable across page loads. Realistic
// port / airport pools + carrier codes + event ordering.
// ============================================================================

import type { TrackingMilestone, TrackingMode } from "./types.js";

function seed(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const OCEAN_ORIGINS = [
  { name: "Shanghai (CNSHA)", lat: 31.2, lon: 121.5 },
  { name: "Ningbo (CNNGB)", lat: 29.9, lon: 121.6 },
  { name: "Busan (KRPUS)", lat: 35.1, lon: 129.0 },
  { name: "Shenzhen-Yantian (CNYTN)", lat: 22.6, lon: 114.3 },
];
const OCEAN_DESTS = [
  { name: "Vancouver (CAVAN)", lat: 49.3, lon: -123.1 },
  { name: "Prince Rupert (CAPRR)", lat: 54.3, lon: -130.3 },
  { name: "Seattle-Tacoma (USSEA)", lat: 47.6, lon: -122.3 },
  { name: "Long Beach (USLGB)", lat: 33.8, lon: -118.2 },
];

const AIR_ORIGINS = [
  { name: "PVG Shanghai", lat: 31.1, lon: 121.8 },
  { name: "HKG Hong Kong", lat: 22.3, lon: 113.9 },
  { name: "ICN Incheon", lat: 37.5, lon: 126.4 },
  { name: "NRT Narita", lat: 35.8, lon: 140.4 },
];
const AIR_DESTS = [
  { name: "YVR Vancouver", lat: 49.2, lon: -123.2 },
  { name: "SEA Seattle", lat: 47.5, lon: -122.3 },
  { name: "YYZ Toronto", lat: 43.7, lon: -79.6 },
  { name: "ORD Chicago", lat: 42.0, lon: -87.9 },
];

export function generateOceanMilestones(trackingNumber: string, origin?: string, destination?: string): TrackingMilestone[] {
  const rng = seed(`ocean:${trackingNumber}`);
  const o = origin ? { name: origin, lat: 31.2, lon: 121.5 } : OCEAN_ORIGINS[Math.floor(rng() * OCEAN_ORIGINS.length)];
  const d = destination ? { name: destination, lat: 49.3, lon: -123.1 } : OCEAN_DESTS[Math.floor(rng() * OCEAN_DESTS.length)];
  const start = Date.now() - (18 + Math.floor(rng() * 8)) * 86_400_000;
  const iso = (offsetDays: number) => new Date(start + offsetDays * 86_400_000).toISOString();

  const milestones: TrackingMilestone[] = [
    { eventType: "booking_confirmed", eventCode: "BKG", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(0), isException: false },
    { eventType: "gate_in", eventCode: "GTI", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(2), isException: false },
    { eventType: "loaded", eventCode: "LOB", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(3), isException: false },
    { eventType: "sailed", eventCode: "VDF", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(4), isException: false },
  ];

  const rolled = rng() < 0.2;
  if (rolled) {
    milestones.push({ eventType: "rolled", eventCode: "RLD", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(3.5), isException: true, details: { reason: "Vessel over-utilization" } });
  }

  milestones.push({ eventType: "in_transit", eventCode: "TRN", occurredAtIso: iso(9), isException: false, details: { note: "Mid-Pacific position update" } });

  milestones.push({ eventType: "arrived", eventCode: "ARV", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(15), isException: false });
  milestones.push({ eventType: "discharged", eventCode: "DPC", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(16), isException: false });

  const held = rng() < 0.25;
  if (held) {
    milestones.push({ eventType: "customs_hold", eventCode: "CHD", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(16.5), isException: true, details: { reason: "Manifest hold — awaiting broker release" } });
    milestones.push({ eventType: "customs_released", eventCode: "CRL", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(18), isException: false });
  }

  milestones.push({ eventType: "gated_out", eventCode: "GTO", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(19), isException: false });

  return milestones;
}

export function generateAirMilestones(trackingNumber: string, origin?: string, destination?: string): TrackingMilestone[] {
  const rng = seed(`air:${trackingNumber}`);
  const o = origin ? { name: origin, lat: 31.1, lon: 121.8 } : AIR_ORIGINS[Math.floor(rng() * AIR_ORIGINS.length)];
  const d = destination ? { name: destination, lat: 49.2, lon: -123.2 } : AIR_DESTS[Math.floor(rng() * AIR_DESTS.length)];
  const start = Date.now() - (2 + Math.floor(rng() * 3)) * 86_400_000;
  const iso = (offsetHours: number) => new Date(start + offsetHours * 3_600_000).toISOString();

  const milestones: TrackingMilestone[] = [
    { eventType: "booking_confirmed", eventCode: "FOH", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(0), isException: false },
    { eventType: "gate_in", eventCode: "RCS", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(4), isException: false },
    { eventType: "loaded", eventCode: "DEP", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(8), isException: false },
    { eventType: "sailed", eventCode: "DEP", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(9), isException: false },
    { eventType: "in_transit", eventCode: "ARR", occurredAtIso: iso(14), isException: false, details: { note: "Enroute" } },
    { eventType: "arrived", eventCode: "ARR", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(20), isException: false },
    { eventType: "discharged", eventCode: "RCF", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(22), isException: false },
  ];

  if (rng() < 0.2) {
    milestones.push({ eventType: "customs_hold", eventCode: "HLD", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(24), isException: true, details: { reason: "Awaiting IIT / customs release" } });
    milestones.push({ eventType: "customs_released", eventCode: "REL", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(28), isException: false });
  }

  milestones.push({ eventType: "delivered", eventCode: "DLV", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(32), isException: false });

  return milestones;
}

// Land freight — LTL cross-dock pattern with two terminal touches.
const LTL_ORIGINS = [
  { name: "Blaine, WA", lat: 48.99, lon: -122.75 },
  { name: "Seattle, WA", lat: 47.61, lon: -122.33 },
  { name: "Portland, OR", lat: 45.51, lon: -122.68 },
  { name: "Surrey, BC", lat: 49.19, lon: -122.85 },
];
const LTL_DESTS = [
  { name: "Toronto, ON", lat: 43.65, lon: -79.38 },
  { name: "Chicago, IL", lat: 41.88, lon: -87.63 },
  { name: "Los Angeles, CA", lat: 34.05, lon: -118.24 },
  { name: "Dallas, TX", lat: 32.78, lon: -96.80 },
];
const LTL_TERMINALS = [
  "Seattle Cross-Dock", "Portland Cross-Dock", "Kent Hub", "Sumner Hub",
  "Chicago Consolidation", "Kansas City Hub", "Denver Hub",
];

export function generateLtlMilestones(trackingNumber: string, origin?: string, destination?: string): TrackingMilestone[] {
  const rng = seed(`ltl:${trackingNumber}`);
  const o = origin ? { name: origin, lat: 48.99, lon: -122.75 } : LTL_ORIGINS[Math.floor(rng() * LTL_ORIGINS.length)];
  const d = destination ? { name: destination, lat: 43.65, lon: -79.38 } : LTL_DESTS[Math.floor(rng() * LTL_DESTS.length)];
  const originTerm = LTL_TERMINALS[Math.floor(rng() * 4)];
  const destTerm = LTL_TERMINALS[4 + Math.floor(rng() * 3)];
  const start = Date.now() - (4 + Math.floor(rng() * 3)) * 86_400_000;
  const iso = (offsetHours: number) => new Date(start + offsetHours * 3_600_000).toISOString();

  const milestones: TrackingMilestone[] = [
    { eventType: "booking_confirmed", eventCode: "BKG", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(0), isException: false },
    { eventType: "picked_up", eventCode: "PU", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(6), isException: false },
    { eventType: "at_origin_terminal", eventCode: "OTL", location: originTerm, occurredAtIso: iso(9), isException: false, details: { terminal: originTerm } },
  ];

  const hasReweigh = rng() < 0.25;
  if (hasReweigh) {
    milestones.push({ eventType: "exception", eventCode: "RWG", location: originTerm, occurredAtIso: iso(11), isException: true, details: { reason: "Reweigh — actual weight differs from BOL by 8%" } });
  }

  milestones.push({ eventType: "linehaul", eventCode: "LH", occurredAtIso: iso(14), isException: false, details: { note: "Departed origin terminal, linehaul in progress" } });
  milestones.push({ eventType: "at_destination_terminal", eventCode: "DTL", location: destTerm, occurredAtIso: iso(48), isException: false, details: { terminal: destTerm } });

  const dockCongestion = rng() < 0.15;
  if (dockCongestion) {
    milestones.push({ eventType: "hold", eventCode: "DKC", location: destTerm, occurredAtIso: iso(50), isException: true, details: { reason: "Dock congestion — 24h delay expected" } });
  }

  milestones.push({ eventType: "out_for_delivery", eventCode: "OFD", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(dockCongestion ? 74 : 55), isException: false });
  milestones.push({ eventType: "delivered", eventCode: "DEL", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(dockCongestion ? 76 : 58), isException: false });

  return milestones;
}

// Truckload — direct dispatch, pickup, checkpoints, delivery.
export function generateTlMilestones(trackingNumber: string, origin?: string, destination?: string): TrackingMilestone[] {
  const rng = seed(`tl:${trackingNumber}`);
  const o = origin ? { name: origin, lat: 48.99, lon: -122.75 } : LTL_ORIGINS[Math.floor(rng() * LTL_ORIGINS.length)];
  const d = destination ? { name: destination, lat: 43.65, lon: -79.38 } : LTL_DESTS[Math.floor(rng() * LTL_DESTS.length)];
  const start = Date.now() - (3 + Math.floor(rng() * 3)) * 86_400_000;
  const iso = (offsetHours: number) => new Date(start + offsetHours * 3_600_000).toISOString();

  const milestones: TrackingMilestone[] = [
    { eventType: "booking_confirmed", eventCode: "TND", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(0), isException: false, details: { note: "Tender accepted by carrier" } },
    { eventType: "picked_up", eventCode: "PU", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(4), isException: false },
  ];

  const latePickup = rng() < 0.15;
  if (latePickup) {
    milestones.push({ eventType: "exception", eventCode: "LP", location: o.name, occurredAtIso: iso(6), isException: true, details: { reason: "Late pickup — 2 hrs past appointment window" } });
  }

  // Mid-transit checkpoints via ELD / MacroPoint
  milestones.push({ eventType: "in_transit", eventCode: "CHK", occurredAtIso: iso(12), isException: false, details: { note: "Enroute — ELD checkpoint" } });
  milestones.push({ eventType: "in_transit", eventCode: "CHK", occurredAtIso: iso(24), isException: false, details: { note: "Overnight rest — driver HOS reset" } });

  const breakdown = rng() < 0.08;
  if (breakdown) {
    milestones.push({ eventType: "exception", eventCode: "BRK", occurredAtIso: iso(30), isException: true, details: { reason: "Mechanical breakdown — recovery unit dispatched, ETA push 8 hrs" } });
  }

  milestones.push({ eventType: "in_transit", eventCode: "CHK", occurredAtIso: iso(breakdown ? 42 : 36), isException: false, details: { note: "Approaching destination" } });
  milestones.push({ eventType: "arrived", eventCode: "ARR", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(breakdown ? 48 : 40), isException: false });
  milestones.push({ eventType: "delivered", eventCode: "POD", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(breakdown ? 50 : 42), isException: false });

  return milestones;
}

// Intermodal rail — ramp / linehaul / ramp pattern.
export function generateRailMilestones(trackingNumber: string, origin?: string, destination?: string): TrackingMilestone[] {
  const rng = seed(`rail:${trackingNumber}`);
  const o = origin ? { name: origin, lat: 47.61, lon: -122.33 } : { name: "Seattle Ramp (BNSF)", lat: 47.61, lon: -122.33 };
  const d = destination ? { name: destination, lat: 41.88, lon: -87.63 } : { name: "Chicago Ramp (BNSF)", lat: 41.88, lon: -87.63 };
  const start = Date.now() - (6 + Math.floor(rng() * 3)) * 86_400_000;
  const iso = (offsetHours: number) => new Date(start + offsetHours * 3_600_000).toISOString();

  return [
    { eventType: "booking_confirmed", eventCode: "BKG", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(0), isException: false },
    { eventType: "picked_up", eventCode: "DRY", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(8), isException: false, details: { note: "Origin drayage — container to ramp" } },
    { eventType: "at_origin_terminal", eventCode: "RGI", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(12), isException: false },
    { eventType: "loaded", eventCode: "RLD", location: o.name, latitude: o.lat, longitude: o.lon, occurredAtIso: iso(24), isException: false, details: { note: "Loaded on rail car" } },
    { eventType: "linehaul", eventCode: "RTL", occurredAtIso: iso(30), isException: false, details: { note: "Train departed origin ramp" } },
    { eventType: "in_transit", eventCode: "CHK", occurredAtIso: iso(72), isException: false, details: { note: "Mid-linehaul checkpoint" } },
    { eventType: "at_destination_terminal", eventCode: "RGO", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(96), isException: false, details: { note: "Arrived destination ramp" } },
    { eventType: "gated_out", eventCode: "GTO", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(108), isException: false, details: { note: "Destination drayage picked up" } },
    { eventType: "delivered", eventCode: "POD", location: d.name, latitude: d.lat, longitude: d.lon, occurredAtIso: iso(112), isException: false },
  ];
}

export function generateMilestones(mode: TrackingMode, trackingNumber: string, origin?: string, destination?: string): TrackingMilestone[] {
  switch (mode) {
    case "ocean": return generateOceanMilestones(trackingNumber, origin, destination);
    case "air":   return generateAirMilestones(trackingNumber, origin, destination);
    case "ltl":   return generateLtlMilestones(trackingNumber, origin, destination);
    case "tl":    return generateTlMilestones(trackingNumber, origin, destination);
    case "rail":  return generateRailMilestones(trackingNumber, origin, destination);
  }
}
