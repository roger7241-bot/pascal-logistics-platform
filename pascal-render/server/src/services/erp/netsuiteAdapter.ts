// ============================================================================
// NetSuite adapter
// Currently ships in demo mode. Live mode wires SuiteTalk REST + OAuth 2.0
// once the client provides Account ID + Consumer Key/Secret. Demo mode uses
// deterministic sample data seeded from the org_id so demo screens stay
// stable across page loads.
// ============================================================================

import type { ErpAdapter, ConnectionTest, InventoryLine, PurchaseOrder, SalesOrder } from "./types.js";
import { demoInventory, demoPurchaseOrders, demoSalesOrders } from "./demoData.js";

export interface NetSuiteConfig {
  accountId?: string;
  subsidiary?: string;
}

export class NetSuiteAdapter implements ErpAdapter {
  provider = "netsuite" as const;

  constructor(
    public demoMode: boolean,
    private orgId: string,
    private config: NetSuiteConfig,
  ) {}

  async testConnection(): Promise<ConnectionTest> {
    if (this.demoMode) {
      return {
        ok: true,
        provider: "netsuite",
        demoMode: true,
        message: "Demo mode — realistic sample data returned. Provide Account ID + OAuth to switch live.",
        accountLabel: this.config.subsidiary ?? "Demo Subsidiary",
      };
    }
    return {
      ok: false,
      provider: "netsuite",
      demoMode: false,
      message: "Live NetSuite integration not wired yet. Set demo_mode=true or complete the OAuth flow.",
    };
  }

  async getInventory(): Promise<InventoryLine[]> {
    if (this.demoMode) return demoInventory(this.orgId, "netsuite");
    throw new Error("Live NetSuite inventory pull not implemented.");
  }

  async getPurchaseOrders(sinceIso: string): Promise<PurchaseOrder[]> {
    if (this.demoMode) return demoPurchaseOrders(this.orgId, "netsuite", sinceIso);
    throw new Error("Live NetSuite PO pull not implemented.");
  }

  async getSalesOrders(sinceIso: string): Promise<SalesOrder[]> {
    if (this.demoMode) return demoSalesOrders(this.orgId, "netsuite", sinceIso);
    throw new Error("Live NetSuite SO pull not implemented.");
  }
}
