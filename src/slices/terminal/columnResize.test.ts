/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { paneTerminalOptions, windowsPtyFor } from "./terminalOptions.ts";
import { createColumnResizeGuard, syncTerminalSize, type PtySizeState } from "./terminalResize.ts";

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
});

const xtermPkg = await import("@xterm/xterm");
const Terminal = xtermPkg.Terminal ?? (xtermPkg.default as unknown as typeof xtermPkg).Terminal;
type XTerm = InstanceType<typeof Terminal>;

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

type RecordedEvent = { out: string } | { resize: { rows: number; cols: number } };

function writeAsync(term: XTerm, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function numberedLineCounts(term: XTerm, pattern: RegExp): Map<number, number> {
  const counts = new Map<number, number>();
  const buf = term.buffer.active;
  for (let i = 0; i < buf.length; i++) {
    const match = pattern.exec(buf.getLine(i)?.translateToString(true) ?? "");
    if (match) {
      const n = Number(match[1]);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return counts;
}

async function replayFixture(
  fixtureName: string,
  initCols: number,
  initRows: number,
  pattern: RegExp
): Promise<Map<number, number>> {
  const rec = JSON.parse(
    readFileSync(new URL(`./fixtures/${fixtureName}`, import.meta.url), "utf8")
  ) as { events: RecordedEvent[] };

  const term = new Terminal({
    ...paneTerminalOptions(windowsPtyFor(WINDOWS_UA, 26200)),
    cols: initCols,
    rows: initRows,
  });
  const guard = createColumnResizeGuard();
  const lastSize: PtySizeState = { rows: initRows, cols: initCols };
  let nextCols = initCols;
  let nextRows = initRows;

  const fitAddon = {
    fit: () => term.resize(nextCols, nextRows),
    proposeDimensions: () => ({ cols: nextCols, rows: nextRows }),
  };

  for (const ev of rec.events) {
    if ("out" in ev) {
      await new Promise<void>((resolve) => {
        guard.write(term, ev.out, resolve);
      });
    } else {
      nextCols = ev.resize.cols;
      nextRows = ev.resize.rows;
      syncTerminalSize(
        {
          container: { clientWidth: nextCols * 8, clientHeight: nextRows * 16 },
          term,
          fitAddon,
          isVisible: true,
        },
        lastSize,
        {
          onSizeChanged: () => {},
          resizePty: async () => {},
        },
        guard
      );
    }
  }

  const counts = numberedLineCounts(term, pattern);
  term.dispose();
  return counts;
}

test("resizing across column counts (30x100 -> 20x60 -> 24x80) keeps all 60 lines with zero duplicates", async () => {
  const counts = await replayFixture("conpty-60-lines-column-resizes.json", 80, 24, /^row-(\d+)-of-60$/);
  const expected = new Map(Array.from({ length: 60 }, (_, i) => [i + 1, 1] as const));
  assert.deepEqual(counts, expected);
});

test("narrowing and widening across wrapped 52-char lines (32x70 <-> 32x23) keeps all 60 lines with zero duplicates", async () => {
  const counts = await replayFixture("conpty-60-lines-narrow-widen.json", 70, 32, /^line-(\d+)-x+$/);
  const expected = new Map(Array.from({ length: 60 }, (_, i) => [i + 1, 1] as const));
  assert.deepEqual(counts, expected);
});

test("resizing across column counts on the alternate screen leaves it untouched", async () => {
  const term = new Terminal({
    ...paneTerminalOptions(windowsPtyFor(WINDOWS_UA, 26200)),
    cols: 70,
    rows: 24,
  });
  await writeAsync(term, "normal-1\r\nnormal-2\r\n\x1b[?1049h\x1b[Halt-row-1");
  const guard = createColumnResizeGuard();
  const lastSize: PtySizeState = { rows: 24, cols: 70 };
  syncTerminalSize(
    {
      container: { clientWidth: 23 * 8, clientHeight: 24 * 16 },
      term,
      fitAddon: { fit: () => term.resize(23, 24), proposeDimensions: () => ({ cols: 23, rows: 24 }) },
      isVisible: true,
    },
    lastSize,
    { onSizeChanged: () => {}, resizePty: async () => {} },
    guard
  );
  await new Promise<void>((resolve) => guard.write(term, "\x1b[Halt-row-1-redrawn", resolve));
  assert.equal(term.buffer.active.type, "alternate");
  assert.equal(term.buffer.active.getLine(0)?.translateToString(true), "alt-row-1-redrawn");
  term.dispose();
});

test("repeated identical lines in the viewport are deduplicated using the longest overlap", async () => {
  const term = new Terminal({
    ...paneTerminalOptions(windowsPtyFor(WINDOWS_UA, 26200)),
    cols: 70,
    rows: 10,
  });
  await writeAsync(term, "header\r\nok\r\nmiddle\r\nok\r\nend\r\n");
  const guard = createColumnResizeGuard();
  const lastSize: PtySizeState = { rows: 10, cols: 70 };
  syncTerminalSize(
    {
      container: { clientWidth: 40 * 8, clientHeight: 10 * 16 },
      term,
      fitAddon: { fit: () => term.resize(40, 10), proposeDimensions: () => ({ cols: 40, rows: 10 }) },
      isVisible: true,
    },
    lastSize,
    { onSizeChanged: () => {}, resizePty: async () => {} },
    guard
  );
  await new Promise<void>((resolve) => guard.write(term, "\x1b[Hok\r\nmiddle\r\nok\r\nend\r\n", resolve));

  const lines: string[] = [];
  for (let i = 0; i < term.buffer.active.length; i++) {
    const line = term.buffer.active.getLine(i)?.translateToString(true) ?? "";
    if (line !== "") lines.push(line);
  }
  assert.deepEqual(lines, ["header", "ok", "middle", "ok", "end"]);
  term.dispose();
});
