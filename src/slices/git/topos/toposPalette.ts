// Topos's command palette entries (#367, #393), shown only while Topos has a repo to target.

/** What a palette entry asks Topos to open. */
export type ToposRequestKind = "newBranch" | "checkout";

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
];

/** The entries to show: both while Topos targets a repo or worktree, none while it targets nothing. */
export function toposPaletteEntries(target: { path: string } | null): ToposPaletteEntry[] {
  return target === null ? [] : [...ENTRIES];
}
