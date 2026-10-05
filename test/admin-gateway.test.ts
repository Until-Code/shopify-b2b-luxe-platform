import { describe, expect, it, vi } from "vitest";
import {
  AdminGateway,
  ShopifyGraphqlError,
  ShopifyUserError,
  assertNoUserErrors,
  throttleWaitMs,
} from "../app/lib/shopify/admin-gateway";
import { RetryableError, withRetry } from "../app/lib/core/retry";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const throttled = {
  errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
  extensions: {
    cost: { requestedQueryCost: 500, throttleStatus: { currentlyAvailable: 100, restoreRate: 100 } },
  },
};

describe("AdminGateway", () => {
  it("waits for the bucket to refill and retries THROTTLED requests", async () => {
    const sleep = vi.fn(async () => {});
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(json(throttled))
      .mockResolvedValueOnce(json({ data: { shop: { name: "Northpeak" } } }));

    const gateway = new AdminGateway(graphql, { sleep });
    await expect(gateway.request("query Shop { shop { name } }")).resolves.toEqual({
      shop: { name: "Northpeak" },
    });
    // 400 missing points at 100 points/s => 4 s.
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it("retries 5xx responses then gives up", async () => {
    const graphql = vi.fn().mockResolvedValue(json({}, 503));
    const gateway = new AdminGateway(graphql, { sleep: async () => {}, attempts: 3 });
    await expect(gateway.request("query Q { shop { id } }")).rejects.toBeInstanceOf(RetryableError);
    expect(graphql).toHaveBeenCalledTimes(3);
  });

  it("does not retry invalid queries", async () => {
    const graphql = vi.fn().mockResolvedValue(json({ errors: [{ message: "Field 'x' doesn't exist" }] }));
    const gateway = new AdminGateway(graphql, { sleep: async () => {} });
    await expect(gateway.request("query Q { x }")).rejects.toBeInstanceOf(ShopifyGraphqlError);
    expect(graphql).toHaveBeenCalledTimes(1);
  });
});

describe("throttleWaitMs", () => {
  it("is 0 when enough points are available", () => {
    expect(
      throttleWaitMs({
        extensions: {
          cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 50, restoreRate: 100 } },
        },
      }),
    ).toBe(0);
  });
});

describe("assertNoUserErrors", () => {
  it("formats field paths", () => {
    expect(() =>
      assertNoUserErrors("companyCreate", {
        userErrors: [{ field: ["input", "company", "name"], message: "is too long" }],
      }),
    ).toThrow(new ShopifyUserError("companyCreate", [{ field: ["input", "company", "name"], message: "is too long" }]));
  });
});

describe("withRetry", () => {
  it("uses full-jitter exponential backoff", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const operation = vi.fn().mockRejectedValue(new RetryableError("boom"));
    await expect(
      withRetry(operation, { attempts: 4, baseDelayMs: 100, sleep, random: () => 0.5 }),
    ).rejects.toThrow("boom");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50, 100, 200]);
  });
});
