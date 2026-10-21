export type TrailStatus = "queued" | "dispatched" | "completed" | "failed";

/** What the trail labels a peer's response: a Reply when someone waited on it, an Answer
 *  when nobody did (a no-wait `quay_send_message`, a broadcast, or a wait that ran out). */
export function responseLabel(entry: { waited?: boolean }): "Reply" | "Answer" {
  return entry.waited ? "Reply" : "Answer";
}

/** An entry's timer: a Dispatched entry counts up from delivery (`running`) while Quay can
 *  see its target's turn end (`seesTurnEnd`), and a Completed one shows how long its turn
 *  took. A Queued or Failed entry, one with no recorded delivery, or a Dispatched one whose
 *  turn end Quay can't see, has none. Times are epoch milliseconds. */
export function entryTimer(
  entry: { status: TrailStatus; delivered_at?: number | null; completed_at?: number | null },
  now: number,
  seesTurnEnd: boolean,
): { running: boolean; ms: number } | null {
  if (entry.delivered_at == null) return null;
  if (entry.status === "dispatched" && seesTurnEnd) {
    return { running: true, ms: Math.max(0, now - entry.delivered_at) };
  }
  if (entry.status === "completed" && entry.completed_at != null) {
    return { running: false, ms: Math.max(0, entry.completed_at - entry.delivered_at) };
  }
  return null;
}
