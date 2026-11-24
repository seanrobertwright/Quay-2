// Whether a terminal's CLI has shaken hands with Quay's MCP server since its launch (#733), as Rust
// keeps it with the launch.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** `Handshake` in `src-tauri/src/slices/pty/handshake.rs`. */
interface Handshake {
  seen: boolean;
  /** How much of the launch's grace is left, in milliseconds. */
  grace_left_ms: number;
}

/** Whether the terminal's launch has had its grace and its CLI has not shaken hands. */
export function useNoHandshake(terminalId: string): boolean {
  // The terminal it was found of, so that nothing found of one is said of another
  const [lateTerminal, setLateTerminal] = useState<string | null>(null);

  useEffect(() => {
    let drawn = true;
    let newest = 0;
    let timer: number | undefined;
    const read = async () => {
      if (!drawn) return;
      const mine = (newest += 1);
      window.clearTimeout(timer);
      let handshake: Handshake | null = null;
      try {
        handshake = await invoke<Handshake | null>("terminal_handshake", { terminalId });
      } catch (error) {
        console.warn(`Could not read the handshake of ${terminalId}:`, error);
      }
      if (!drawn || mine !== newest) return;
      const graceLeft = handshake && !handshake.seen ? handshake.grace_left_ms : null;
      setLateTerminal(graceLeft === 0 ? terminalId : null);
      // Read again when the grace is over, so it is Rust that says it is
      if (graceLeft) timer = window.setTimeout(() => void read(), graceLeft);
    };
    const listening = listen<{ terminal_id: string }>("terminal-handshake", ({ payload }) => {
      if (payload.terminal_id === terminalId) void read();
    });
    // Once it listens, so that nothing is missed between the two
    void listening.then(read);
    return () => {
      drawn = false;
      window.clearTimeout(timer);
      void listening.then((unlisten) => unlisten());
    };
  }, [terminalId]);

  return lateTerminal === terminalId;
}
