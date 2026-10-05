import { describe, expect, it } from "vitest";
import {
  MAX_DELIVERY_ATTEMPTS,
  isB2bOrder,
  mapOrderToErp,
  processOutbox,
  type OrderWebhookPayload,
  type OutboxRecord,
  type OutboxRepository,
} from "../app/lib/b2b/order-export";
import { MockErpClient } from "../app/lib/erp/mock-erp-client";
import type { ErpClient } from "../app/lib/erp/types";

const order: OrderWebhookPayload = {
  admin_graphql_api_id: "gid://shopify/Order/5001",
  name: "#1042",
  currency: "EUR",
  subtotal_price: "1740.00",
  created_at: "2026-10-04T09:30:00+02:00",
  po_number: " PO-2026-118 ",
  note_attributes: [
    { name: "Requested delivery date", value: "2026-10-20" },
    { name: "Cost center", value: "LYON-RETAIL" },
  ],
  company: { id: 77, location_id: 88 },
  line_items: [
    { id: 1, sku: "NP-ATP-ALU", quantity: 12, price: "72.50" },
    { id: 2, sku: "TB-MBL-M", quantity: 14, price: "60.00" },
  ],
};

describe("mapOrderToErp", () => {
  it("maps a B2B order with PO number and checkout attributes", () => {
    expect(mapOrderToErp(order)).toEqual({
      externalId: "gid://shopify/Order/5001",
      orderNumber: "#1042",
      companyExternalId: "gid://shopify/Company/77",
      companyLocationId: "gid://shopify/CompanyLocation/88",
      purchaseOrderNumber: "PO-2026-118",
      requestedDeliveryDate: "2026-10-20",
      costCenter: "LYON-RETAIL",
      currency: "EUR",
      subtotal: "1740.00",
      createdAt: "2026-10-04T09:30:00+02:00",
      lines: [
        { sku: "NP-ATP-ALU", quantity: 12, unitPrice: "72.50", shopifyLineId: "gid://shopify/LineItem/1" },
        { sku: "TB-MBL-M", quantity: 14, unitPrice: "60.00", shopifyLineId: "gid://shopify/LineItem/2" },
      ],
    });
  });

  it("refuses lines without SKU (the ERP cannot book them)", () => {
    expect(() =>
      mapOrderToErp({ ...order, line_items: [{ id: 9, sku: null, quantity: 1, price: "1.00" }] }),
    ).toThrow("has no SKU");
  });

  it("only exports B2B orders", () => {
    expect(isB2bOrder(order)).toBe(true);
    expect(isB2bOrder({ ...order, company: null })).toBe(false);
  });
});

function memoryRepository(events: OutboxRecord[]) {
  const state = new Map(
    events.map((e) => [e.id, { ...e, status: "PENDING", nextAttemptAt: new Date(0), error: "" }]),
  );
  const repository: OutboxRepository = {
    due: async (limit, now) =>
      [...state.values()]
        .filter((e) => e.status === "PENDING" && e.nextAttemptAt <= now)
        .slice(0, limit),
    markSent: async (id) => {
      state.get(id)!.status = "SENT";
    },
    markFailed: async (id, update) => {
      Object.assign(state.get(id)!, update, { status: update.dead ? "DEAD" : "PENDING" });
    },
  };
  return { repository, state };
}

const event = (id: string, attempts = 0): OutboxRecord => ({
  id,
  aggregateId: `gid://shopify/Order/${id}`,
  payload: JSON.stringify(mapOrderToErp({ ...order, admin_graphql_api_id: `gid://shopify/Order/${id}` })),
  attempts,
});

describe("processOutbox", () => {
  const now = new Date("2026-10-04T10:00:00Z");

  it("delivers due events to the ERP", async () => {
    const erp = new MockErpClient();
    const { repository, state } = memoryRepository([event("1"), event("2")]);

    expect(await processOutbox(repository, erp, { now: () => now })).toEqual({
      processed: 2,
      sent: 2,
      failed: 0,
      dead: 0,
    });
    expect(erp.receivedOrders.map((o) => o.externalId)).toEqual([
      "gid://shopify/Order/1",
      "gid://shopify/Order/2",
    ]);
    expect([...state.values()].every((e) => e.status === "SENT")).toBe(true);
  });

  it("schedules a retry with exponential backoff when the ERP fails", async () => {
    const failing: ErpClient = {
      fetchPriceList: async () => {
        throw new Error("unused");
      },
      pushOrder: async () => {
        throw new Error("ERP timeout");
      },
    };
    const { repository, state } = memoryRepository([event("1", 2)]);

    const report = await processOutbox(repository, failing, { now: () => now });

    expect(report).toMatchObject({ failed: 1, dead: 0 });
    const stored = state.get("1")!;
    expect(stored).toMatchObject({ status: "PENDING", attempts: 3, error: "ERP timeout" });
    // 3rd attempt failed => next try in 4 minutes.
    expect(stored.nextAttemptAt.getTime() - now.getTime()).toBe(4 * 60_000);
  });

  it("moves an event to the dead letter queue after the last attempt", async () => {
    const { repository, state } = memoryRepository([event("1", MAX_DELIVERY_ATTEMPTS - 1)]);
    const report = await processOutbox(repository, new MockErpClient(1), { now: () => now });
    expect(report.dead).toBe(1);
    expect(state.get("1")!.status).toBe("DEAD");
  });

  it("is idempotent on the ERP side (Idempotency-Key = order GID)", async () => {
    const erp = new MockErpClient();
    await erp.pushOrder(JSON.parse(event("1").payload));
    await erp.pushOrder(JSON.parse(event("1").payload));
    expect(erp.receivedOrders).toHaveLength(1);
  });
});
