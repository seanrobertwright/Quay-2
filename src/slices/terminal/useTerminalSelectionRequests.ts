import { useEffect, useRef } from "react";
import { namedTerminal, onTerminalSelectionRequest } from "./terminalSelectionRequest.ts";
import type { TerminalInfo } from "./types.ts";

/** Answers the requests to select one of `terminals` by selecting it with `select`. */
export function useTerminalSelectionRequests(terminals: readonly TerminalInfo[], select: (terminalId: string) => void): void {
  const now = useRef({ terminals, select });
  useEffect(() => {
    now.current = { terminals, select };
  });
  useEffect(
    () =>
      onTerminalSelectionRequest((request) => {
        const found = namedTerminal(now.current.terminals, request);
        if ("kind" in found) return found;
        now.current.select(found.id);
        return { kind: "selected" };
      }),
    [],
  );
}
