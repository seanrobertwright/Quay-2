import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Content Security Policy Tauri sends with every page of a built Quay.
const security = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security;
const csp: Record<string, string[]> = security.csp;

test("Quay's policy runs only its own scripts and never eval", () => {
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  for (const [directive, sources] of Object.entries(csp)) {
    assert.ok(!sources.includes("'unsafe-eval'"), directive);
  }
});

test("Quay's policy reaches Tauri IPC and the GitHub API the updater checks, and nothing else", () => {
  assert.deepEqual(csp["connect-src"], ["ipc:", "http://ipc.localhost", "https://api.github.com"]);
});

test("images load from Quay itself and from blob URLs, which Topos's image preview builds from git's bytes", () => {
  assert.deepEqual(csp["img-src"], ["'self'", "blob:"]);
});

test("Tauri leaves style-src alone, so the inline styles xterm.js writes keep working", () => {
  // xterm.js creates <style> elements at runtime. A nonce or hash in style-src
  // would make the webview ignore 'unsafe-inline' and drop them.
  assert.deepEqual(csp["style-src"], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(security.dangerousDisableAssetCspModification, ["style-src"]);
});
