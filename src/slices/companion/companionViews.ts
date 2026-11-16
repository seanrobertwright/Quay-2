import type { ReactNode } from "react";

/** The companion's views. */
export type CompanionViewId = "pull-request" | "ticket" | "repository" | "activity" | "run" | "topos" | "inspector";

/** The Repository view's id: the view the companion falls back to. */
export const REPOSITORY_VIEW_ID: CompanionViewId = "repository";

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
 * it is registered and the terminal has it, else the first registered view the terminal has, else
 * Repository.
 */
export function firstView<Ctx>(views: readonly CompanionView<Ctx>[], ctx: Ctx, opensOn: CompanionViewId): CompanionViewId {
  const preferred = views.find((view) => view.id === opensOn);
  if (preferred && preferred.available(ctx)) return preferred.id;
  return views.find((view) => view.available(ctx))?.id ?? REPOSITORY_VIEW_ID;
}
