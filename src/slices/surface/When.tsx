import { formatClock, formatDateTime, formatUtcTimestamp } from "../../lib/dates.ts";

/** A time of day, with its date on hover. `ms` is in milliseconds since the epoch. */
export const When = ({ ms }: { ms: number }) => (
  <time dateTime={formatUtcTimestamp(ms)} title={formatDateTime(ms)}>
    {formatClock(ms)}
  </time>
);
