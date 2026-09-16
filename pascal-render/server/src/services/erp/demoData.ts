// ============================================================================
// ERP demo-data generator
// Deterministic sample data for demo-mode adapters. Same input → same output,
// so a client's demo screens stay stable across page loads. Uses a hash of
// (org_id + provider) as seed.
// ============================================================================

import type { InventoryLine, PurchaseOrder, SalesOrder } from "./types.js";

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

const SUPPLIER_POOL = [
  "Cascade Industrial Supply", "Fraser Valley Fasteners", "Puget Sound Components",
  "Northwest Metal Works", "Border Bearings Co.", "Vancouver Island Steel",
  "Sumas Packaging Group", "Whatcom Electrical",
];

const CUSTOMER_POOL = [
  "Meridian Manufacturing", "Pacific Rim Distributors", "Rainier Retail Group",
  "Fraser Foods", "Cascade Wholesale", "Blaine Hardware Co.",
  "West Coast Assembly", "North Peace Trading",
];

const SKU_TEMPLATES = [
  { prefix: "BRK", desc: "Machined bracket, aluminum" },
  { prefix: "PMP", desc: "Rotary pump housing" },
  { prefix: "GSK", desc: "Nitrile gasket set" },
  { prefix: "BLT", desc: "Zinc-plated bolt assortment" },
  { prefix: "MTR", desc: "AC motor 1/2 HP" },
  { prefix: "PCB", desc: "PCB assembly" },
  { prefix: "WLD", desc: "Welded frame subassembly" },
  { prefix: "PKG", desc: "Corrugated master pack" },
];

const daysAgoIso = (rng: () => number, max: number): string =>
  new Date(Date.now() - Math.floor(rng() * max) * 86_400_000).toISOString().slice(0, 10);

export function demoInventory(orgId: string, provider: string): InventoryLine[] {
  const rng = seed(`${orgId}:${provider}:inventory`);
  return SKU_TEMPLATES.map((t, i) => {
    const onHand = Math.floor(rng() * 2000) + 50;
    const onOrder = Math.floor(rng() * 500);
    const committed = Math.floor(rng() * 300);
    const reorder = Math.floor(rng() * 400) + 100;
    return {
      sku: `${t.prefix}-${1000 + i}`,
      description: t.desc,
      onHandUnits: onHand,
      onOrderUnits: onOrder,
      committedUnits: committed,
      availableUnits: onHand + onOrder - committed,
      reorderPoint: reorder,
      safetyStockUnits: Math.floor(reorder * 0.4),
      unitCostUsd: Math.round((rng() * 240 + 8) * 100) / 100,
      location: rng() > 0.5 ? "Blaine WH" : "Surrey WH",
    };
  });
}

export function demoPurchaseOrders(orgId: string, provider: string, sinceIso: string): PurchaseOrder[] {
  const rng = seed(`${orgId}:${provider}:po`);
  const sinceMs = new Date(sinceIso).getTime();
  const daysSinceCutoff = Math.max(1, Math.floor((Date.now() - sinceMs) / 86_400_000));
  const count = Math.min(20, Math.floor(rng() * 12) + 6);
  const statuses: PurchaseOrder["status"][] = ["open", "in_transit", "received", "closed", "cancelled"];
  return Array.from({ length: count }, (_, i) => {
    const orderDate = daysAgoIso(rng, daysSinceCutoff);
    const status = statuses[Math.floor(rng() * statuses.length)];
    const totalUsd = Math.round((rng() * 45000 + 1200) * 100) / 100;
    return {
      poNumber: `PO-2026-${4200 + i}`,
      supplierName: SUPPLIER_POOL[Math.floor(rng() * SUPPLIER_POOL.length)],
      status,
      orderDate,
      expectedDate: status !== "cancelled" ? daysAgoIso(rng, -14) : null,
      actualReceivedDate: status === "received" || status === "closed" ? daysAgoIso(rng, daysSinceCutoff) : null,
      totalUsd,
      lineCount: Math.floor(rng() * 12) + 1,
    };
  });
}

export function demoSalesOrders(orgId: string, provider: string, sinceIso: string): SalesOrder[] {
  const rng = seed(`${orgId}:${provider}:so`);
  const sinceMs = new Date(sinceIso).getTime();
  const daysSinceCutoff = Math.max(1, Math.floor((Date.now() - sinceMs) / 86_400_000));
  const count = Math.min(30, Math.floor(rng() * 22) + 10);
  const statuses: SalesOrder["status"][] = ["open", "picking", "shipped", "delivered", "backorder"];
  return Array.from({ length: count }, (_, i) => {
    const orderDate = daysAgoIso(rng, daysSinceCutoff);
    const status = statuses[Math.floor(rng() * statuses.length)];
    const totalUsd = Math.round((rng() * 28000 + 800) * 100) / 100;
    const fillRatePct = status === "backorder" ? Math.round((60 + rng() * 30) * 10) / 10 : Math.round((92 + rng() * 8) * 10) / 10;
    return {
      soNumber: `SO-2026-${8100 + i}`,
      customerName: CUSTOMER_POOL[Math.floor(rng() * CUSTOMER_POOL.length)],
      status,
      orderDate,
      requestedShipDate: daysAgoIso(rng, daysSinceCutoff - 2),
      actualShipDate: status === "shipped" || status === "delivered" ? daysAgoIso(rng, daysSinceCutoff - 3) : null,
      requestedDeliveryDate: daysAgoIso(rng, -4),
      actualDeliveryDate: status === "delivered" ? daysAgoIso(rng, daysSinceCutoff - 5) : null,
      totalUsd,
      fillRatePct,
    };
  });
}
