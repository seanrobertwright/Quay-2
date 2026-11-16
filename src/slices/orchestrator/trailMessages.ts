import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TrailStatus } from "./trailEntry.ts";

/** One message on the A2A bus's trail, as the backend's `A2AMessage` sends it. */
export interface TrailMessage {
  id: string;
  /** The sending terminal's id, or `user` for a message the operator sent. */
  from_terminal: string;
  to_terminal: string;
  from_name?: string | null;
  to_name?: string | null;
  content: string;
  as_user: boolean;
  broadcast?: boolean;
  waited?: boolean;
  /** When the message was sent, in epoch milliseconds. */
  timestamp: number;
  delivered_at?: number | null;
  completed_at?: number | null;
  status: TrailStatus;
  /** The peer's reply or answer, once it gave one. */
  response?: string | null;
  note?: string | null;
}

/** The most trail messages the app keeps, newest first; the oldest drop past it. */
export const TRAIL_LIMIT = 500;

/**
 * The A2A bus's message trail, newest first, at most {@link TRAIL_LIMIT} messages: loaded once,
 * then kept current from the backend's `a2a-message-updated` and `a2a-messages-cleared` events.
 */
export function useTrailMessages(): TrailMessage[] {
  const [messages, setMessages] = useState<TrailMessage[]>([]);
  useEffect(() => {
    let current = true;
    invoke<TrailMessage[]>("a2a_get_messages")
      .then((loaded) => {
        if (current) setMessages((loaded ?? []).slice(0, TRAIL_LIMIT));
      })
      .catch((err) => console.error("Failed to load the A2A message trail:", err));
    const updated = listen<TrailMessage>("a2a-message-updated", ({ payload }) =>
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === payload.id);
        if (index < 0) return [payload, ...prev].slice(0, TRAIL_LIMIT);
        const next = [...prev];
        next[index] = payload;
        return next;
      }),
    );
    const cleared = listen("a2a-messages-cleared", () => setMessages([]));
    return () => {
      current = false;
      void updated.then((stop) => stop());
      void cleared.then((stop) => stop());
    };
  }, []);
  return messages;
}
