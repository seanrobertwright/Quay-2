// The Windows installer's hooks, as tauri.conf.json names them. The bundler stops on a path that
// resolves to no file, and leaves out without a word a hook whose name it doesn't know.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TAURI = new URL("../src-tauri/", import.meta.url);

test("the NSIS bundle's hook file is in the repository and defines the hooks Tauri calls", () => {
  const { bundle } = JSON.parse(readFileSync(new URL("tauri.conf.json", TAURI), "utf8"));
  const hooks = readFileSync(new URL(bundle.windows.nsis.installerHooks, TAURI), "utf8");
  const defined = [...hooks.matchAll(/^!macro (NSIS_HOOK_\w+)$/gm)].map((macro) => macro[1]);
  assert.deepEqual(defined, ["NSIS_HOOK_PREINSTALL", "NSIS_HOOK_POSTINSTALL", "NSIS_HOOK_PREUNINSTALL"]);
});
