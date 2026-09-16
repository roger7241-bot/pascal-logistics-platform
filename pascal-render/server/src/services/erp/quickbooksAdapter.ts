// ============================================================================
// QuickBooks Online adapter
// Demo mode ships now. Live mode wires QBO's Intuit OAuth 2.0 flow + REST API
// once the client authorizes access. Realm ID + refresh token get stored in
// a secrets manager, not in the DB config JSONB.
// ============================================================================

import type { ErpAdapter, ConnectionTest, InventoryLine, PurchaseOrder, SalesOrder } from "./types.js";
import { demoInventory, demoPurchaseOrders, demoSalesOrders } from "./demoData.js";

export interface QuickBooksConfig {
  realmId?: string;
  companyName?: string;
}

export class QuickBooksAdapter implements ErpAdapter {
  provider = "quickbooks_online" as const;

  constructor(
    public demoMode: boolean,
    private orgId: string,
    private config: QuickBooksConfig,
  ) {}

  async testConnection(): Promise<ConnectionTest> {
    if (this.demoMode) {
      return {
        ok: true,
        provider: "quickbooks_online",
        demoMode: true,
        message: "Demo mode — realistic sample data returned. Complete Intuit OAuth to switch live.",
        accountLabel: this.config.companyName ?? "Demo Company",
      };
    }
    return {
      ok: false,
      provider: "quickbooks_online",
      demoMode: false,
      message: "Live QuickBooks integration not wired yet. Complete Intuit OAuth from the ERP Connection page.",
    };
  }

  async getInventory(): Promise<InventoryLine[]> {
    if (this.demoMode) return demoInventory(this.orgId, "quickbooks_online");
    throw new Error("Live QuickBooks inventory pull not implemented.");
  }

  async getPurchaseOrders(sinceIso: string): Promise<PurchaseOrder[]> {
    if (this.demoMode) return demoPurchaseOrders(this.orgId, "quickbooks_online", sinceIso);
    throw new Error("Live QuickBooks PO pull not implemented.");
  }

  async getSalesOrders(sinceIso: string): Promise<SalesOrder[]> {
    if (this.demoMode) return demoSalesOrders(this.orgId, "quickbooks_online", sinceIso);
    throw new Error("Live QuickBooks SO pull not implemented.");
  }
}
