// What a surface may cause, each at the operator's click and never otherwise.
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestFileDiff, type FileDiffRequest } from "../git/fileDiffRequest.ts";
import { requestTerminalFocus } from "../terminal/terminalFocusRequest.ts";
import { spendClick } from "./clickOnly.ts";
import { shownAddress } from "./imageTarget.ts";
import type { SurfaceEffects } from "./links.ts";
import { webTarget } from "./linkTarget.ts";

/** How Rust showed a file. Mirrors `Shown`. */
type Shown = { kind: "revealed" } | ({ kind: "diff" } & Omit<FileDiffRequest, "terminalId">);

async function open(url: string): Promise<string | null> {
  const target = webTarget(url);
  if (!target) return "Not opened: the link is not to a web address.";
  try {
    await openUrl(target.address);
    return null;
  } catch (error) {
    return `Not opened: the browser could not be started (${String(error)}).`;
  }
}

async function show(terminalId: string, path: string, line: number | null): Promise<string | null> {
  try {
    const shown = await invoke<Shown>("surface_show_file", { terminalId, path, line });
    if (shown.kind === "revealed") return null;
    const { worktree, path: inWorktree, side, line: shownLine } = shown;
    if (requestFileDiff({ terminalId, worktree, path: inWorktree, side, line: shownLine })) return null;
    return `Not opened: the diff view is not there for ${shown.path}. Select its terminal and try again.`;
  } catch (error) {
    return String(error);
  }
}

function focus(terminalId: string, target: string): string | null {
  if (target === "") return "Not shown: no terminal is named.";
  const outcome = requestTerminalFocus({ fromTerminalId: terminalId, target });
  switch (outcome?.kind) {
    case undefined:
      return "Not shown: Quay could not be asked to show a terminal.";
    case "selected":
      return null;
    case "asker_gone":
      return "Not shown: Quay no longer has this terminal.";
    case "none":
      return `Not shown: this project has no terminal "${shownAddress(target)}".`;
    case "ambiguous":
      return `Not shown: ${outcome.count} terminals of this project are named "${shownAddress(target)}".`;
  }
}

async function copy(text: string): Promise<string | null> {
  if (text === "") return "Not copied: there is no text to copy.";
  try {
    await navigator.clipboard.writeText(text);
    return null;
  } catch (error) {
    return `Not copied: the clipboard could not be written (${String(error)}).`;
  }
}

/**
 * The effects of `terminalId`'s surfaces. `run` takes each effect, which settles with why it did
 * nothing, or null.
 */
export function surfaceEffects(terminalId: string, run: (effect: Promise<string | null>) => void): SurfaceEffects {
  return {
    openUrl: (url) => {
      spendClick("openUrl");
      run(open(url));
    },
    showFile: (path, line) => {
      spendClick("showFile");
      run(show(terminalId, path, line ?? null));
    },
    focusTerminal: (target) => {
      spendClick("focusTerminal");
      run(Promise.resolve(focus(terminalId, target)));
    },
    copyText: (text) => {
      spendClick("copyText");
      run(copy(text));
    },
  };
}
