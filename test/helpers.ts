import { vi } from "vitest";
import { AdminGateway, type GraphqlFn } from "../app/lib/shopify/admin-gateway";

export interface RecordedCall {
  operation: string;
  variables: Record<string, unknown> | undefined;
}

/**
 * Fake Admin API: routes each request by operation name to a handler returning
 * the GraphQL body. Records every call for assertions.
 */
export function fakeAdmin(handlers: Record<string, (variables: never) => unknown>) {
  const calls: RecordedCall[] = [];
  const graphql: GraphqlFn = vi.fn(async (query, options) => {
    const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
    calls.push({ operation, variables: options?.variables });
    const handler = handlers[operation];
    if (!handler) throw new Error(`Unexpected operation ${operation}`);
    return new Response(JSON.stringify(handler(options?.variables as never)), { status: 200 });
  });
  const gateway = new AdminGateway(graphql, { sleep: async () => {}, random: () => 0 });
  return { gateway, calls, graphql, ops: (name: string) => calls.filter((c) => c.operation === name) };
}
