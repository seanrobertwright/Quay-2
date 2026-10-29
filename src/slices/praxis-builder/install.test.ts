/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { installCommands, installTarget, runCommand } from "./install.ts";

test("a template installs as <name>.json and runs with praxis run <name>", () => {
  assert.equal(installTarget("fix-bug"), "fix-bug.json");
  assert.equal(runCommand("fix-bug"), "praxis run fix-bug");
});

test("the three commands are listed in order, each argument in full", () => {
  const commands = installCommands({
    implementation: ["/usr/bin/node", "build.js", "--out dir"],
    validation: ["npm", "test"],
    correction: [],
  });
  assert.deepEqual(commands, [
    { key: "implementation", args: ["/usr/bin/node", "build.js", "--out dir"] },
    { key: "validation", args: ["npm", "test"] },
    { key: "correction", args: [] },
  ]);
});

test("a command that isn't an argument list shows as its JSON, and a missing one says so", () => {
  const commands = installCommands({ implementation: "npm run build", validation: ["ok", 3] });
  assert.deepEqual(commands, [
    { key: "implementation", json: '"npm run build"' },
    { key: "validation", json: '["ok",3]' },
    { key: "correction", missing: true },
  ]);
});

test("a file that isn't an object lists all three commands as missing", () => {
  assert.deepEqual(
    installCommands(null).map((c) => c.key),
    ["implementation", "validation", "correction"]
  );
  assert.ok(installCommands([1, 2]).every((c) => "missing" in c));
});
