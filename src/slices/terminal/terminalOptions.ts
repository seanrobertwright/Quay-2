import type { ITerminalOptions, IWindowsPty } from "@xterm/xterm";

/**
 * The Windows build number `windows_build_number` answered, or null for anything that is not a
 * positive whole number: a missing, zero, negative, fractional or non-numeric value never reaches
 * xterm, which would read `NaN` or 0 as "an old build" and turn reflow off.
 */
export function parseWindowsBuildNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * xterm's `windowsPty` option for a pane on the platform `userAgent` names, or undefined off
 * Windows. On Windows every PTY is a ConPTY, which answers a taller pane with a repaint from its
 * first row; with the option set, xterm adds empty rows below the output instead of pulling lines
 * back from scrollback for that repaint to overwrite.
 *
 * `buildNumber` is the Windows build, already parsed. Without it the option names only the
 * backend: growing a pane still keeps every line, and reflow stays on as it was before the option.
 */
export function windowsPtyFor(userAgent: string, buildNumber: number | null): IWindowsPty | undefined {
  if (!/Windows/i.test(userAgent)) return undefined;
  return buildNumber === null ? { backend: "conpty" } : { backend: "conpty", buildNumber };
}

/** The options every terminal pane's xterm is created with, in Quay's dark palette. */
export function paneTerminalOptions(windowsPty: IWindowsPty | undefined): ITerminalOptions {
  return {
    cursorBlink: true,
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.2,
    theme: {
      background: "#0d1117",
      foreground: "#c9d1d9",
      cursor: "#58a6ff",
      cursorAccent: "#0d1117",
      selectionBackground: "#1f6feb40",
      black: "#484f58",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd",
      brightWhite: "#f0f6fc",
    },
    allowTransparency: true,
    scrollback: 5000,
    // `term.unicode` is a proposed API; without this registerClaudeUnicodeProvider never registers
    allowProposedApi: true,
    ...(windowsPty ? { windowsPty } : {}),
  };
}
