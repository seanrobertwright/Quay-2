/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTerminalReport } from "./terminalReports.ts";

const ESC = "\x1b";

test("cursor position and status reports are reports", () => {
  for (const data of [`${ESC}[1;1R`, `${ESC}[37;111R`, `${ESC}[?12;40R`, `${ESC}[0n`]) {
    assert.equal(isTerminalReport(data), true, JSON.stringify(data));
  }
});

test("device attribute and mode reports are reports", () => {
  for (const data of [`${ESC}[?1;2c`, `${ESC}[?6c`, `${ESC}[>0;276;0c`, `${ESC}[?2004;1$y`, `${ESC}[4;2$y`]) {
    assert.equal(isTerminalReport(data), true, JSON.stringify(data));
  }
});

test("window size reports are reports", () => {
  for (const data of [`${ESC}[4;600;800t`, `${ESC}[6;17;8t`, `${ESC}[8;37;111t`]) {
    assert.equal(isTerminalReport(data), true, JSON.stringify(data));
  }
});

test("focus reports are reports", () => {
  assert.equal(isTerminalReport(`${ESC}[I`), true);
  assert.equal(isTerminalReport(`${ESC}[O`), true);
});

test("DCS and OSC replies are reports", () => {
  for (const data of [
    `${ESC}P1$r0;1r${ESC}\\`,
    `${ESC}P0$r${ESC}\\`,
    `${ESC}P>|xterm.js(6.0.0)${ESC}\\`,
    `${ESC}]11;rgb:0d0d/1111/1717${ESC}\\`,
    `${ESC}]4;1;rgb:ffff/7b7b/7272${ESC}\\`,
    `${ESC}]10;rgb:c9c9/d1d1/d9d9\x07`,
  ]) {
    assert.equal(isTerminalReport(data), true, JSON.stringify(data));
  }
});

test("typed text, control keys and pastes are not reports", () => {
  for (const data of ["a", "ls\r", "\r", "\x7f", "\x03", "\x0c", "hello world", "R", "1;1R", "[I"]) {
    assert.equal(isTerminalReport(data), false, JSON.stringify(data));
  }
});

test("arrow, function, Alt and bracketed-paste keys are not reports", () => {
  for (const data of [
    `${ESC}[A`, // Up
    `${ESC}OA`, // Up in application cursor mode
    `${ESC}[1;5C`, // Ctrl+Right
    `${ESC}OR`, // F3
    `${ESC}[15~`, // F5
    `${ESC}[3~`, // Delete
    `${ESC}[Z`, // Shift+Tab
    ESC, // Escape
    `${ESC}P`, // Alt+Shift+P
    `${ESC}]`, // Alt+]
    `${ESC}[200~pasted${ESC}[201~`, // bracketed paste
  ]) {
    assert.equal(isTerminalReport(data), false, JSON.stringify(data));
  }
});

test("mouse reports, which come from the user's mouse, are not reports", () => {
  assert.equal(isTerminalReport(`${ESC}[<0;10;5M`), false);
  assert.equal(isTerminalReport(`${ESC}[<0;10;5m`), false);
  assert.equal(isTerminalReport(`${ESC}[M #!`), false);
});
