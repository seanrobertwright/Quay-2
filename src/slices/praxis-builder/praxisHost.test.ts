/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { openPraxisTerminal, type InteractiveCommand } from "./praxisHost.ts";

test("an interactive praxis command opens in a terminal in the project, as the backend spells it", async () => {
  const asked: InteractiveCommand[] = [];
  const opened: [string, string[]][] = [];
  const typed = await openPraxisTerminal(
    "login",
    "E:/work/app",
    async (cwd, argv) => {
      opened.push([cwd, argv]);
      return true;
    },
    async (command) => {
      asked.push(command);
      return ["node", "E:/sdk/engine/src/praxis.ts", command, "--state", "E:/praxis"];
    },
  );
  assert.equal(typed, true);
  assert.deepEqual(asked, ["login"]);
  assert.deepEqual(opened, [["E:/work/app", ["node", "E:/sdk/engine/src/praxis.ts", "login", "--state", "E:/praxis"]]]);
});

test("no terminal opens when praxis can't be found", async () => {
  let opened = false;
  await assert.rejects(
    openPraxisTerminal(
      "serve",
      "E:/work/app",
      async () => (opened = true),
      async () => {
        throw new Error("The praxis CLI isn't linked.");
      },
    ),
    /isn't linked/,
  );
  assert.equal(opened, false);
});
