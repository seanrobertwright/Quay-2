import { useState, type FC } from "react";
import { PermissionModal } from "./PermissionModal.tsx";
import type { TerminalInfo } from "../terminal/types.ts";
import type { Project } from "../workspace/types.ts";
import type { GitWorktree } from "../git/types.ts";
import { AttentionDrawer } from "./AttentionDrawer.tsx";
import { UndeliveredAnswerNotice } from "./UndeliveredAnswerNotice.tsx";
import type { AttentionQueueView } from "./useAttentionQueue.ts";

interface AttentionSurfacesProps {
  /** The attention queue the surfaces render and send the user's actions to. */
  queue: AttentionQueueView;
  terminals: TerminalInfo[];
  projects: Project[];
  projectWorktrees: Record<string, GitWorktree[]>;
  isDrawerOpen: boolean;
  onCloseDrawer: () => void;
  /** Focuses the terminal, switching to its project or worktree when it is in another. */
  onFocusTerminal: (terminalId: string) => void;
}

/**
 * Everything the attention queue shows over the workspace: the permission modal, open while the
 * queue holds a request not put off with Later; the notice for an answer that reached no agent;
 * and the attention drawer. Choosing a deferred request's drawer row reopens the modal on it.
 */
export const AttentionSurfaces: FC<AttentionSurfacesProps> = ({
  queue,
  terminals,
  projects,
  projectWorktrees,
  isDrawerOpen,
  onCloseDrawer,
  onFocusTerminal,
}) => {
  // The request the user last reopened from its drawer row, for the permission modal to move to.
  // A new object each time, so choosing the same row again moves the modal back to it.
  const [reopened, setReopened] = useState<{ requestId: string } | null>(null);

  return (
    <>
      {queue.modalPermissions.length > 0 && (
        <PermissionModal
          pendingRequests={queue.modalPermissions}
          showRequest={reopened}
          terminals={terminals}
          onResolve={queue.answerPermission}
          onLater={() => queue.deferPermissions(queue.modalPermissions.map((request) => request.requestId))}
        />
      )}

      {queue.undeliveredAnswer && (
        <UndeliveredAnswerNotice
          answer={queue.undeliveredAnswer}
          terminals={terminals}
          onDismiss={queue.dismissUndeliveredAnswer}
        />
      )}

      <AttentionDrawer
        isOpen={isDrawerOpen}
        items={queue.items}
        terminals={terminals}
        projects={projects}
        projectWorktrees={projectWorktrees}
        onClose={onCloseDrawer}
        onFocusTerminal={(terminalId) => {
          onCloseDrawer();
          onFocusTerminal(terminalId);
        }}
        onDismissFinishedTurn={queue.dismissFinishedTurn}
        onAnswerPermission={queue.answerPermission}
        droppedPermissionCount={queue.droppedPermissionCount}
        onReopenPermission={(requestId) => {
          queue.reopenPermissions([requestId]);
          setReopened({ requestId });
          onCloseDrawer();
        }}
      />
    </>
  );
};
