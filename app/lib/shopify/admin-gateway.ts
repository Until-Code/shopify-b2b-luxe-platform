import { RetryableError, withRetry, type RetryOptions } from "../core/retry";

/**
 * Minimal contract of `admin.graphql` from @shopify/shopify-app-react-router.
 * Depending on this shape (instead of the concrete client) keeps every service
 * unit-testable with a plain fake.
 */
export type GraphqlFn = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "ShopifyGraphqlError";
  }
}

export class ShopifyUserError extends Error {
  constructor(
    readonly operation: string,
    readonly userErrors: UserError[],
  ) {
    super(
      `${operation} failed: ${userErrors
        .map((e) => (e.field?.length ? `${e.field.join(".")}: ` : "") + e.message)
        .join("; ")}`,
    );
    this.name = "ShopifyUserError";
  }
}

interface GraphqlBody<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      throttleStatus: { currentlyAvailable: number; restoreRate: number };
    };
  };
}

/**
 * Thin wrapper around the Admin GraphQL API that:
 *  - retries THROTTLED responses, waiting for the leaky bucket to refill,
 *  - retries transient 5xx / network failures,
 *  - turns top-level GraphQL errors into exceptions.
 */
export class AdminGateway {
  constructor(
    private readonly graphql: GraphqlFn,
    private readonly retry: RetryOptions = {},
  ) {}

  async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return withRetry(async () => {
      let response: Response;
      try {
        response = await this.graphql(query, { variables });
      } catch (error) {
        // The Shopify library throws on non-2xx responses: rethrow 5xx as retryable.
        const status = (error as { response?: { code?: number } })?.response?.code;
        if (status && status >= 500) {
          throw new RetryableError(`Shopify responded ${status}`);
        }
        throw error;
      }

      if (response.status >= 500) {
        throw new RetryableError(`Shopify responded ${response.status}`);
      }

      const body = (await response.json()) as GraphqlBody<T>;

      if (body.errors?.length) {
        const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
        if (throttled) throw new RetryableError("THROTTLED", throttleWaitMs(body));
        throw new ShopifyGraphqlError(body.errors.map((e) => e.message).join("; "), body.errors);
      }
      if (!body.data) throw new ShopifyGraphqlError("Empty GraphQL response", body);

      return body.data;
    }, this.retry);
  }
}

/** How long to wait for enough points to be restored to re-run the query. */
export function throttleWaitMs(body: GraphqlBody<unknown>): number | undefined {
  const cost = body.extensions?.cost;
  if (!cost) return undefined;
  const missing = cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable;
  if (missing <= 0) return 0;
  return Math.ceil((missing / cost.throttleStatus.restoreRate) * 1000);
}

/** Throws a typed error when a mutation payload contains userErrors. */
export function assertNoUserErrors<P extends { userErrors?: UserError[] | null }>(
  operation: string,
  payload: P | null | undefined,
): P {
  if (!payload) throw new ShopifyGraphqlError(`${operation} returned no payload`, null);
  if (payload.userErrors?.length) throw new ShopifyUserError(operation, payload.userErrors);
  return payload;
}
