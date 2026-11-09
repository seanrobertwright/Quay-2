import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  type Envelope,
  isSubagentTurn,
  type PermissionRequestPayload,
  type PermissionResolvedPayload,
} from "../bridge/useBridgeEvents.ts";
import type { TerminalExitedPayload, TerminalInfo, TerminalStatusPayload } from "../terminal/types.ts";
import {
  applyAttentionEvent,
  attentionItems,
  emptyAttentionQueue,
  modalPermissions,
  pendingPermissionIds,
  type AttentionItem,
  type PendingPermission,
  type PermissionItem,
  type UndeliveredAnswer,
  undeliveredAnswer,
} from "./attentionQueue.ts";
import { onUserInput } from "../terminal/userInput.ts";
import { onTerminalRelaunched } from "../terminal/terminalRelaunched.ts";

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
  input: payload.input,
  reason: payload.reason,
});

/** The reason a denial sends the agent when the user gave none. */
const DENIED_WITHOUT_REASON = "User rejected tool execution";

/**
 * Sends the user's answer to permission request `requestId`. A denial with no `reason` tells the
 * agent the user rejected the tool.
 */
export type AnswerPermission = (
  requestId: string,
  decision: "allow" | "deny",
  reason?: string,
  rememberForSession?: boolean
) => Promise<void>;

export interface AttentionQueueView {
  /** Every waiting item, oldest first. */
  items: AttentionItem[];
  /** The permission requests the permission modal shows, oldest first; none when it is closed. */
  modalPermissions: PermissionItem[];
  /** The ids of every permission request still waiting, deferred or not, oldest first. */
  pendingPermissionIds: string[];
  /** Puts `requestIds` off with Later: they leave the modal and stay in the queue. */
  deferPermissions: (requestIds: readonly string[]) => void;
  /** Shows deferred `requestIds` in the permission modal again. */
  reopenPermissions: (requestIds: readonly string[]) => void;
  /**
   * Sends the user's answer to the backend and clears the request once the backend takes it. When
   * the backend refuses it because no agent is waiting for that answer any more, the request
   * clears too, and `undeliveredAnswer` tells the user.
   */
  answerPermission: AnswerPermission;
  /** The latest answer that reached no agent, for the app to tell the user; null when none. */
  undeliveredAnswer: UndeliveredAnswer | null;
  /** Closes the notice about the answer that reached no agent. */
  dismissUndeliveredAnswer: () => void;
  /** Clears the terminal's finished turn without acting on it. Its permission requests stay. */
  dismissFinishedTurn: (terminalId: string) => void;
}

/**
 * The attention queue, fed from the backend: permission requests and their resolutions, the
 * bridge's turn events, terminal status, and the user's input to a terminal. It lives in memory
 * only, so an app restart starts it empty; on a webview reload the backend's pending permissions
 * rebuild its permission items. Which requests were put off with Later is not kept across a
 * reload, so the rebuilt requests show in the permission modal again.
 *
 * A new turn starting is the bridge's `turn.started` from the terminal's own session (Claude,
 * OpenCode and PiG send it, including for a prompt a peer typed in over A2A), or a
 * `terminal-status` that moves the terminal to Working, for the CLIs that send no turn start
 * (Codex goes Working on its first tool; Antigravity on its own turn report).
 *
 * A terminal's items all go when it ends: its process exits (`terminal-exited`), it leaves the
 * terminal list (closed), or the user relaunches it.
 *
 * Returns the waiting items, the requests the permission modal shows, the ids of every pending
 * request, the latest answer that reached no agent, and the user's actions on them, including
 * dismissing a terminal's finished turn.
 */
export function useAttentionQueue(terminals: TerminalInfo[]): AttentionQueueView {
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

  const deferPermissions = useCallback(
    (requestIds: readonly string[]) => dispatch({ type: "permissionsDeferred", requestIds }),
    []
  );
  const reopenPermissions = useCallback(
    (requestIds: readonly string[]) => dispatch({ type: "permissionsReopened", requestIds }),
    []
  );
  const answerPermission = useCallback<AnswerPermission>(
    async (requestId, decision, reason, rememberForSession = false) => {
      try {
        await invoke("resolve_permission", {
          requestId,
          decision,
          reason: reason?.trim() || (decision === "deny" ? DENIED_WITHOUT_REASON : null),
          rememberForSession,
        });
        dispatch({ type: "permissionResolved", requestId });
      } catch (err) {
        // The backend refuses an answer only when no agent waits for it, so the request is gone
        dispatch({ type: "permissionAnswerUndelivered", requestId, error: String(err) });
      }
    },
    []
  );

  const dismissUndeliveredAnswer = useCallback(
    () => dispatch({ type: "undeliveredAnswerDismissed" }),
    []
  );

  const dismissFinishedTurn = useCallback(
    (terminalId: string) => dispatch({ type: "finishedTurnDismissed", terminalId }),
    []
  );

  const items = useMemo(() => attentionItems(queue), [queue]);
  const modal = useMemo(() => modalPermissions(queue), [queue]);
  const pending = useMemo(() => pendingPermissionIds(queue), [queue]);
  return {
    items,
    modalPermissions: modal,
    pendingPermissionIds: pending,
    deferPermissions,
    reopenPermissions,
    answerPermission,
    undeliveredAnswer: undeliveredAnswer(queue),
    dismissUndeliveredAnswer,
    dismissFinishedTurn,
  };
}
