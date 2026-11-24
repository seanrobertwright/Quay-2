// What a surface may cause, each at the operator's click and never otherwise.
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { requestFileDiff } from "../git/fileDiffRequest.ts";
import type { Side } from "../git/topos/stagingLists.ts";
import { spendClick } from "./clickOnly.ts";
import type { SurfaceEffects } from "./links.ts";
import { webTarget } from "./linkTarget.ts";

/** How Rust showed a file. Mirrors `Shown`. */
type Shown = { kind: "revealed" } | { kind: "diff"; path: string; side: Side; line: number | null };

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
    if (shown.kind === "revealed" || requestFileDiff({ terminalId, path: shown.path, side: shown.side, line: shown.line })) return null;
    return `Not opened: the diff view is not there for ${shown.path}. Select its terminal and try again.`;
  } catch (error) {
    return String(error);
  }
}

/**
 * The effects of `terminalId`'s surfaces. `run` takes each effect, which settles with why it opened
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
  };
}
