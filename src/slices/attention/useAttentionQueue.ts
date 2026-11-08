import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Envelope, isSubagentTurn, PermissionResolvedPayload } from "../bridge/useBridgeEvents";
import { PermissionRequestPayload } from "../bridge/PermissionModal";
import { TerminalExitedPayload, TerminalInfo, TerminalStatusPayload } from "../terminal/types";
import {
  applyAttentionEvent,
  attentionItems,
  emptyAttentionQueue,
  type AttentionItem,
  type PendingPermission,
} from "./attentionQueue";
import { onUserInput } from "../terminal/userInput";
import { onTerminalRelaunched } from "../terminal/terminalRelaunched";

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

export interface AttentionQueueState {
  /** Every waiting item, oldest first. */
  items: AttentionItem[];
  /** Clears the terminal's finished turn without acting on it. Its permission requests stay. */
  dismissFinishedTurn: (terminalId: string) => void;
}

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
 * A terminal's items all go when it ends: its process exits (`terminal-exited`), it leaves the
 * terminal list (closed), or the user relaunches it.
 *
 * Returns the waiting items, oldest first, and the action that dismisses a terminal's finished turn.
 */
export function useAttentionQueue(terminals: TerminalInfo[]): AttentionQueueState {
  const [queue, dispatch] = useReducer(applyAttentionEvent, emptyAttentionQueue);

  // Listeners read the project of the terminal an event names at the time it arrives
  const terminalsRef = useRef(terminals);
  terminalsRef.current = terminals;

  // An item queued before its terminal was known (the terminal list loads after the pending
  // permissions on a webview reload) takes its project once the terminal shows up. A terminal
  // gone from the list was closed, whichever way: its own close, its worktree's or its project's.
  const listedIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ids = new Set(terminals.map((t) => t.id));
    for (const id of listedIds.current) {
      if (!ids.has(id)) dispatch({ type: "terminalEnded", terminalId: id });
    }
    listedIds.current = ids;
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
      listen<TerminalExitedPayload>("terminal-exited", ({ payload }) =>
        dispatch({ type: "terminalEnded", terminalId: payload.terminal_id })
      ),
      listen<TerminalStatusPayload>("terminal-status", ({ payload }) => {
        if (payload.claude_status === "working") {
          dispatch({ type: "turnStarted", terminalId: payload.terminal_id, subagent: false });
        }
      }),
    ];
    const stopInput = onUserInput((terminalId) => dispatch({ type: "userInput", terminalId }));
    const stopRelaunched = onTerminalRelaunched((terminalId) =>
      dispatch({ type: "terminalEnded", terminalId })
    );
    return () => {
      stopInput();
      stopRelaunched();
      for (const unlisten of unlistens) unlisten.then((stop) => stop());
    };
  }, []);

  const items = useMemo(() => attentionItems(queue), [queue]);
  const dismissFinishedTurn = useCallback(
    (terminalId: string) => dispatch({ type: "finishedTurnDismissed", terminalId }),
    []
  );
  return { items, dismissFinishedTurn };
}
