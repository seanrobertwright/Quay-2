import type { ReactNode } from "react";
import type { CompanionOpensOn } from "./companionPrefs.ts";

/** The companion's views. This build registers Repository; later builds register the others. */
export type CompanionViewId = "pull-request" | "ticket" | "repository" | "activity" | "run" | "topos" | "inspector";

/**
 * One companion view, registered into the companion header's view switch. `Ctx` is what the
 * companion knows about the selected terminal.
 */
export interface CompanionView<Ctx> {
  id: CompanionViewId;
  /** The view's name on the view switch. */
  label: string;
  /** Whether the selected terminal has something for this view to show. */
  available: (ctx: Ctx) => boolean;
  render: (ctx: Ctx) => ReactNode;
}

/** The registered views the selected terminal has, in registration order: the view switch's entries. */
export function switchableViews<Ctx>(views: readonly CompanionView<Ctx>[], ctx: Ctx): CompanionView<Ctx>[] {
  return views.filter((view) => view.available(ctx));
}

/**
 * The view the companion shows first for a terminal: the Companion opens on setting's view when
 * it is registered and the terminal has it, else Repository.
 */
export function firstView<Ctx>(views: readonly CompanionView<Ctx>[], ctx: Ctx, opensOn: CompanionOpensOn): CompanionViewId {
  const preferred = views.find((view) => view.id === opensOn);
  return preferred && preferred.available(ctx) ? preferred.id : "repository";
}
