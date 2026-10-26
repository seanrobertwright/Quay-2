/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCompletion,
  baseName,
  canOpen,
  childPath,
  cleanOpenPath,
  commonPrefix,
  completionTarget,
  filterCompletions,
  joinPath,
  parentPath,
  pinnedRoots,
  splitPath,
  verdictFor,
} from "./openProjectPaths.ts";

test("splitPath breaks a Windows path into breadcrumb parts", () => {
  assert.deepEqual(splitPath("C:\\Users\\me"), ["C:", "Users", "me"]);
  assert.deepEqual(splitPath("C:/Users/me/"), ["C:", "Users", "me"]);
  assert.deepEqual(splitPath("C:\\"), ["C:"]);
  assert.deepEqual(splitPath("  "), []);
});

test("splitPath keeps a UNC server and share together as the root", () => {
  assert.deepEqual(splitPath("\\\\nas\\code\\repo"), ["\\\\nas\\code", "repo"]);
  assert.deepEqual(splitPath("\\\\nas"), ["\\\\nas"]);
});

test("joinPath is splitPath's inverse and gives a bare drive its root slash", () => {
  assert.equal(joinPath(["C:"]), "C:\\");
  assert.equal(joinPath(["C:", "repos", "Quay-2"]), "C:\\repos\\Quay-2");
  assert.equal(joinPath(splitPath("\\\\nas\\code\\repo")), "\\\\nas\\code\\repo");
  assert.equal(joinPath([]), "");
});

test("parentPath, baseName and childPath", () => {
  assert.equal(parentPath("C:\\repos\\Quay-2"), "C:\\repos");
  assert.equal(parentPath("C:\\repos"), "C:\\");
  assert.equal(parentPath("C:\\"), null);
  assert.equal(baseName("C:\\repos\\Quay-2\\"), "Quay-2");
  assert.equal(childPath("C:\\", "repos"), "C:\\repos");
  assert.equal(childPath("C:\\repos\\", "x"), "C:\\repos\\x");
});

test("completionTarget splits the typed parent from the partial name", () => {
  assert.deepEqual(completionTarget("C:\\re"), { parent: "C:\\", leaf: "re" });
  assert.deepEqual(completionTarget("C:/repos/Qu"), { parent: "C:\\repos", leaf: "Qu" });
  assert.deepEqual(completionTarget("C:\\repos\\"), { parent: "C:\\repos", leaf: "" });
  assert.deepEqual(completionTarget("C"), { parent: null, leaf: "C" });
});

test("filterCompletions and commonPrefix ignore case", () => {
  assert.deepEqual(filterCompletions(["Quay-2", "quay-proto", "pig"], "qu"), ["Quay-2", "quay-proto"]);
  assert.equal(commonPrefix(["Quay-2", "quay-proto"]), "Quay-");
  assert.equal(commonPrefix([]), "");
});

test("Tab completes a single match into the folder with a trailing slash", () => {
  assert.equal(applyCompletion("C:\\repos\\pi", ["Quay-2", "pig"]), "C:\\repos\\pig\\");
  assert.equal(applyCompletion("C:\\re", ["repos", "Users"]), "C:\\repos\\");
});

test("Tab extends several matches to their shared prefix, or leaves the input alone", () => {
  assert.equal(applyCompletion("C:\\repos\\q", ["Quay-2", "Quay-proto"]), "C:\\repos\\Quay-");
  assert.equal(applyCompletion("C:\\repos\\Quay-", ["Quay-2", "Quay-proto"]), "C:\\repos\\Quay-");
  assert.equal(applyCompletion("C:\\repos\\zz", ["Quay-2"]), "C:\\repos\\zz");
});

test("Tab uses a highlighted suggestion when there is one", () => {
  assert.equal(applyCompletion("C:\\repos\\Quay-", ["Quay-2", "Quay-proto"], "Quay-proto"), "C:\\repos\\Quay-proto\\");
});

test("Tab completes drive letters before any slash is typed", () => {
  assert.equal(applyCompletion("e", ["C:\\", "E:\\"]), "E:\\");
  assert.equal(applyCompletion("C:", ["C:\\", "E:\\"]), "C:\\");
});

test("verdictFor covers every chip", () => {
  const projects = [{ path: "C:\\repos\\Quay-2" }];
  const git = { exists: true, is_git: true, branch: "master" };
  assert.deepEqual(verdictFor(" ", null, projects), { kind: "empty" });
  assert.deepEqual(verdictFor("C:\\x", null, projects), { kind: "checking" });
  assert.deepEqual(verdictFor("C:\\x", { exists: false, is_git: false, branch: null }, projects), { kind: "missing" });
  assert.deepEqual(verdictFor("c:/repos/quay-2/", git, projects), { kind: "added", projectPath: "C:\\repos\\Quay-2" });
  assert.deepEqual(verdictFor("C:\\repos\\pig", git, projects), { kind: "git", branch: "master" });
  assert.deepEqual(verdictFor("C:\\notes", { exists: true, is_git: false, branch: null }, projects), { kind: "plain" });
});

test("only an existing folder can be opened", () => {
  assert.equal(canOpen({ kind: "missing" }), false);
  assert.equal(canOpen({ kind: "checking" }), false);
  assert.equal(canOpen({ kind: "empty" }), false);
  assert.equal(canOpen({ kind: "plain" }), true);
  assert.equal(canOpen({ kind: "added", projectPath: "C:\\a" }), true);
});

test("cleanOpenPath drops a trailing slash but keeps a drive root", () => {
  assert.equal(cleanOpenPath(" C:\\repos\\pig\\ "), "C:\\repos\\pig");
  assert.equal(cleanOpenPath("C:/repos/pig"), "C:\\repos\\pig");
  assert.equal(cleanOpenPath("C:"), "C:\\");
});

test("pinnedRoots lists each project's parent once, without home or drive roots", () => {
  const roots = pinnedRoots(
    ["E:\\Projects\\Quay2", "e:\\projects\\archon", "C:\\repos\\Quay-2", "D:\\loose", "C:\\Users\\me\\dotfiles"],
    "C:\\Users\\me"
  );
  assert.deepEqual(roots, ["C:\\repos", "E:\\Projects"]);
});
