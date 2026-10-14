import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { PermissionRequestPayload } from "./PermissionModal";
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

export interface PermissionResolvedPayload {
  requestId: string;
  decision: string;
  tool: string;
  tag?: string;
}

export function useBridgeEvents() {
  const [events, setEvents] = useState<Envelope[]>([]);
  const [activeTools, setActiveTools] = useState<Record<string, string | null>>({});
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequestPayload[]>([]);

  // Fetch initial pending permissions
  useEffect(() => {
    invoke<PermissionRequestPayload[]>("get_pending_permissions")
      .then((reqs) => {
        if (reqs && reqs.length > 0) {
          setPendingPermissions(reqs);
        }
      })
      .catch(console.error);
  }, []);

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
        } else if (envelope.type === "tool.finished" || envelope.type === "turn.completed") {
          setActiveTools((prev) => ({ ...prev, [tag]: null }));
        }
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Listen for permission requests and resolutions
  useEffect(() => {
    const unlistenReqPromise = listen<PermissionRequestPayload>(
      "permission-requested",
      (event) => {
        const payload = event.payload;
        playAttentionChime();
        setPendingPermissions((prev) => {
          if (prev.some((p) => p.requestId === payload.requestId)) return prev;
          return [...prev, payload];
        });
      }
    );

    const unlistenResPromise = listen<PermissionResolvedPayload>(
      "permission-resolved",
      (event) => {
        const { requestId } = event.payload;
        setPendingPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
      }
    );

    return () => {
      unlistenReqPromise.then((unlisten) => unlisten());
      unlistenResPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Resolve a permission request
  const resolvePermission = useCallback(
    async (
      requestId: string,
      decision: "allow" | "deny",
      reason?: string,
      rememberForSession: boolean = false
    ) => {
      try {
        await invoke("resolve_permission", {
          requestId,
          decision,
          reason: reason || null,
          rememberForSession,
        });
        setPendingPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
      } catch (err) {
        console.error("Failed to resolve permission:", err);
      }
    },
    []
  );

  const getTerminalEvents = (terminalId: string | null) => {
    if (!terminalId) return [];
    return events.filter((e) => e.tag === terminalId);
  };

  return {
    events,
    activeTools,
    pendingPermissions,
    resolvePermission,
    getTerminalEvents,
  };
}
