/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
});

const xtermPkg = await import("@xterm/xterm");
const Terminal = xtermPkg.Terminal ?? (xtermPkg.default as unknown as typeof xtermPkg).Terminal;
type XTerm = InstanceType<typeof Terminal>;

type RecordedEvent = { out: string } | { resize: { rows: number; cols: number } };

/** A new ConPTY's output for a live `cmd` child, recorded with its cursor query answered row 1. */
const recording = JSON.parse(
  readFileSync(new URL("./fixtures/conpty-cmd-five-lines-from-row-1.json", import.meta.url), "utf8")
) as { cursorReply: string; events: RecordedEvent[] };

const ROWS = 24;
const COLS = 80;

/**
 * The first chunk a relaunched session sends when its pane held earlier output, at the PTY's 24
 * rows: one line end per row, which scrolls everything the pane showed into scrollback, then the
 * cursor home. `PtySession::spawn` sends it; its Rust test pins the same text.
 */
const RELAUNCH_CHUNK = "\r\n".repeat(ROWS) + "\x1b[H";

function writeAsync(term: XTerm, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

/** How many times each line of the buffer, scrollback included, appears. */
function lineCounts(term: XTerm): Map<string, number> {
  const counts = new Map<string, number>();
  const buf = term.buffer.active;
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i)?.translateToString(true).trim() ?? "";
    if (line !== "") counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

for (const prior of [23, 40]) {
  test(`a relaunched pane that held ${prior} lines keeps them and all of the new console's lines across resizes`, async () => {
    // As the pane is created on Windows once #813 lands
    const term = new Terminal({
      cols: COLS,
      rows: ROWS,
      scrollback: 5000,
      allowProposedApi: true,
      windowsPty: { backend: "conpty", buildNumber: 26200 },
    });
    const replies: string[] = [];
    term.onData((data) => replies.push(data));

    // What the earlier session printed, which the new ConPTY never sees
    for (let i = 1; i <= prior; i++) await writeAsync(term, `prior-line-${i}\r\n`);
    await writeAsync(term, RELAUNCH_CHUNK);

    for (const event of recording.events) {
      if ("out" in event) {
        await writeAsync(term, event.out);
        if (event.out.includes("\x1b[6n")) {
          assert.deepEqual(replies, [recording.cursorReply], "the new ConPTY starts on the pane's first row");
        }
      } else {
        // The pane fits first and ConPTY's answer to the resize follows, as `syncTerminalSize` orders them
        term.resize(event.resize.cols, event.resize.rows);
      }
    }

    const counts = lineCounts(term);
    for (let i = 1; i <= prior; i++) assert.equal(counts.get(`prior-line-${i}`), 1, `prior-line-${i}`);
    for (let i = 1; i <= 5; i++) assert.equal(counts.get(`row-${i}-of-5`), 1, `row-${i}-of-5`);
    term.dispose();
  });
}
