// Typing a command into a newly spawned shell terminal (#395): the one place Quay writes a
// command line into a PTY for the operator to run, as Topos's Run in terminal does.

import { invoke } from "@tauri-apps/api/core";

/** The shell a Quay shell terminal runs: PowerShell (`pwsh`) on Windows, `sh` elsewhere. */
export type TerminalShell = "pwsh" | "sh";

/** The shell a shell terminal runs on the platform `userAgent` names. */
export function shellFor(userAgent: string): TerminalShell {
  return /Windows/i.test(userAgent) ? "pwsh" : "sh";
}

/** Any C0 control character or DEL; typed into a PTY, one could press Enter or move the cursor. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** PowerShell's single quotes: the straight one and the curly ones it also accepts. */
const PWSH_QUOTES = /['‘’‚‛]/g;

/**
 * `argv` as one command line for `shell`, every argument quoted so that each reaches the program
 * as it is, whatever it holds: a ref or remote name can't run a command. Null when an argument
 * holds a control character, which no quoting keeps from acting on the terminal, or for PowerShell
 * is `--%`, its stop-parsing token, which it drops even when quoted.
 */
export function commandLine(argv: readonly string[], shell: TerminalShell): string | null {
  if (argv.length === 0 || argv.some((arg) => CONTROL.test(arg))) return null;
  if (shell === "pwsh") {
    if (argv.includes("--%")) return null;
    // A quoted first word is a string to PowerShell, so the call operator runs it.
    return `& ${argv.map((arg) => `'${arg.replace(PWSH_QUOTES, (q) => q + q)}'`).join(" ")}`;
  }
  return argv.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`).join(" ");
}

/**
 * Types `argv`, quoted for `shell`, into the terminal `terminalId` and presses Enter. Resolves to
 * false, typing nothing, when an argument can't be typed safely (see `commandLine`).
 */
export async function typeCommand(terminalId: string, argv: readonly string[], shell: TerminalShell): Promise<boolean> {
  const line = commandLine(argv, shell);
  if (line === null) return false;
  await invoke("write_pty", { terminalId, data: `${line}\r` });
  return true;
}
