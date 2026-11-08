import { useEffect, useMemo, useReducer, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Envelope, isSubagentTurn, PermissionResolvedPayload } from "../bridge/useBridgeEvents";
import { PermissionRequestPayload } from "../bridge/PermissionModal";
import { TerminalInfo, TerminalStatusPayload } from "../terminal/types";
import {
  applyAttentionEvent,
  attentionItems,
  emptyAttentionQueue,
  type AttentionItem,
} from "./attentionQueue";
import { onUserInput } from "../terminal/userInput";

/**
 * The attention queue, fed from the backend: permission requests and their resolutions, the
 * bridge's turn events, terminal status, and the user's input to a terminal. It lives in memory
 * only, so an app restart starts it empty; on a webview reload the backend's pending permissions
 * rebuild its permission items.
 *
 * A new turn starting is the bridge's `turn.started` from the terminal's own session (Claude,
 * OpenCode and PiG send it, including for a prompt a peer typed in over A2A), or a
 * `terminal-status` that moves the terminal to Working, for the CLIs that send no turn start
 * (Codex goes Working on its first tool; Antigravity on its own turn report).
 *
 * Returns the waiting items, oldest first.
 */
export function useAttentionQueue(terminals: TerminalInfo[]): AttentionItem[] {
  const [queue, dispatch] = useReducer(applyAttentionEvent, emptyAttentionQueue);

  // Listeners read the project of the terminal an event names at the time it arrives
  const terminalsRef = useRef(terminals);
  terminalsRef.current = terminals;
  const projectOf = (terminalId: string | null | undefined): string | null =>
    terminalsRef.current.find((t) => t.id === terminalId)?.project_path ?? null;

  useEffect(() => {
    invoke<PermissionRequestPayload[]>("get_pending_permissions")
      .then((requests) =>
        dispatch({
          type: "pendingPermissionsLoaded",
          requests: (requests ?? []).map((r) => ({
            requestId: r.requestId,
            terminalId: r.tag ?? null,
            project: projectOf(r.tag),
            tool: r.tool,
          })),
          at: Date.now(),
        })
      )
      .catch(console.error);
  }, []);

  useEffect(() => {
    const unlistens = [
      listen<PermissionRequestPayload>("permission-requested", ({ payload }) =>
        dispatch({
          type: "permissionRequested",
          requestId: payload.requestId,
          terminalId: payload.tag ?? null,
          project: projectOf(payload.tag),
          tool: payload.tool,
          at: Date.now(),
        })
      ),
      listen<PermissionResolvedPayload>("permission-resolved", ({ payload }) =>
        dispatch({ type: "permissionResolved", requestId: payload.requestId })
      ),
      listen<Envelope>("bridge-event", ({ payload: envelope }) => {
        const terminalId = envelope.tag;
        if (!terminalId) return;
        const subagent = isSubagentTurn(envelope);
        if (envelope.type === "turn.completed") {
          dispatch({
            type: "turnCompleted",
            terminalId,
            project: projectOf(terminalId),
            subagent,
            at: Date.now(),
          });
        } else if (envelope.type === "turn.started") {
          dispatch({ type: "turnStarted", terminalId, subagent });
        }
      }),
      listen<TerminalStatusPayload>("terminal-status", ({ payload }) => {
        if (payload.claude_status === "working") {
          dispatch({ type: "turnStarted", terminalId: payload.terminal_id, subagent: false });
        }
      }),
    ];
    const stopInput = onUserInput((terminalId) => dispatch({ type: "userInput", terminalId }));
    return () => {
      stopInput();
      for (const unlisten of unlistens) unlisten.then((stop) => stop());
    };
  }, []);

  return useMemo(() => attentionItems(queue), [queue]);
}
