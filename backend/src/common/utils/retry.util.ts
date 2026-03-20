import { Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

const logger = new Logger('RetryUtil');

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  retryableStatuses?: number[];
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * Wraps an async function with exponential backoff retry logic.
 * Retries on transient HTTP errors (429, 5xx) up to maxAttempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts, initialDelayMs, retryableStatuses } = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      const axiosErr = error as AxiosError;
      const status = axiosErr?.response?.status;
      const isRetryable = status && retryableStatuses.includes(status);

      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }

      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed with status ${status}. Retrying in ${delay}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
