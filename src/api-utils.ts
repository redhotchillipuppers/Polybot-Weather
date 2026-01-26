// API utility functions for error handling and retry logic

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
  const delayWithJitter = exponentialDelay * (0.5 + Math.random() * 0.5); // Add 0-50% jitter
  return Math.min(delayWithJitter, options.maxDelayMs);
}

/**
 * Check if an error is a rate limit (429) error
 */
function isRateLimitError(response: Response): boolean {
  return response.status === 429;
}

/**
 * Check if an error is retryable (rate limits, server errors, network issues)
 */
function isRetryableError(response: Response): boolean {
  // Retry on rate limits (429) and server errors (5xx)
  return response.status === 429 || (response.status >= 500 && response.status < 600);
}

/**
 * Fetch with retry logic and exponential backoff
 * Specifically handles 429 rate limit errors with appropriate delays
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: RetryOptions
): Promise<Response> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If response is OK, return it
      if (response.ok) {
        return response;
      }

      // Check if we should retry
      if (isRetryableError(response) && attempt < opts.maxRetries) {
        const delay = calculateDelay(attempt, opts);

        if (isRateLimitError(response)) {
          // For rate limits, check for Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
          console.warn(
            `Rate limited (429). Attempt ${attempt + 1}/${opts.maxRetries + 1}. ` +
            `Retrying in ${Math.round(retryAfterMs / 1000)}s...`
          );
          await sleep(retryAfterMs);
        } else {
          console.warn(
            `Request failed with status ${response.status}. Attempt ${attempt + 1}/${opts.maxRetries + 1}. ` +
            `Retrying in ${Math.round(delay / 1000)}s...`
          );
          await sleep(delay);
        }
        continue;
      }

      // Non-retryable error or max retries reached, return the response
      // Let the caller handle the error response
      return response;

    } catch (error) {
      // Network errors (connection refused, timeout, etc.)
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < opts.maxRetries) {
        const delay = calculateDelay(attempt, opts);
        console.warn(
          `Network error: ${lastError.message}. Attempt ${attempt + 1}/${opts.maxRetries + 1}. ` +
          `Retrying in ${Math.round(delay / 1000)}s...`
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error('Request failed after all retries');
}

/**
 * Safely get a string value, returning a default if null/undefined
 */
export function safeString(value: unknown, defaultValue: string = 'N/A'): string {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  return String(value);
}

/**
 * Safely get a number value, returning a default if null/undefined/NaN
 */
export function safeNumber(value: unknown, defaultValue: number = 0): number {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Safely get an array, returning empty array if null/undefined
 */
export function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Safely parse JSON with a default value on failure
 */
export function safeJsonParse<T>(jsonString: string, defaultValue: T): T {
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Format an error for logging (handles both Error objects and unknown types)
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Log an error without crashing - returns false to indicate failure
 */
export function logError(context: string, error: unknown): false {
  console.error(`[${context}] Error: ${formatError(error)}`);
  return false;
}
