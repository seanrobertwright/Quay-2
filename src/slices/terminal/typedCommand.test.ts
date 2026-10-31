/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { commandLine, shellFor } from "./typedCommand.ts";

test("PowerShell gets every argument single-quoted after the call operator", () => {
  assert.equal(commandLine(["git", "fetch", "--prune", "--", "origin"], "pwsh"), "& 'git' 'fetch' '--prune' '--' 'origin'");
});

test("a remote name holding PowerShell syntax stays one literal argument", () => {
  // Each quote PowerShell accepts, straight or curly, is doubled so the name can't close its quote.
  assert.equal(commandLine(["git", "push", "--", "o'; Remove-Item x; '", "main"], "pwsh"), "& 'git' 'push' '--' 'o''; Remove-Item x; ''' 'main'");
  assert.equal(commandLine(["git", "fetch", "a’b$(evil)"], "pwsh"), "& 'git' 'fetch' 'a’’b$(evil)'");
});

test("sh gets every argument single-quoted, a quote closing and reopening around an escaped one", () => {
  assert.equal(commandLine(["git", "pull", "--rebase"], "sh"), "'git' 'pull' '--rebase'");
  assert.equal(commandLine(["git", "fetch", "--", "o'$(rm -rf ~)`x`"], "sh"), "'git' 'fetch' '--' 'o'\\''$(rm -rf ~)`x`'");
});

test("an argument holding a control character, which would press Enter early, is refused", () => {
  assert.equal(commandLine(["git", "fetch", "origin\rgit reset --hard"], "sh"), null);
  assert.equal(commandLine(["git", "fetch", "a\nb"], "pwsh"), null);
  assert.equal(commandLine(["git", "fetch", "a\u001b[2J"], "pwsh"), null);
});

test("an empty argument stays an argument", () => {
  assert.equal(commandLine(["git", "x", ""], "sh"), "'git' 'x' ''");
  assert.equal(commandLine(["git", "x", ""], "pwsh"), "& 'git' 'x' ''");
});

test("a shell terminal runs PowerShell on Windows and sh elsewhere", () => {
  assert.equal(shellFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130"), "pwsh");
  assert.equal(shellFor("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15"), "sh");
  assert.equal(shellFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"), "sh");
});

test("PowerShell's stop-parsing token is refused, since PowerShell drops it even quoted", () => {
  assert.equal(commandLine(["git", "fetch", "--%"], "pwsh"), null);
  assert.equal(commandLine(["git", "fetch", "--%"], "sh"), "'git' 'fetch' '--%'");
});
