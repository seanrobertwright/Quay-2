// What a surface may cause, each at the operator's click and never otherwise.
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestFileDiff, type FileDiffRequest } from "../git/fileDiffRequest.ts";
import { requestTerminalSelection } from "../terminal/terminalSelectionRequest.ts";
import { spendClick, type Effect, type UntypedTarget } from "./clickOnly.ts";
import type { SurfaceEffects } from "./links.ts";
import { webTarget } from "./linkTarget.ts";
import type { NoticeKind } from "./FrameNotice.tsx";
import { shownText } from "./shownText.ts";
import type { SurfaceKey } from "./surfaceTypes.ts";

/** How Rust showed a file. Mirrors `Shown`. */
type Shown = { kind: "revealed"; path: string; line: number | null } | ({ kind: "diff" } & Omit<FileDiffRequest, "terminalId">);

/** What the frame says after an effect: why it did nothing, or what it did that Quay's window does not show. */
export interface Notice {
  kind: NoticeKind;
  text: string;
}

const refusal = (text: string): Notice => ({ kind: "refusal", text });

/** That the file manager shows the file written as `path`, and that it cannot go to the `line` the link named. */
function revealed(path: string, line: number | null): Notice {
  const atLine = line === null ? "" : ` It cannot go to line ${line}.`;
  return { kind: "information", text: `Shown in the file manager: ${shownText(path)}.${atLine}` };
}

/** `effect`'s refusal, if it settles with one, as a notice. */
async function refused(effect: Promise<string | null> | string | null): Promise<Notice | null> {
  const why = await effect;
  return why === null ? null : refusal(why);
}

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

async function show(terminalId: string, path: string, line: number | null): Promise<Notice | null> {
  try {
    const shown = await invoke<Shown>("surface_show_file", { terminalId, path, line });
    if (shown.kind === "revealed") return revealed(shown.path, shown.line);
    const { worktree, path: inWorktree, side, line: shownLine } = shown;
    if (requestFileDiff({ terminalId, worktree, path: inWorktree, side, line: shownLine })) return null;
    return refusal(`Not opened: the diff view is not there for ${shown.path}. Select its terminal and try again.`);
  } catch (error) {
    return refusal(String(error));
  }
}

function focus(terminalId: string, target: string): string | null {
  if (target === "") return "Not shown: no terminal is named.";
  const outcome = requestTerminalSelection({ fromTerminalId: terminalId, target });
  switch (outcome?.kind) {
    case undefined:
      return "Not shown: Quay could not be asked to show a terminal.";
    case "selected":
      return null;
    case "asker_gone":
      return "Not shown: Quay no longer has this terminal.";
    case "none":
      return `Not shown: this project has no terminal "${shownText(target)}".`;
    case "ambiguous":
      return `Not shown: ${outcome.count} terminals of this project are named "${shownText(target)}".`;
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

const notRecorded = (error: unknown) => console.error("[surfaces] A function that fired could not be recorded", error);

/** Uses up the click on `surface` that allows `effect`, and tells Rust of it for the surface record. The effect does not wait for that. */
function spend({ terminal_id, id }: SurfaceKey, effect: Effect, target: string | null): void {
  const untyped = spendClick(effect);
  // A text that is copied is content, so it has no target
  const kept = target === null ? null : tried(untyped);
  invoke("surface_function_fired", { terminalId: terminal_id, id, function: effect, target: kept, targetTyped: kept !== target }).catch(notRecorded);
}

/** What `untyped` works out. Where it fails the effect runs all the same. */
function tried(untyped: UntypedTarget): string | null {
  try {
    return untyped();
  } catch (error) {
    notRecorded(error);
    return null;
  }
}

/**
 * The effects of `surface`. `run` takes each effect, which settles with the notice the frame is to show, or
 * null when there is nothing to say. That is why it did nothing, or, for a file the file manager shows, that it
 * shows it, since that window may open behind Quay's. Each is recorded as it fires, whether or not it does
 * something.
 */
export function surfaceEffects(surface: SurfaceKey, run: (effect: Promise<Notice | null>) => void): SurfaceEffects {
  const terminalId = surface.terminal_id;
  return {
    openUrl: (url) => {
      spend(surface, "openUrl", url);
      run(refused(open(url)));
    },
    showFile: (path, line) => {
      spend(surface, "showFile", path);
      run(show(terminalId, path, line ?? null));
    },
    focusTerminal: (target) => {
      spend(surface, "focusTerminal", target);
      run(refused(focus(terminalId, target)));
    },
    copyText: (text) => {
      spend(surface, "copyText", null);
      run(refused(copy(text)));
    },
  };
}
