import priceLists from "./fixtures/price-lists.json";
import type { ErpClient, ErpOrder, ErpOrderAck, ErpPriceList } from "./types";

export class ErpNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found in ERP`);
    this.name = "ErpNotFoundError";
  }
}

/**
 * In-memory ERP used for local development and demos.
 * `failureRate` simulates an unreliable ERP so the outbox retries can be observed.
 */
export class MockErpClient implements ErpClient {
  readonly receivedOrders: ErpOrder[] = [];

  constructor(
    private readonly failureRate = 0,
    private readonly random: () => number = Math.random,
  ) {}

  async fetchPriceList(code: string): Promise<ErpPriceList> {
    const list = (priceLists as Record<string, ErpPriceList>)[code];
    if (!list) throw new ErpNotFoundError(`Price list ${code}`);
    return structuredClone(list);
  }

  async pushOrder(order: ErpOrder): Promise<ErpOrderAck> {
    if (this.random() < this.failureRate) {
      throw new Error("Simulated ERP outage (ERP_MOCK_FAILURE_RATE)");
    }
    const existing = this.receivedOrders.findIndex((o) => o.externalId === order.externalId);
    if (existing === -1) this.receivedOrders.push(order);
    return { erpOrderId: `SO-${order.orderNumber.replace(/\D/g, "").padStart(8, "0")}` };
  }

  static availablePriceLists(): string[] {
    return Object.keys(priceLists);
  }
}
