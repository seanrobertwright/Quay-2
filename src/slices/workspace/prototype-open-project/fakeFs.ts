// PROTOTYPE (#285) — throwaway. Fake filesystem so the Open Project variants
// can be judged in a plain browser without the Tauri backend.

export interface FakeDir {
  name: string;
  isGit?: boolean;
  branch?: string;
  children?: FakeDir[];
}

export interface RecentProject {
  path: string;
  name: string;
  branch: string;
  lastOpened: string;
  added: boolean; // already in the rail
}

const repo = (name: string, branch = "master"): FakeDir => ({
  name,
  isGit: true,
  branch,
  children: [{ name: "src" }, { name: "docs" }, { name: "node_modules" }],
});

export const ROOTS: FakeDir[] = [
  {
    name: "C:",
    children: [
      {
        name: "Users",
        children: [
          {
            name: "swright",
            children: [
              { name: "Documents", children: [{ name: "notes" }, { name: "scratch" }] },
              { name: "Downloads" },
              { name: "source", children: [repo("dotfiles", "main"), repo("playground", "main")] },
            ],
          },
        ],
      },
      { name: "repos", children: [repo("Quay-2"), repo("Quay-2-proto285", "prototype/285"), repo("pig", "main")] },
      { name: "Program Files" },
      { name: "Windows" },
    ],
  },
  {
    name: "E:",
    children: [
      {
        name: "Projects",
        children: [
          repo("Quay2"),
          repo("AI-WS-SDK", "main"),
          repo("archon", "dev"),
          repo("lril3d", "main"),
          { name: "old-experiments", children: [repo("tauri-spike", "main"), { name: "sketches" }] },
          { name: "datasets" },
        ],
      },
      { name: "Media" },
    ],
  },
];

export const RECENTS: RecentProject[] = [
  { path: "C:\\repos\\Quay-2", name: "Quay-2", branch: "master", lastOpened: "2 minutes ago", added: true },
  { path: "E:\\Projects\\AI-WS-SDK", name: "AI-WS-SDK", branch: "main", lastOpened: "1 hour ago", added: true },
  { path: "E:\\Projects\\archon", name: "archon", branch: "dev", lastOpened: "yesterday", added: false },
  { path: "E:\\Projects\\lril3d", name: "lril3d", branch: "main", lastOpened: "3 days ago", added: false },
  { path: "C:\\Users\\swright\\source\\dotfiles", name: "dotfiles", branch: "main", lastOpened: "last week", added: false },
];

export const ADDED = new Set(RECENTS.filter((r) => r.added).map((r) => r.path.toLowerCase()));

export const splitPath = (p: string) => p.replace(/\//g, "\\").split("\\").filter(Boolean);

export function findDir(path: string): FakeDir | null {
  const parts = splitPath(path);
  if (!parts.length) return null;
  let node: FakeDir | undefined = ROOTS.find((r) => r.name.toLowerCase() === parts[0].toLowerCase());
  for (const part of parts.slice(1)) {
    node = node?.children?.find((c) => c.name.toLowerCase() === part.toLowerCase());
  }
  return node ?? null;
}

export const joinPath = (parts: string[]) => (parts.length === 1 ? parts[0] + "\\" : parts.join("\\"));

/** Autocomplete: children of the typed parent whose names start with the typed leaf. */
export function complete(input: string): string[] {
  const norm = input.replace(/\//g, "\\");
  const cut = norm.lastIndexOf("\\");
  if (cut < 0) return ROOTS.filter((r) => r.name.toLowerCase().startsWith(norm.toLowerCase())).map((r) => r.name + "\\");
  const parent = norm.slice(0, cut);
  const leaf = norm.slice(cut + 1).toLowerCase();
  const dir = findDir(parent);
  return (dir?.children ?? [])
    .filter((c) => c.name.toLowerCase().startsWith(leaf))
    .map((c) => `${parent}\\${c.name}`);
}

export type Verdict =
  | { kind: "empty" }
  | { kind: "missing" }
  | { kind: "added" }
  | { kind: "git"; branch: string }
  | { kind: "plain" };

export function validate(path: string): Verdict {
  const trimmed = path.trim().replace(/\\$/, "");
  if (!trimmed) return { kind: "empty" };
  const dir = findDir(trimmed);
  if (!dir) return { kind: "missing" };
  if (ADDED.has(trimmed.toLowerCase())) return { kind: "added" };
  return dir.isGit ? { kind: "git", branch: dir.branch ?? "" } : { kind: "plain" };
}
