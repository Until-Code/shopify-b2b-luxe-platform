import { RetryableError, withRetry } from "../core/retry";
import type { ErpClient, ErpOrder, ErpOrderAck, ErpPriceList } from "./types";

export interface HttpErpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * REST adapter for an ERP / middleware (e.g. SAP CPI, MuleSoft) exposing:
 *   GET  /price-lists/:code
 *   POST /orders            (Idempotency-Key header = Shopify order GID)
 */
export class HttpErpClient implements ErpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpErpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  fetchPriceList(code: string): Promise<ErpPriceList> {
    return this.call<ErpPriceList>(`/price-lists/${encodeURIComponent(code)}`, {
      method: "GET",
    });
  }

  pushOrder(order: ErpOrder): Promise<ErpOrderAck> {
    return this.call<ErpOrderAck>("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": order.externalId },
      body: JSON.stringify(order),
    });
  }

  private call<T>(path: string, init: RequestInit): Promise<T> {
    return withRetry(async () => {
      const response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      }).catch((error: unknown) => {
        // Network failures and timeouts are transient by nature.
        throw new RetryableError(`ERP unreachable: ${(error as Error).message}`);
      });

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        throw new RetryableError(
          `ERP responded ${response.status}`,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        );
      }
      if (!response.ok) {
        throw new Error(`ERP responded ${response.status}: ${await response.text()}`);
      }
      return (await response.json()) as T;
    });
  }
}
