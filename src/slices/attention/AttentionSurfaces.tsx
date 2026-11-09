import type { FC } from "react";
import { PermissionModal } from "../bridge/PermissionModal.tsx";
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
 * and the attention drawer.
 */
export const AttentionSurfaces: FC<AttentionSurfacesProps> = ({
  queue,
  terminals,
  projects,
  projectWorktrees,
  isDrawerOpen,
  onCloseDrawer,
  onFocusTerminal,
}) => (
  <>
    {queue.modalPermissions.length > 0 && (
      <PermissionModal
        pendingRequests={queue.modalPermissions}
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
    />
  </>
);
