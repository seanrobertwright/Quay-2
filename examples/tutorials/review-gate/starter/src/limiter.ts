export type LimiterOptions = { limit: number; windowMs: number; now: () => number };
export type Decision = { allowed: boolean; remaining: number; retryAfterMs: number };
export type Limiter = { check(key: string): Decision };

export function createLimiter(options: LimiterOptions): Limiter {
  throw new Error("not implemented");
}
