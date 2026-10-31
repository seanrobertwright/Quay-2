// Topos's command palette entries (#367, #393, #395), shown only while Topos has a repo to target.
// None has a key of its own: network operations never get a bare key.

/** What a palette entry asks Topos to open or run. */
export type ToposRequestKind = "newBranch" | "checkout" | "fetch" | "pull" | "push";

export interface ToposPaletteEntry {
  id: string;
  title: string;
  subtitle: string;
  request: ToposRequestKind;
}

const ENTRIES: readonly ToposPaletteEntry[] = [
  {
    id: "topos-new-branch",
    title: "Topos: New branch…",
    subtitle: "Create a branch at the selected worktree's HEAD",
    request: "newBranch",
  },
  {
    id: "topos-checkout",
    title: "Topos: Checkout…",
    subtitle: "Pick a branch to check out in the selected worktree",
    request: "checkout",
  },
  {
    id: "topos-fetch",
    title: "Topos: Fetch",
    subtitle: "Fetch every remote of the selected repo, pruning deleted branches",
    request: "fetch",
  },
  {
    id: "topos-pull",
    title: "Topos: Pull",
    subtitle: "Pull the selected worktree's branch from its upstream",
    request: "pull",
  },
  {
    id: "topos-push",
    title: "Topos: Push",
    subtitle: "Push the selected worktree's branch to its upstream",
    request: "push",
  },
];

/** The entries to show: all of them while Topos targets a repo or worktree, none while it targets nothing. */
export function toposPaletteEntries(target: { path: string } | null): ToposPaletteEntry[] {
  return target === null ? [] : [...ENTRIES];
}
