import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULES, moduleAfterClick, moduleAfterUnfold } from "./modules.ts";

test("the module bar lists the five modules top to bottom", () => {
  assert.deepEqual(MODULES, ["projects", "source-control", "agents", "workflows", "project"]);
});

test("clicking the open module's icon folds the panel", () => {
  assert.equal(moduleAfterClick("agents", "agents"), null);
});

test("clicking an icon while the panel is folded opens that module", () => {
  assert.equal(moduleAfterClick(null, "agents"), "agents");
});

test("clicking another module's icon switches the panel to it", () => {
  assert.equal(moduleAfterClick("projects", "workflows"), "workflows");
});

test("leaving the Praxis Builder tab brings back the panel it folded, unless one was opened on demand meanwhile", () => {
  assert.equal(moduleAfterUnfold("workflows", null), "workflows");
  assert.equal(moduleAfterUnfold("workflows", "agents"), "agents");
  assert.equal(moduleAfterUnfold(null, null), null, "a panel folded before the tab came in front stays folded");
});
