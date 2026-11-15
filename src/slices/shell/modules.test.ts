import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULES, moduleAfterClick } from "./modules.ts";

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
