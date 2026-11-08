import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { playAttentionChime } from "../metrics/audioChime";

export interface Envelope {
  v: number;
  boot: string;
  seq: number;
  ts: number;
  sessionId: string;
  tag?: string;
  type: string;
  data: any;
}

/** Whether `envelope` is a subagent's turn event. The plugin reports a subagent's turns
 * with an `agentId`; they say nothing about the terminal's own turn. */
export function isSubagentTurn(envelope: Envelope): boolean {
  return envelope.type.startsWith("turn.") && Boolean(envelope.data?.agentId);
}

/** A permission request as the backend sends it in `permission-requested` and `get_pending_permissions`. */
export interface PermissionRequestPayload {
  requestId: string;
  sessionId: string;
  tag?: string;
  tool: string;
  input: any;
  reason?: string;
}

export interface PermissionResolvedPayload {
  requestId: string;
  decision: string;
  tool: string;
  tag?: string;
}

export function useBridgeEvents() {
  const [events, setEvents] = useState<Envelope[]>([]);
  const [activeTools, setActiveTools] = useState<Record<string, string | null>>({});

  // Listen for bridge events
  useEffect(() => {
    const unlistenPromise = listen<Envelope>("bridge-event", (event) => {
      const envelope = event.payload;
      setEvents((prev) => [envelope, ...prev.slice(0, 500)]);

      const tag = envelope.tag;
      if (tag) {
        if (envelope.type === "tool.started") {
          const tool = envelope.data?.tool || "Tool";
          setActiveTools((prev) => ({ ...prev, [tag]: tool }));
        } else if (
          envelope.type === "tool.finished" ||
          (envelope.type === "turn.completed" && !isSubagentTurn(envelope))
        ) {
          setActiveTools((prev) => ({ ...prev, [tag]: null }));
        }
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // A permission request plays the attention chime. The attention queue holds the request.
  useEffect(() => {
    const unlistenPromise = listen("permission-requested", () => playAttentionChime());
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const getTerminalEvents = (terminalId: string | null) => {
    if (!terminalId) return [];
    return events.filter((e) => e.tag === terminalId);
  };

  return {
    events,
    activeTools,
    getTerminalEvents,
  };
}
