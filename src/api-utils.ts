// Shared API utilities for error handling and retry logic

/**
 * Options for fetch with retry
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryOn429?: boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  retryOn429: true,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential backoff: initialDelay * 2^attempt
  const exponentialDelay = initialDelayMs * Math.pow(2, attempt);
  // Add jitter (0-25% of delay)
  const jitter = exponentialDelay * Math.random() * 0.25;
  // Cap at max delay
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Check if an error is a rate limit (429) error
 */
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('429') || error.message.toLowerCase().includes('rate limit');
  }
  return false;
}

/**
 * Check if a response status indicates a retryable error
 */
function isRetryableStatus(status: number): boolean {
  // 429 = Too Many Requests (rate limit)
  // 500, 502, 503, 504 = Server errors
  return status === 429 || (status >= 500 && status <= 504);
}

/**
 * Fetch with automatic retry and exponential backoff for rate limits and transient errors
 * Logs errors but doesn't crash - returns null on failure after all retries
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: RetryOptions
): Promise<Response | null> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Check if we should retry based on status
      if (!response.ok && isRetryableStatus(response.status)) {
        const isRateLimit = response.status === 429;

        if (attempt < opts.maxRetries) {
          // For 429, check Retry-After header
          let delayMs: number;
          if (isRateLimit && opts.retryOn429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              // Retry-After can be seconds or a date
              const retryAfterSeconds = parseInt(retryAfter, 10);
              if (!isNaN(retryAfterSeconds)) {
                delayMs = retryAfterSeconds * 1000;
              } else {
                // Try parsing as date
                const retryDate = new Date(retryAfter);
                delayMs = Math.max(0, retryDate.getTime() - Date.now());
              }
            } else {
              delayMs = calculateBackoffDelay(attempt, opts.initialDelayMs, opts.maxDelayMs);
            }
          } else {
            delayMs = calculateBackoffDelay(attempt, opts.initialDelayMs, opts.maxDelayMs);
          }

          const errorMsg = `HTTP ${response.status}${isRateLimit ? ' (rate limit)' : ''}`;
          console.log(`  API request failed (${errorMsg}), retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${opts.maxRetries})...`);

          if (opts.onRetry) {
            opts.onRetry(attempt + 1, new Error(errorMsg), delayMs);
          }

          await sleep(delayMs);
          continue;
        }
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Network errors or other fetch failures - retry with backoff
      if (attempt < opts.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt, opts.initialDelayMs, opts.maxDelayMs);
        console.log(`  API request failed (${lastError.message}), retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${opts.maxRetries})...`);

        if (opts.onRetry) {
          opts.onRetry(attempt + 1, lastError, delayMs);
        }

        await sleep(delayMs);
        continue;
      }
    }
  }

  // All retries exhausted
  console.error(`  API request failed after ${opts.maxRetries} retries: ${lastError?.message ?? 'Unknown error'}`);
  return null;
}

/**
 * Safe JSON parse that returns null on failure
 */
export function safeJsonParse<T>(json: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safely get a nested property from an object, returning null if not found
 */
export function safeGet<T>(obj: unknown, path: string, fallback: T | null = null): T | null {
  try {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return fallback;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return (current ?? fallback) as T | null;
  } catch {
    return fallback;
  }
}

/**
 * Format a value for logging, handling null/undefined gracefully
 */
export function formatForLog(value: unknown, fallback: string = 'N/A'): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'number') {
    return isNaN(value) ? fallback : String(value);
  }
  if (typeof value === 'string') {
    return value || fallback;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

/**
 * Safely extract an error message from an unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

/**
 * Wrap an async function with try-catch that logs but doesn't crash
 * Returns the result or null on error
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`  Error in ${context}: ${getErrorMessage(error)}`);
    return null;
  }
}
