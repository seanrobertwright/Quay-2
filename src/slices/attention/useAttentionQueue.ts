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
  type PendingPermission,
} from "./attentionQueue";
import { onUserInput } from "../terminal/userInput";

/** The project of the terminal `terminalId` names, or null when `terminals` has no such terminal. */
const projectOf = (terminals: TerminalInfo[], terminalId: string | null | undefined): string | null =>
  terminals.find((t) => t.id === terminalId)?.project_path ?? null;

/** A permission request as the queue takes it, with its terminal's project from `terminals`. */
const toPendingPermission = (
  payload: PermissionRequestPayload,
  terminals: TerminalInfo[]
): PendingPermission => ({
  requestId: payload.requestId,
  terminalId: payload.tag ?? null,
  project: projectOf(terminals, payload.tag),
  tool: payload.tool,
});

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

  // An item queued before its terminal was known (the terminal list loads after the pending
  // permissions on a webview reload) takes its project once the terminal shows up
  useEffect(() => {
    dispatch({
      type: "terminalsKnown",
      terminals: terminals.map((t) => ({ terminalId: t.id, project: t.project_path })),
    });
  }, [terminals]);

  useEffect(() => {
    invoke<PermissionRequestPayload[]>("get_pending_permissions")
      .then((requests) =>
        dispatch({
          type: "pendingPermissionsLoaded",
          requests: (requests ?? []).map((r) => toPendingPermission(r, terminalsRef.current)),
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
          request: toPendingPermission(payload, terminalsRef.current),
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
            project: projectOf(terminalsRef.current, terminalId),
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
