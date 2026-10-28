export interface RetryOptions {
  attempts: number;
  delayMs?: number;
  backoff?: number;
  retryable?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, delayMs = 0, backoff = 2, retryable = true } = options;
  if (attempts < 1) {
    throw new RangeError(`attempts must be at least 1, got ${attempts}`);
  }

  let lastError: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn(i + 1);
    } catch (error) {
      lastError = error;
      if (!retryable) {
        throw error;
      }
      await sleep(delayMs * backoff ** i);
    }
  }
  throw lastError;
}
