// ============================================================================
// ERP ADAPTER — common types
// One TypeScript surface every provider (NetSuite, QuickBooks, Dynamics,
// Sage, Oracle, SAP, Odoo) implements. Lets Tier 3 agents reason about
// inventory / orders / receivables identically regardless of the client's
// stack. Demo mode returns realistic sample rows so we can sell + demo
// Tier 3 before any real integration license is purchased.
// ============================================================================

export type ErpProvider =
  | "netsuite"
  | "quickbooks_online"
  | "quickbooks_desktop"
  | "dynamics_365"
  | "sage_intacct"
  | "sage_x3"
  | "oracle_fusion"
  | "sap_s4hana"
  | "sap_ecc"
  | "odoo"
  | "demo";

export interface InventoryLine {
  sku: string;
  description: string;
  onHandUnits: number;
  onOrderUnits: number;
  committedUnits: number;
  availableUnits: number;             // on_hand + on_order - committed
  reorderPoint: number;
  safetyStockUnits: number;
  unitCostUsd: number;
  location?: string;
}

export interface PurchaseOrder {
  poNumber: string;
  supplierName: string;
  status: "open" | "in_transit" | "received" | "closed" | "cancelled";
  orderDate: string;                  // ISO date
  expectedDate: string | null;
  actualReceivedDate: string | null;
  totalUsd: number;
  lineCount: number;
}

export interface SalesOrder {
  soNumber: string;
  customerName: string;
  status: "open" | "picking" | "shipped" | "delivered" | "cancelled" | "backorder";
  orderDate: string;
  requestedShipDate: string | null;
  actualShipDate: string | null;
  requestedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  totalUsd: number;
  fillRatePct: number;                // units_shipped / units_ordered
}

export interface ConnectionTest {
  ok: boolean;
  provider: ErpProvider;
  demoMode: boolean;
  message: string;
  accountLabel?: string;              // e.g. NetSuite subsidiary name / QB realm name
}

export interface ErpAdapter {
  provider: ErpProvider;
  demoMode: boolean;

  testConnection(): Promise<ConnectionTest>;
  getInventory(): Promise<InventoryLine[]>;
  getPurchaseOrders(sinceIso: string): Promise<PurchaseOrder[]>;
  getSalesOrders(sinceIso: string): Promise<SalesOrder[]>;
}
