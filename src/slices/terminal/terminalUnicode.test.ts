/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createClaudeUnicodeProvider, registerClaudeUnicodeProvider } from "./terminalUnicode.ts";

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
});

const xtermPkg = await import("@xterm/xterm");
const Terminal = xtermPkg.Terminal ?? (xtermPkg.default as unknown as typeof xtermPkg).Terminal;

const ESC = "\x1b";

function createTestTerminal(cols = 111, rows = 28) {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  registerClaudeUnicodeProvider(term);
  return term;
}

function writeAsync(term: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

test("ConPTY bottom status bar with U+1FABE (🪾) does not auto-wrap, scroll the screen, or shift cost columns", async () => {
  const term = createTestTerminal(111, 28);
  const statusRow =
    "  tools 0 this turn · 14 total  git ticket-217 · 1 changed  🪾  worktree AI-WS-SDK  cost $0.63  session 2h 58m  ";
  assert.equal([...statusRow].length, 111);

  await writeAsync(
    term,
    `${ESC}[?1049h${ESC}[2J${ESC}[Htop row stays at row 1` +
      `${ESC}[17;1H[ Name: wayfinder 355 ] [ × ]` +
      `${ESC}[24;1H> ` +
      `${ESC}[28;1H${statusRow}` +
      // ConPTY differential update changing "$0.63" (at ConPTY cols 89..93) to "$1.12"
      `${ESC}[28;90H1${ESC}[1C12` +
      // ConPTY differential update on row 17 assuming no vertical scroll occurred
      `${ESC}[17;23H]${ESC}[1C[` +
      // Place cursor on the prompt row (row 24, col 3)
      `${ESC}[24;3H`
  );

  const buf = term.buffer.active;
  assert.equal(buf.getLine(0)?.translateToString(true), "top row stays at row 1");
  assert.equal(buf.getLine(16)?.translateToString(true), "[ Name: wayfinder 355 ] [ × ]");
  assert.equal(buf.getLine(23)?.translateToString(true), "> ");
  assert.equal(
    buf.getLine(27)?.translateToString(true).trimEnd(),
    "  tools 0 this turn · 14 total  git ticket-217 · 1 changed  🪾  worktree AI-WS-SDK  cost $1.12  session 2h 58m"
  );
  // Cursor must remain on row 24 (0-indexed 23), col 3 (0-indexed 2) — right after "> "
  assert.equal(buf.cursorY, 23);
  assert.equal(buf.cursorX, 2);
  term.dispose();
});

test("U+FE0F variation selector widens BMP symbols (⏱️, ⚠️, ⚙️, ➡️) to 2 cells so ConPTY differential table updates align", async () => {
  const term = createTestTerminal(111, 28);
  await writeAsync(
    term,
    `${ESC}[?1049h${ESC}[2J${ESC}[H` +
      `${ESC}[10;3H│ ⏱️ Elapsed  │ About 32 min elapsed.` +
      // ConPTY differential update skipping 1 space after 2-cell "⏱️" (at cols 5..6)
      `${ESC}[10;5H⏱️${ESC}[1CEl${ESC}[1Cpsed ${ESC}[3CAbout 32 min elapsed.`
  );

  const line = term.buffer.active.getLine(9)?.translateToString(true);
  assert.equal(line, "  │ ⏱️ Elapsed  │ About 32 min elapsed.");
  term.dispose();
});

test("Unicode 15.1 emojis are 2 cells wide while Unicode 16.0+ and non-emoji supplementary symbols are 1 cell wide", () => {
  const term = createTestTerminal(80, 24);
  const baseProvider = (
    term as unknown as {
      _core: { unicodeService: { _providers: Record<string, Parameters<typeof createClaudeUnicodeProvider>[0]> } };
    }
  )._core.unicodeService._providers["6"];
  const provider = createClaudeUnicodeProvider(baseProvider);

  // Unicode <= 15.1 emojis that ConPTY renders as 2 cells wide
  for (const ch of ["📁", "📈", "🔄", "🔗", "🕐", "🚀", "🟡", "🟢", "🤖", "🧪", "✅", "✨", "⏳"]) {
    assert.equal(provider.wcwidth(ch.codePointAt(0)!), 2, `Expected width 2 for ${ch}`);
  }

  // Unicode 16.0+ emojis and non-emoji symbols that ConPTY renders as 1 cell wide
  for (const cp of [0x1fabe /* 🪾 */, 0x1fa89, 0x1fa8f, 0x1fac6, 0x1fadc, 0x1fadf, 0x1fae9, 0x1f000, 0x1f100]) {
    assert.equal(provider.wcwidth(cp), 1, `Expected width 1 for U+${cp.toString(16).toUpperCase()}`);
  }

  term.dispose();
});
