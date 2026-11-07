import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";

/**
 * Sorted inclusive `[start, end]` code point ranges outside Unicode 6.0 East Asian Wide
 * that Windows ConPTY (`conhost.exe`, Unicode 15.1) lays out as 2 cells wide.
 *
 * ConPTY sits between the child process and xterm.js: every cursor move (`ESC[row;colH`,
 * `ESC[nC`) and right-margin space pad emitted over the PTY pipe is computed from
 * `conhost.exe`'s screen buffer grid. Using ConPTY's exact width ranges keeps xterm.js
 * in lockstep with `conhost.exe` regardless of the host WebView2 runtime's Unicode version,
 * so Unicode 16.0+ additions that `conhost.exe` treats as 1 cell wide (such as `U+1FABE`
 * `🪾` in Claude Code's worktree status bar) never expand a 111-cell status line to 112
 * cells, auto-wrap the bottom row, scroll the screen up, or shift differential updates.
 */
const CONPTY_WIDE_RANGES: ReadonlyArray< readonly [number, number] > = [
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x16fe0, 0x16fe4],
  [0x16ff0, 0x16ff1],
  [0x17000, 0x187f7],
  [0x18800, 0x18cd5],
  [0x18d00, 0x18d08],
  [0x1aff0, 0x1aff3],
  [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe],
  [0x1b000, 0x1b122],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f1e6, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1fa7c],
  [0x1fa80, 0x1fa88],
  [0x1fa90, 0x1fabd],
  [0x1fabf, 0x1fac5],
  [0x1face, 0x1fadb],
  [0x1fae0, 0x1fae8],
  [0x1faf0, 0x1faf8],
];

function isConptyWideCodepoint(codepoint: number): boolean {
  let lo = 0;
  let hi = CONPTY_WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = CONPTY_WIDE_RANGES[mid];
    if (codepoint < start) {
      hi = mid - 1;
    } else if (codepoint > end) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Creates an xterm.js Unicode provider that matches Windows ConPTY (`conhost.exe`)
 * cell widths for emojis and Variation Selector-16 (U+FE0F, e.g. "⚙️", "⚠️", "⏱️").
 * Without this, xterm's default UnicodeV6 treats U+2699 U+FE0F ("⚙️") as 1 cell wide
 * while ConPTY counts it as 2 cells wide, shifting subsequent columns.
 */
export function createClaudeUnicodeProvider(
  baseProvider: IUnicodeVersionProvider
): IUnicodeVersionProvider {
  return {
    version: "11-claude",
    wcwidth(codepoint: number): 0 | 1 | 2 {
      const baseWidth = baseProvider.wcwidth(codepoint);
      if (baseWidth === 0 || baseWidth === 2) {
        return baseWidth;
      }
      if (codepoint >= 0x231a && codepoint <= 0x1faf8 && isConptyWideCodepoint(codepoint)) {
        return 2;
      }
      return baseWidth;
    },
    charProperties(codepoint: number, preceding: number): number {
      // U+FE0F (Variation Selector-16) widens a preceding 1-cell character (like U+2699 ⚙) to 2 cells
      if (codepoint === 0xfe0f && preceding !== 0) {
        // Property bit layout in xterm UnicodeService: (charKind << 3) | (width << 1) | (shouldJoin ? 1 : 0)
        return (2 << 1) | 1;
      }
      let width = this.wcwidth(codepoint);
      let shouldJoin = width === 0 && preceding !== 0;
      if (shouldJoin) {
        const oldWidth = (preceding >> 1) & 3;
        if (oldWidth === 0) {
          shouldJoin = false;
        } else if (oldWidth > width) {
          width = oldWidth as 0 | 1 | 2;
        }
      }
      return (width << 1) | (shouldJoin ? 1 : 0);
    },
  };
}

/**
 * Registers the ConPTY-aligned Unicode width provider on an xterm.js `Terminal` instance.
 */
export function registerClaudeUnicodeProvider(term: Terminal): void {
  try {
    const coreUnicode = (
      term as unknown as {
        _core?: {
          unicodeService?: {
            _providers?: Record<string, IUnicodeVersionProvider>;
          };
        };
      }
    )._core?.unicodeService;
    const baseProvider = coreUnicode?._providers?.["6"];
    if (baseProvider && term.unicode) {
      term.unicode.register(createClaudeUnicodeProvider(baseProvider));
      term.unicode.activeVersion = "11-claude";
    }
  } catch (err) {
    console.warn("Could not register custom unicode provider:", err);
  }
}
