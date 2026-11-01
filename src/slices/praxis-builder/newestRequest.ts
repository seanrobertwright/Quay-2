// The request-id guard for the Runs view's polled reads (#362, #452): each read gets a request
// id, and only the newest read's answer is kept, so a slow answer never replaces a newer one.

export interface NewestRequest {
  /** Starts a request, returning its id. Every request asked before it is now stale. */
  begin(): number;
  /** True when request `id` is still the newest, so its answer may be kept. */
  isNewest(id: number): boolean;
  /** Makes every request asked so far stale, as when its view leaves the screen. */
  drop(): void;
}

export function createNewestRequest(): NewestRequest {
  let newest = 0;
  return {
    begin: () => ++newest,
    isNewest: (id) => id === newest,
    drop: () => void (newest += 1),
  };
}
