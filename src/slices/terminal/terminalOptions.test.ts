/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { paneTerminalOptions, parseWindowsBuildNumber, windowsPtyFor } from "./terminalOptions.ts";

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
});

const xtermPkg = await import("@xterm/xterm");
const Terminal = xtermPkg.Terminal ?? (xtermPkg.default as unknown as typeof xtermPkg).Terminal;

const ESC = "\x1b";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

function writeAsync(term: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

const numbered = (n: number) => `row-${n}-of-60`;

/** How many times each numbered line appears in the buffer, scrollback included. */
function copiesOfEachLine(term: InstanceType<typeof Terminal>): Map<number, number> {
  const buf = term.buffer.active;
  const copies = new Map<number, number>();
  for (let i = 0; i < buf.length; i++) {
    const match = /^row-(\d+)-of-60$/.exec(buf.getLine(i)?.translateToString(true) ?? "");
    if (match) copies.set(Number(match[1]), (copies.get(Number(match[1])) ?? 0) + 1);
  }
  return copies;
}

for (const buildNumber of [26200, null]) {
  test(`growing a Windows pane (build ${buildNumber ?? "unknown"}) keeps every line of a live CLI's output when ConPTY repaints its screen`, async () => {
    const term = new Terminal({ ...paneTerminalOptions(windowsPtyFor(WINDOWS_UA, buildNumber)), cols: 80, rows: 24 });
    let output = "";
    for (let n = 1; n <= 60; n++) output += `${numbered(n)}\r\n`;
    await writeAsync(term, output);

    // The pane grows: xterm is fitted first, then ConPTY answers resize_pty with a repaint of its
    // own screen from the first row, as recorded through portable-pty on Windows 11 build 26200.
    term.resize(80, 30);
    let repaint = `${ESC}[?25l${ESC}[8;30;80t${ESC}[H`;
    for (let n = 38; n <= 60; n++) repaint += `${numbered(n)}\r\n`;
    for (let row = 0; row < 7; row++) repaint += row < 6 ? `${ESC}[K\r\n` : `${ESC}[K`;
    repaint += `${ESC}[24;1H${ESC}[?25h`;
    await writeAsync(term, repaint);

    const copies = copiesOfEachLine(term);
    const expected = new Map(Array.from({ length: 60 }, (_, i) => [i + 1, 1] as const));
    assert.deepEqual(copies, expected);
    term.dispose();
  });
}

test("a pane off Windows is created without the windowsPty option", () => {
  const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  for (const userAgent of [linux, mac]) {
    assert.equal(windowsPtyFor(userAgent, 26200), undefined);
    assert.equal(Object.keys(paneTerminalOptions(windowsPtyFor(userAgent, 26200))).includes("windowsPty"), false);
  }
});

test("a Windows pane whose build number can't be read names only the ConPTY backend", () => {
  assert.deepEqual(windowsPtyFor(WINDOWS_UA, null), { backend: "conpty" });
  assert.deepEqual(paneTerminalOptions(windowsPtyFor(WINDOWS_UA, 26200)).windowsPty, {
    backend: "conpty",
    buildNumber: 26200,
  });
});

test("the Windows build number from the backend is a positive whole number, or refused", () => {
  assert.equal(parseWindowsBuildNumber(26200), 26200);
  assert.equal(parseWindowsBuildNumber(19045), 19045);
  for (const refused of [undefined, null, 0, -1, -26200, Number.NaN, Infinity, 26200.5, "26200", "", {}, 2 ** 53]) {
    assert.equal(parseWindowsBuildNumber(refused), null, `expected ${String(refused)} to be refused`);
  }
});
