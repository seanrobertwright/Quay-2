// The main window, as tauri.conf.json opens it. The tutorial capture restores the window down
// and takes its stills at the size it then has, so that size is held here too (scripts/capture).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the main window opens maximized, and restores down to 1280 × 800", () => {
  const { app } = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const [main] = app.windows;
  assert.deepEqual(
    { label: main.label, maximized: main.maximized, width: main.width, height: main.height },
    { label: "main", maximized: true, width: 1280, height: 800 },
  );
});
