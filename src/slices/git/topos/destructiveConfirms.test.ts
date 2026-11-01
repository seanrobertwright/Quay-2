/// <reference types="node" />
// Every confirm that drops or overwrites work is marked destructive, so its button takes the danger
// style (#421), and the confirms that don't are not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { conflictCard } from "./conflictCards.ts";
import { confirmDropEdits, confirmMarkResolved, confirmReset, confirmTakeSide } from "./conflicts.ts";
import { confirmDiscardAll, confirmDiscardFile } from "./discards.ts";
import { confirmAbort, confirmSkip, type OpState } from "./operation.ts";
import { deleteBranchPrompt, deleteTagPrompt, notMergedPrompt } from "./refWrites.ts";
import { deleteRemoteBranchPrompt, forcePushPrompt, typedForcePushPrompt, type LeasePlan } from "./remoteOps.ts";
import type { ConflictFile } from "./useConflictResolver.ts";
import type { ConflictKind } from "./operation.ts";

const PLAN: LeasePlan = {
  remote: "origin",
  remoteRef: "refs/heads/main",
  tracking: "origin/main",
  expectedSha: "1111111111111111111111111111111111111111",
  overwrites: 2,
  defaultBranch: "main",
};

function op(kind: OpState["kind"]): OpState {
  return {
    kind,
    leftLabel: { role: "HEAD", name: "main" },
    rightLabel: { role: "Incoming", name: "feature" },
    message: null,
    conflicts: [],
    conflictsTotal: 0,
  };
}

function conflictFile(kind: ConflictKind, xy: string, onDisk: boolean): ConflictFile {
  return {
    path: "notes.txt",
    xy,
    kind,
    onDisk,
    leftOid: "1111111111111111111111111111111111111111",
    rightOid: "2222222222222222222222222222222222222222",
    token: "t",
    editable: false,
    reason: "oneSideMissing",
    left: null,
    right: null,
    result: null,
    eol: "lf",
    bom: false,
    markerSize: 7,
  };
}

test("discards, branch and tag deletes, remote deletes and force pushes are destructive", () => {
  const status = { entries: [], truncated: false } as unknown as Parameters<typeof confirmDiscardAll>[0];
  const prompts = {
    "discard file": confirmDiscardFile("a.txt", "tracked"),
    "move to Recycle Bin": confirmDiscardFile("a.txt", "untracked"),
    "move folder to Recycle Bin": confirmDiscardFile("build", "untrackedFolder"),
    "discard all": confirmDiscardAll(status),
    "delete branch": deleteBranchPrompt("topic"),
    "delete branch anyway": notMergedPrompt("topic", 2, "1111111111111111111111111111111111111111"),
    "delete tag": deleteTagPrompt("v1"),
    "delete tag, remotes unknown": deleteTagPrompt("v1", null),
    "delete tag on remotes too": deleteTagPrompt("v1", ["origin"]),
    "remote delete": deleteRemoteBranchPrompt("origin", "topic"),
    "force push": forcePushPrompt("topic", PLAN),
    "typed force push": typedForcePushPrompt(PLAN),
  };
  for (const [what, prompt] of Object.entries(prompts)) assert.equal(prompt.destructive, true, what);
});

test("resolver confirms that drop work are destructive, and Mark resolved anyway is not", () => {
  assert.equal(confirmReset("a.txt", false).destructive, true, "reset file");
  assert.equal(confirmReset("a.txt", true).destructive, true, "reset file with unsaved edits");
  assert.equal(confirmTakeSide("a.txt", "HEAD · main").destructive, true, "take side");
  assert.equal(confirmDropEdits("Leave a.txt?", "a.txt").destructive, true, "drop unsaved edits");
  const marked = confirmMarkResolved("a.txt", { hunks: [], unterminated: null, markersRemain: true } as never);
  assert.ok(marked);
  assert.notEqual(marked.destructive, true, "staging the markers keeps every byte");
});

test("Abort and Skip of every operation are destructive", () => {
  for (const kind of ["merge", "rebase", "cherryPick", "revert"] as const) {
    assert.equal(confirmAbort(op(kind))?.destructive, true, `abort ${kind}`);
    if (kind !== "merge") assert.equal(confirmSkip(op(kind))?.destructive, true, `skip ${kind}`);
  }
});

test("every side-picker choice that confirms (take side, remove) is destructive", () => {
  const names = { left: "HEAD · feat", right: "Incoming · main" };
  const shapes: [ConflictKind, string][] = [
    ["bothModified", "UU"],
    ["bothAdded", "AA"],
    ["deletedByThem", "UD"],
    ["deletedByUs", "DU"],
    ["addedByUs", "AU"],
    ["addedByThem", "UA"],
    ["bothDeleted", "DD"],
  ];
  let confirming = 0;
  for (const [kind, xy] of shapes) {
    for (const onDisk of [true, false]) {
      const card = conflictCard(conflictFile(kind, xy, onDisk), names, []);
      for (const choice of card?.choices ?? []) {
        if (choice.confirm === null) continue;
        confirming++;
        assert.equal(choice.confirm.destructive, true, `${xy} ${choice.label}`);
      }
    }
  }
  assert.ok(confirming > 0, "some choice confirms");
});

/**
 * The confirms Topos asks that drop nothing, by their confirm label. A new confirm must either be
 * marked destructive or be added here.
 */
const SAFE_LABELS = [
  "Add to .gitignore",
  "Create branch",
  "Checkout",
  "Create tag",
  "Rename",
  "Set upstream",
  "Pull",
  "Push",
  "Mark resolved anyway",
];

test("every confirm in Topos's source is either marked destructive or known to drop nothing", () => {
  const dir = new URL("./", import.meta.url);
  const sources = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts") && f !== "ConfirmDialog.tsx");
  let seen = 0;
  for (const file of sources) {
    const lines = readFileSync(new URL(file, dir), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      // A `confirmLabel` key in an object literal, written out or shorthand. Interface fields
      // (`confirmLabel: string;`), reads (`.confirmLabel`) and `const confirmLabel =` ask nothing.
      if (!/(?<![.\w])confirmLabel\s*[:,}]/.test(line) || /confirmLabel\??:\s*string;/.test(line)) return;
      seen++;
      // The object literal the key sits in: the line itself when it opens and closes there, or
      // back to the line that opens it and on to the line that closes it.
      let literal = line;
      const braces = line.replace(/\$\{[^}]*\}/g, "");
      if (!(braces.includes("{") && braces.includes("}"))) {
        let start = i;
        while (start > 0 && !/[{]\s*$/.test(lines[start])) start--;
        let end = i;
        while (end < lines.length - 1 && !/^\s*}/.test(lines[end])) end++;
        literal = lines.slice(start, end + 1).join("\n");
      }
      const safe = SAFE_LABELS.some((l) => line.includes(`"${l}"`));
      assert.ok(safe || /destructive:\s*true/.test(literal), `${file}:${i + 1} ${line.trim()} is neither destructive nor a known safe confirm`);
    });
  }
  assert.ok(seen >= 20, `found the confirms (${seen})`);
});
