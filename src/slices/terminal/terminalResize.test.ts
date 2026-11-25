/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { repaintTerminalScreen, syncTerminalSize, type PtySizeState } from "./terminalResize.ts";

test("resizing an already-fitted terminal calls resizePty for each size change", () => {
  const resized: Array<{ rows: number; cols: number }> = [];
  const lastSize: PtySizeState = { rows: 0, cols: 0 };
  const term = { rows: 24, cols: 80 };

  const target = {
    container: { clientWidth: 800, clientHeight: 600 },
    term,
    fitAddon: { fit: () => {} },
    isVisible: true,
  };

  const callbacks = {
    onSizeChanged: () => {},
    resizePty: async (rows: number, cols: number) => {
      resized.push({ rows, cols });
    },
  };

  // Initial fit
  assert.equal(syncTerminalSize(target, lastSize, callbacks), true);
  // Same size -> no-op
  assert.equal(syncTerminalSize(target, lastSize, callbacks), false);
  // Subsequent resize
  term.rows = 30;
  term.cols = 100;
  assert.equal(syncTerminalSize(target, lastSize, callbacks), true);

  assert.deepEqual(resized, [
    { rows: 24, cols: 80 },
    { rows: 30, cols: 100 },
  ]);
});

test("reloading when lastPtySize starts from backend dimensions updates resizePty cleanly", () => {
  const resized: Array<{ rows: number; cols: number }> = [];
  const lastSize: PtySizeState = { rows: 24, cols: 80 };
  const term = { rows: 25, cols: 82 };

  const changed = syncTerminalSize(
    {
      container: { clientWidth: 820, clientHeight: 620 },
      term,
      fitAddon: { fit: () => {} },
      isVisible: true,
    },
    lastSize,
    {
      onSizeChanged: () => {},
      resizePty: async (rows, cols) => {
        resized.push({ rows, cols });
      },
    }
  );

  assert.equal(changed, true);
  assert.deepEqual(resized, [{ rows: 25, cols: 82 }]);
});

test("explicit repaintTerminalScreen clears xterm and sends Ctrl+L (\\x0c)", () => {
  let cleared = false;
  const written: string[] = [];

  repaintTerminalScreen(
    {
      clear: () => {
        cleared = true;
      },
    },
    async (data) => {
      written.push(data);
    }
  );

  assert.equal(cleared, true);
  assert.deepEqual(written, ["\x0c"]);
});
