/**
 * Canonical ERP data model. Every ERP adapter (SAP, Dynamics, mock…) maps its
 * own wire format to these types, so the Shopify side never depends on a vendor.
 */

export interface ErpPriceTier {
  /** Quantity from which `unitPrice` applies. */
  minQuantity: number;
  unitPrice: string;
}

export interface ErpPriceRecord {
  sku: string;
  /** Decimal string, never a float, to avoid rounding issues. */
  unitPrice: string;
  /** Recommended retail price, shown to retailers as "MSRP". */
  retailPrice?: string;
  minQuantity?: number;
  maxQuantity?: number;
  /** Case pack: quantities must be a multiple of this value. */
  increment?: number;
  tiers?: ErpPriceTier[];
}

export interface ErpPriceList {
  code: string;
  currency: string;
  validFrom: string;
  records: ErpPriceRecord[];
}

export interface ErpOrderLine {
  sku: string;
  quantity: number;
  unitPrice: string;
  shopifyLineId: string;
}

export interface ErpOrder {
  /** Shopify order GID, used by the ERP as idempotency key. */
  externalId: string;
  orderNumber: string;
  companyExternalId: string | null;
  companyLocationId: string | null;
  purchaseOrderNumber: string | null;
  requestedDeliveryDate: string | null;
  costCenter: string | null;
  currency: string;
  subtotal: string;
  createdAt: string;
  lines: ErpOrderLine[];
}

export interface ErpOrderAck {
  erpOrderId: string;
}

/** Port implemented by every ERP adapter. */
export interface ErpClient {
  fetchPriceList(code: string): Promise<ErpPriceList>;
  pushOrder(order: ErpOrder): Promise<ErpOrderAck>;
}
