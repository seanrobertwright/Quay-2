/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFolderRow, listRows, otherSide, splitStatus, type Change, type FolderListing, type ListRow, type StatusEntry } from "./stagingLists.ts";

const entry = (path: string, xy: string, kind: StatusEntry["kind"] = "tracked"): StatusEntry => ({ path, xy, kind });

test("the other side of each list is the opposite list", () => {
  assert.equal(otherSide("unstaged"), "staged");
  assert.equal(otherSide("staged"), "unstaged");
});

test("a file changed on both sides is in both lists; untracked and unmerged ones are unstaged", () => {
  const { unstaged, staged } = splitStatus([
    entry("both.txt", "MM"),
    entry("index-only.txt", "A."),
    entry("worktree-only.txt", ".D"),
    entry("new.txt", "??", "untracked"),
    entry("notes", "??", "untrackedFolder"),
    entry("clash.txt", "UU", "unmerged"),
  ]);
  assert.deepEqual(
    unstaged.map((c) => [c.path, c.letter]),
    [
      ["both.txt", "M"],
      ["worktree-only.txt", "D"],
      ["new.txt", "?"],
      ["notes", "?"],
      ["clash.txt", "U"],
    ]
  );
  assert.deepEqual(
    staged.map((c) => [c.path, c.letter]),
    [
      ["both.txt", "M"],
      ["index-only.txt", "A"],
    ]
  );
});

const change = (path: string, letter: string, kind: Change["kind"] = "tracked"): Change => ({ path, letter, kind });

/** Each row as `indent + label`, with `/` after a folder and `+`/`-` for collapsed or open. */
function outline(rows: ListRow[]): string[] {
  return rows.map((r) => {
    const mark = r.expanded === undefined ? "" : r.expanded ? "-" : "+";
    const suffix = isFolderRow(r) ? "/" : "";
    const text = r.type === "note" ? `(${r.name})` : `${mark}${r.name}${suffix}`;
    return `${"  ".repeat(r.depth)}${text}`;
  });
}

const changes = [
  change("README.md", "M"),
  change("src/a.ts", "M"),
  change("src/ui/b.tsx", "A"),
  change("notes", "?", "untrackedFolder"),
];

test("flat rows list full paths, and an expanded untracked folder lists its files beneath it", () => {
  const folders = new Map<string, FolderListing>([
    ["notes", { state: "done", changes: [change("notes/a.md", "?", "untracked"), change("notes/deep/b.md", "?", "untracked")], truncated: false }],
  ]);
  const rows = listRows(changes, { mode: "flat", collapsed: new Set(), folders });
  assert.deepEqual(outline(rows), ["README.md", "src/a.ts", "src/ui/b.tsx", "-notes/", "  notes/a.md", "  notes/deep/b.md"]);
  // One key per row, from its path, never its position.
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
});

test("an untracked folder shows collapsed until it is expanded, then loading, failed or capped", () => {
  assert.deepEqual(outline(listRows(changes.slice(3), { mode: "flat", collapsed: new Set(), folders: new Map() })), ["+notes/"]);
  const loading = new Map<string, FolderListing>([["notes", { state: "loading" }]]);
  assert.deepEqual(outline(listRows(changes.slice(3), { mode: "flat", collapsed: new Set(), folders: loading })), ["-notes/", "  (Loading…)"]);
  const failed = new Map<string, FolderListing>([["notes", { state: "failed", message: "boom" }]]);
  assert.deepEqual(outline(listRows(changes.slice(3), { mode: "flat", collapsed: new Set(), folders: failed })), ["-notes/", "  (boom)"]);
  const capped = new Map<string, FolderListing>([["notes", { state: "done", changes: [change("notes/a.md", "?", "untracked")], truncated: true }]]);
  assert.deepEqual(outline(listRows(changes.slice(3), { mode: "flat", collapsed: new Set(), folders: capped })), [
    "-notes/",
    "  notes/a.md",
    "  (Showing the first 10,000 files)",
  ]);
});

test("tree rows nest changes under their folders, and a collapsed folder hides what is under it", () => {
  const open = listRows(changes, { mode: "tree", collapsed: new Set(), folders: new Map() });
  assert.deepEqual(outline(open), ["README.md", "-src/", "  a.ts", "  -ui/", "    b.tsx", "+notes/"]);
  assert.deepEqual(
    open.filter((r) => r.type === "dir").map((r) => r.path),
    ["src", "src/ui"]
  );
  const shut = listRows(changes, { mode: "tree", collapsed: new Set(["src/ui"]), folders: new Map() });
  assert.deepEqual(outline(shut), ["README.md", "-src/", "  a.ts", "  +ui/", "+notes/"]);
  assert.deepEqual(outline(listRows(changes, { mode: "tree", collapsed: new Set(["src"]), folders: new Map() })), [
    "README.md",
    "+src/",
    "+notes/",
  ]);
});
