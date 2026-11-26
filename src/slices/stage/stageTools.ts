// What the stage's tab tools are. It imports no slice, so that what makes a tool need not import the stage.
import type { ReactNode } from "react";

/** A full-stage tool, such as the swarm builder, with its own stage tab. */
export interface StageToolTab {
  id: string;
  label: string;
  /** What names it for a screen reader and on hover, when that is more than its label. */
  name?: string;
  /** Who it is from, shown small after its label, such as the terminal of a surface. Its name says it too. */
  from?: string;
  /** Whether it waits for the operator: its icon pulses until it is in front. */
  waits?: boolean;
  icon: ReactNode;
}

/** A full-stage tool open in a stage tab. */
export interface StageTool extends StageToolTab {
  /** What the tool draws over the panes while its tab is in front. */
  content: ReactNode;
}
