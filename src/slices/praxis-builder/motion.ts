// How the builder's canvases move their view. They read whether the person using Quay asks for
// reduced motion before they animate a pan, a zoom or a fit of the view: with it, the view moves
// at once. The builder's view keys (keymap.ts) move the graph canvas (GraphView.tsx) and the run
// canvas (RunCanvas.tsx) alike, through `moveView`.
import type { ReactFlowInstance } from "@xyflow/react";
import type { BuilderCommand } from "./keymap.ts";

/** True when the system asks for reduced motion. */
export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How long the view takes to move for a view key, unless the system asks for reduced motion. */
const VIEW_MOVE_MS = 200;

/** The commands of the builder's view keys: fit the view, zoom in, zoom out and zoom to 100%. */
export type ViewCommand = Extract<BuilderCommand, "fit-view" | "zoom-in" | "zoom-out" | "zoom-reset">;

/** What a view key needs of a canvas's React Flow instance. */
export type MovableView = Pick<ReactFlowInstance, "fitView" | "zoomIn" | "zoomOut" | "zoomTo">;

/** Moves `view` as view key `command` asks, over `VIEW_MOVE_MS`, or at once when the system asks for reduced motion. */
export function moveView(view: MovableView, command: ViewCommand): void {
  const options = { duration: prefersReducedMotion() ? 0 : VIEW_MOVE_MS };
  switch (command) {
    case "fit-view":
      void view.fitView(options);
      return;
    case "zoom-in":
      void view.zoomIn(options);
      return;
    case "zoom-out":
      void view.zoomOut(options);
      return;
    case "zoom-reset":
      void view.zoomTo(1, options);
      return;
  }
}
