export interface RetryOptions {
  /** Total attempts, including the first one. */
  attempts?: number;
  /** Base delay in ms, doubled on every attempt. */
  baseDelayMs?: number;
  /** Upper bound for a single delay in ms. */
  maxDelayMs?: number;
  /** Decides whether an error is worth another attempt. */
  isRetryable?: (error: unknown) => boolean;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; returns a number in [0, 1). */
  random?: () => number;
}

export class RetryableError extends Error {
  constructor(
    message: string,
    /** Server hint (e.g. Retry-After) that overrides the backoff. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with "full jitter"
 * (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).
 * Only errors accepted by `isRetryable` are retried, everything else fails fast.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  {
    attempts = 4,
    baseDelayMs = 250,
    maxDelayMs = 8_000,
    isRetryable = (error) => error instanceof RetryableError,
    sleep = defaultSleep,
    random = Math.random,
  }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) throw error;

      const hinted =
        error instanceof RetryableError ? error.retryAfterMs : undefined;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(hinted ?? Math.round(random() * backoff));
    }
  }

  throw lastError;
}

/** Delay before the next outbox delivery attempt (1 min, 2 min, 4 min… capped at 6 h). */
export function nextAttemptDelayMs(attempts: number): number {
  const minute = 60_000;
  return Math.min(6 * 60 * minute, minute * 2 ** Math.max(0, attempts - 1));
}
