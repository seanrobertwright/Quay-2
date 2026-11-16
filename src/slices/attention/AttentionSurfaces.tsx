import type { FC } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { UndeliveredAnswerNotice } from "./UndeliveredAnswerNotice.tsx";
import type { AttentionQueueView } from "./useAttentionQueue.ts";

interface AttentionSurfacesProps {
  /** The attention queue the surfaces render and send the operator's actions to. */
  queue: AttentionQueueView;
  terminals: TerminalInfo[];
}

/**
 * What the attention queue shows over the workspace: only the notice for an answer that reached no
 * agent. There is no permission modal; a request waits as a Waiting on you row in the Agents panel
 * and an amber dot on the module bar, and is answered in the companion's Activity view.
 */
export const AttentionSurfaces: FC<AttentionSurfacesProps> = ({ queue, terminals }) =>
  queue.undeliveredAnswer ? (
    <UndeliveredAnswerNotice answer={queue.undeliveredAnswer} terminals={terminals} onDismiss={queue.dismissUndeliveredAnswer} />
  ) : null;
