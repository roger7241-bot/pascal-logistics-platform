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

export function generateMilestones(mode: TrackingMode, trackingNumber: string, origin?: string, destination?: string): TrackingMilestone[] {
  return mode === "ocean" ? generateOceanMilestones(trackingNumber, origin, destination) : generateAirMilestones(trackingNumber, origin, destination);
}
