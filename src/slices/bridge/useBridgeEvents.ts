import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

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

export function useBridgeEvents() {
  const [events, setEvents] = useState<Envelope[]>([]);
  const [activeTools, setActiveTools] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const unlistenPromise = listen<Envelope>("bridge-event", (event) => {
      const envelope = event.payload;
      setEvents((prev) => [envelope, ...prev.slice(0, 500)]);

      const tag = envelope.tag;
      if (tag) {
        if (envelope.type === "tool.started") {
          const tool = envelope.data?.tool || "Tool";
          setActiveTools((prev) => ({ ...prev, [tag]: tool }));
        } else if (envelope.type === "tool.finished" || envelope.type === "turn.completed") {
          setActiveTools((prev) => ({ ...prev, [tag]: null }));
        }
      }
    });

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
