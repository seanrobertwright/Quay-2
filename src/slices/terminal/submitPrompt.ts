import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PtyOutputPayload, TerminalOutputPayload } from "./types";

// Agent TUIs read text and Enter that arrive in one chunk as a paste and leave it unsent,
// so Enter goes in its own write after this pause
const SUBMIT_DELAY_MS = 250;
// A new agent starts reading input once it draws its first screen; output going quiet marks that
const STARTUP_QUIET_MS = 1000;
const STARTUP_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves once the terminal has printed output and then gone quiet, or after the timeout. */
function waitForStartupToSettle(terminalId: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(quietTimer);
      clearTimeout(deadline);
      unlisten?.();
      resolve();
    };
    const armQuietTimer = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, STARTUP_QUIET_MS);
    };
    const deadline = setTimeout(finish, STARTUP_TIMEOUT_MS);

    listen<PtyOutputPayload>("pty-output", (event) => {
      if (event.payload.terminal_id === terminalId) armQuietTimer();
    })
      .then(async (fn) => {
        if (settled) {
          fn();
          return;
        }
        unlisten = fn;
        // Output printed before the listener attached still means the agent has started
        const snapshot = await invoke<TerminalOutputPayload>("get_terminal_output", { terminalId });
        if (!settled && snapshot.last_seq > 0) armQuietTimer();
      })
      .catch(finish);
  });
}

/**
 * Types `prompt` into an agent terminal and presses Enter. Pass `awaitStartup` for a terminal
 * spawned moments ago, so the prompt is not read together with Enter while the agent starts.
 */
export async function submitPromptToTerminal(
  terminalId: string,
  prompt: string,
  options: { awaitStartup?: boolean } = {}
): Promise<void> {
  if (options.awaitStartup) {
    await waitForStartupToSettle(terminalId);
  }
  await invoke("write_pty", { terminalId, data: prompt });
  await sleep(SUBMIT_DELAY_MS);
  await invoke("write_pty", { terminalId, data: "\r" });
}
