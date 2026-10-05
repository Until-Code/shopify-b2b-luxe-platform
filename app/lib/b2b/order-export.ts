import { nextAttemptDelayMs } from "../core/retry";
import type { ErpClient, ErpOrder } from "../erp/types";

/** Subset of the `orders/create` webhook payload (REST representation). */
export interface OrderWebhookPayload {
  admin_graphql_api_id: string;
  name: string;
  currency: string;
  subtotal_price: string;
  created_at: string;
  po_number?: string | null;
  note_attributes?: Array<{ name: string; value: string }>;
  company?: { id: number; location_id: number } | null;
  line_items: Array<{
    id: number;
    sku: string | null;
    quantity: number;
    price: string;
  }>;
}

/** Cart attributes written by the b2b-checkout-details checkout UI extension. */
export const CHECKOUT_ATTRIBUTES = {
  requestedDeliveryDate: "Requested delivery date",
  costCenter: "Cost center",
} as const;

export const ORDER_EXPORT_TOPIC = "order.export";
export const MAX_DELIVERY_ATTEMPTS = 8;

export function isB2bOrder(order: OrderWebhookPayload): boolean {
  return Boolean(order.company?.id);
}

/** Pure mapping, unit tested: Shopify order -> canonical ERP order. */
export function mapOrderToErp(order: OrderWebhookPayload): ErpOrder {
  const attribute = (name: string) =>
    order.note_attributes?.find((a) => a.name === name)?.value?.trim() || null;

  return {
    externalId: order.admin_graphql_api_id,
    orderNumber: order.name,
    companyExternalId: order.company ? `gid://shopify/Company/${order.company.id}` : null,
    companyLocationId: order.company
      ? `gid://shopify/CompanyLocation/${order.company.location_id}`
      : null,
    purchaseOrderNumber: order.po_number?.trim() || null,
    requestedDeliveryDate: attribute(CHECKOUT_ATTRIBUTES.requestedDeliveryDate),
    costCenter: attribute(CHECKOUT_ATTRIBUTES.costCenter),
    currency: order.currency,
    subtotal: order.subtotal_price,
    createdAt: order.created_at,
    lines: order.line_items.map((line) => {
      if (!line.sku) throw new Error(`Line ${line.id} of ${order.name} has no SKU`);
      return {
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.price,
        shopifyLineId: `gid://shopify/LineItem/${line.id}`,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Outbox processing. The repository is injected so the algorithm is testable
// without a database (see order-export.test.ts).
// ---------------------------------------------------------------------------

export interface OutboxRecord {
  id: string;
  aggregateId: string;
  payload: string;
  attempts: number;
}

export interface OutboxRepository {
  /** Claims up to `limit` due events. */
  due(limit: number, now: Date): Promise<OutboxRecord[]>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, update: { attempts: number; nextAttemptAt: Date; error: string; dead: boolean }): Promise<void>;
}

export interface OutboxRunReport {
  processed: number;
  sent: number;
  failed: number;
  dead: number;
}

export async function processOutbox(
  repository: OutboxRepository,
  erp: ErpClient,
  { limit = 25, now = () => new Date() } = {},
): Promise<OutboxRunReport> {
  const report: OutboxRunReport = { processed: 0, sent: 0, failed: 0, dead: 0 };

  for (const event of await repository.due(limit, now())) {
    report.processed++;
    try {
      await erp.pushOrder(JSON.parse(event.payload) as ErpOrder);
      await repository.markSent(event.id);
      report.sent++;
    } catch (error) {
      const attempts = event.attempts + 1;
      const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
      await repository.markFailed(event.id, {
        attempts,
        dead,
        error: error instanceof Error ? error.message : String(error),
        nextAttemptAt: new Date(now().getTime() + nextAttemptDelayMs(attempts)),
      });
      if (dead) report.dead++;
      else report.failed++;
    }
  }
  return report;
}
