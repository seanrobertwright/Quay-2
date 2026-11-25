// The Windows installer's hooks, as tauri.conf.json names them. The bundler stops on a path that
// resolves to no file, and leaves out without a word a hook whose name it doesn't know.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TAURI = new URL("../src-tauri/", import.meta.url);

function hookFile(): string {
  const { bundle } = JSON.parse(readFileSync(new URL("tauri.conf.json", TAURI), "utf8"));
  return readFileSync(new URL(bundle.windows.nsis.installerHooks, TAURI), "utf8");
}

test("the NSIS bundle's hook file is in the repository and defines the three hooks Quay uses", () => {
  const defined = [...hookFile().matchAll(/^!macro (NSIS_HOOK_\w+)$/gm)].map((macro) => macro[1]);
  assert.deepEqual(defined.sort(), ["NSIS_HOOK_POSTINSTALL", "NSIS_HOOK_PREINSTALL", "NSIS_HOOK_PREUNINSTALL"]);
});

// The tests of relay_leftovers.rs hold Quay's sweep at startup to the same name.
test("the hooks take the start of an old relay's name from one place", () => {
  const code = hookFile()
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(";"));
  const named = code.filter((line) => line.includes("quay-relay.exe.old"));
  assert.deepEqual(named, ['!define QUAY_OLD_RELAY "quay-relay.exe.old"']);
});
