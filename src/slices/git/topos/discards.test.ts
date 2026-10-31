import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmDiscardAll,
  confirmDiscardFile,
  DiscardLog,
  discardedMessage,
  MAX_DISCARDS,
  restoreOutcome,
  selectionLabel,
  targetLabel,
  type DiscardBackup,
} from "./discards.ts";
import type { StatusEntry, WorktreeStatus } from "./stagingLists.ts";

function status(entries: StatusEntry[], total: number, truncated: boolean): WorktreeStatus {
  return { requestId: 1, entries, total, truncated };
}

test("a discard is named by what it took", () => {
  assert.equal(selectionLabel("src/lib.rs", { kind: "file" }), "src/lib.rs");
  assert.equal(selectionLabel("src/lib.rs", { kind: "hunks", hunks: [1] }), "hunk 2 of src/lib.rs");
  assert.equal(selectionLabel("a.txt", { kind: "lines", lines: [{ hunk: 0, line: 1 }] }), "1 line of a.txt");
  assert.equal(
    selectionLabel("a.txt", { kind: "lines", lines: [{ hunk: 0, line: 1 }, { hunk: 0, line: 2 }, { hunk: 1, line: 0 }] }),
    "3 lines of a.txt"
  );
  assert.equal(targetLabel({ kind: "paths", paths: ["notes"] }, "untrackedFolder"), "notes/");
  assert.equal(targetLabel({ kind: "paths", paths: ["README.md"] }, "tracked"), "README.md");
  assert.equal(targetLabel({ kind: "all", includeUntracked: false }), "all unstaged changes");
  assert.equal(targetLabel({ kind: "all", includeUntracked: true }), "all unstaged changes and untracked files");
  assert.equal(
    discardedMessage("hunk 2 of src/lib.rs", 1),
    "Discarded hunk 2 of src/lib.rs. Undo within 10 seconds, or restore it from Recently discarded."
  );
  assert.equal(discardedMessage("all unstaged changes", 0), "Nothing to discard in all unstaged changes.");
});

test("a whole file always confirms, naming where an untracked file goes", () => {
  const tracked = confirmDiscardFile("README.md", "tracked");
  assert.equal(tracked.title, "Discard changes to README.md?");
  assert.equal(tracked.confirmLabel, "Discard file");
  assert.match(tracked.detail, /back to the staged or committed version/);
  assert.match(tracked.detail, /Recently discarded/);
  const untracked = confirmDiscardFile("notes/a.md", "untracked");
  assert.equal(untracked.title, "Move notes/a.md to the Recycle Bin?");
  assert.match(untracked.detail, /Recycle Bin/);
  const folder = confirmDiscardFile("notes", "untrackedFolder");
  assert.equal(folder.title, "Move notes/ to the Recycle Bin?");
  assert.equal(folder.confirmLabel, "Move to Recycle Bin");
});

test("Discard all confirms, with untracked files only behind an unticked checkbox", () => {
  const all = confirmDiscardAll(status([], 12_345, true));
  assert.equal(all.title, "Discard all unstaged changes?");
  assert.equal(all.checkbox.label, "Also move untracked files to the Recycle Bin");
  assert.equal(all.checkbox.initial, false);
});

test("Discard all counts only the tracked files it will reset, and names the cap only past it", () => {
  // Seen live: two untracked files and a staged-only file were counted as changes to tracked files.
  const entries: StatusEntry[] = [
    { path: "a.txt", xy: ".M", kind: "tracked" },
    { path: "b.txt", xy: "MM", kind: "tracked" },
    { path: "staged.txt", xy: "M.", kind: "tracked" },
    { path: "u.txt", xy: "??", kind: "untracked" },
    { path: "new/", xy: "??", kind: "untrackedFolder" },
  ];
  const within = confirmDiscardAll(status(entries, entries.length, false)).detail;
  assert.match(within, /2 tracked files/);
  assert.doesNotMatch(within, /5|cap/);

  const past = confirmDiscardAll(status(entries, 12_345, true)).detail;
  assert.match(past, /2 tracked files in the list, and any past the list's cap/);
});

test("a restore refused for files that changed since offers Copy to a new file", () => {
  assert.deepEqual(restoreOutcome({ kind: "changedSinceDiscard", paths: ["README.md"] }), { kind: "changed", paths: ["README.md"] });
  assert.deepEqual(restoreOutcome({ kind: "indexLocked" }).kind, "failed");
  assert.deepEqual(restoreOutcome("boom"), { kind: "failed", message: "boom" });
});

const backup = (path: string): DiscardBackup => ({ path, blob: "b".repeat(40), after: "a".repeat(40) });

test("the log keeps each worktree's discards newest first, and records nothing for an empty discard", () => {
  const log = new DiscardLog();
  const first = log.add("C:/wt", "README.md", [backup("README.md")]);
  log.add("C:/other", "a.txt", [backup("a.txt")]);
  const second = log.add("C:/wt", "hunk 2 of lib.rs", [backup("src/lib.rs")]);
  assert.equal(log.add("C:/wt", "all unstaged changes", []), null);

  assert.deepEqual(
    log.entries("C:/wt").map((e) => [e.id, e.label, e.state]),
    [
      [second!.id, "hunk 2 of lib.rs", "discarded"],
      [first!.id, "README.md", "discarded"],
    ]
  );
  assert.deepEqual(log.entries("C:/other").map((e) => e.label), ["a.txt"]);
  assert.deepEqual(log.entries("C:/none"), []);
});

test("an entry moves to restored, changed with the changed paths, or copied with the new files", () => {
  const log = new DiscardLog();
  const entry = log.add("C:/wt", "README.md", [backup("README.md")])!;
  let seen = 0;
  const stop = log.subscribe(() => seen++);

  log.update("C:/wt", entry.id, { state: "changed", changedPaths: ["README.md"] });
  assert.deepEqual(log.entries("C:/wt")[0].changedPaths, ["README.md"]);
  log.update("C:/wt", entry.id, { state: "copied", copiedTo: ["README (discarded).md"] });
  assert.equal(log.entries("C:/wt")[0].state, "copied");
  assert.deepEqual(log.entries("C:/wt")[0].copiedTo, ["README (discarded).md"]);
  assert.equal(seen, 2);
  stop();
  log.update("C:/wt", entry.id, { state: "restored" });
  assert.equal(seen, 2);
  assert.equal(log.entries("C:/wt")[0].state, "restored");
});

test("the log holds at most MAX_DISCARDS entries a worktree, dropping the oldest", () => {
  const log = new DiscardLog();
  for (let i = 0; i < MAX_DISCARDS + 3; i++) log.add("C:/wt", `file ${i}`, [backup(`f${i}`)]);
  const entries = log.entries("C:/wt");
  assert.equal(entries.length, MAX_DISCARDS);
  assert.equal(entries[0].label, `file ${MAX_DISCARDS + 2}`);
  assert.equal(entries[entries.length - 1].label, "file 3");
});

test("entries returns the same list until the log changes, as useSyncExternalStore needs", () => {
  const log = new DiscardLog();
  // A fresh array per read made React re-render forever (error #185) when Topos opened on a
  // worktree with no discards yet.
  assert.equal(log.entries("C:/wt"), log.entries("C:/wt"));
  log.add("C:/wt", "README.md", [backup("README.md")]);
  const after = log.entries("C:/wt");
  assert.equal(log.entries("C:/wt"), after);
  log.add("C:/wt", "a.txt", [backup("a.txt")]);
  assert.notEqual(log.entries("C:/wt"), after);
});
