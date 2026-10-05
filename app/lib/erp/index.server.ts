import { HttpErpClient } from "./http-erp-client";
import { MockErpClient } from "./mock-erp-client";
import type { ErpClient } from "./types";

let client: ErpClient | undefined;

/** Adapter selection is a deployment concern: ERP_MODE=http in production. */
export function getErpClient(): ErpClient {
  if (client) return client;

  if (process.env.ERP_MODE === "http") {
    const baseUrl = process.env.ERP_BASE_URL;
    const apiKey = process.env.ERP_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error("ERP_MODE=http requires ERP_BASE_URL and ERP_API_KEY");
    }
    client = new HttpErpClient({ baseUrl, apiKey });
  } else {
    client = new MockErpClient(Number(process.env.ERP_MOCK_FAILURE_RATE ?? 0));
  }
  return client;
}

export { MockErpClient };
export type * from "./types";
