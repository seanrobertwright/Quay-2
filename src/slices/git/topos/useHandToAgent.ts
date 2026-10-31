import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TerminalInfo } from "../../terminal/types";
import { errorMessage } from "./gitVersion";
import { handOffAgents, handOffPrompt, heldFiles, type HandOff, type HandOffRead, type PickerAgent } from "./handOff";
import type { OpState } from "./operation";
import { RequestIds } from "./refreshTable";

/** The picker, open for `paths`. */
export interface HandOffPicker {
  paths: string[];
  /** The live agent terminals in the worktree, in terminal order. */
  agents: PickerAgent[];
  sending: boolean;
  failure: string | null;
}

/** What the picker hands the files to: a running agent terminal, or a new one in the worktree. */
export type HandOffChoice = { kind: "agent"; agent: PickerAgent } | { kind: "new" };

export interface HandToAgent {
  /** Opens the picker for `paths`, or null while there is no worktree to hand them in. */
  hand: ((paths: string[]) => void) | null;
  /** Why the action is disabled, shown as its tooltip and description, or null when it isn't. */
  unavailable: string | null;
  /** The worktree's files an agent holds, by path. Topos doesn't write them. */
  held: ReadonlyMap<string, HandOff>;
  /** Takes `path` back from its agent, so Topos may write it again. */
  takeBack: (path: string) => void;
  picker: HandOffPicker | null;
  choose: (choice: HandOffChoice) => void;
  closePicker: () => void;
}

export interface HandToAgentOptions {
  worktreePath: string | null;
  /** The worktree's operation, whose conflicts and labels the prompt names; null until read. */
  op: OpState | null;
  terminals: readonly TerminalInfo[];
  /** Starts an agent terminal in `cwd`, resolving with it, or null when it couldn't start. */
  onNewAgent?: (cwd: string) => Promise<TerminalInfo | null>;
  announce: (text: string) => void;
}

/** `paths` in a sentence: the one path, or how many. */
function filesWord(paths: readonly string[]): string {
  return paths.length === 1 ? paths[0] : `${paths.length.toLocaleString()} files`;
}

/**
 * The one place a conflict's "Hand to agent" action is wired (#352, #392). The picker offers the
 * live agent terminals whose cwd is the worktree, and "New agent here". Choosing one records the
 * files as held by that agent first, so Topos refuses to write them from then on, and then sends the
 * agent the resolve-and-stage-only prompt through the orchestrator router (`a2a_send_prompt`, the
 * router path `quay_send_message` takes). When the router refuses it, the files are taken back.
 * The hand-offs are read again with each read of the operation, and only for the worktree they
 * were read for.
 */
export function useHandToAgent({ worktreePath, op, terminals, onNewAgent, announce }: HandToAgentOptions): HandToAgent {
  const [read, setRead] = useState<HandOffRead | null>(null);
  const [picker, setPicker] = useState<{ paths: string[]; sending: boolean; failure: string | null } | null>(null);
  const path = useRef(worktreePath);
  path.current = worktreePath;
  const ids = useRef(new RequestIds());

  /** Keeps `handOffs` when they answer the newest request for the worktree still selected. */
  const keep = useCallback((worktree: string, id: number, handOffs: HandOff[]) => {
    if (ids.current.isLatest(id) && path.current === worktree) setRead({ worktreePath: worktree, handOffs });
  }, []);

  useEffect(() => {
    setPicker(null);
  }, [worktreePath]);

  // Read with each read of the operation: a file the agent staged has left the unmerged set, and
  // the backend drops its hand-off then.
  useEffect(() => {
    const id = ids.current.next();
    if (worktreePath === null) return;
    invoke<HandOff[]>("git_conflict_hand_offs", { worktreePath }).then(
      (handOffs) => keep(worktreePath, id, handOffs),
      (e: unknown) => console.error("Couldn't read the hand-offs:", e)
    );
  }, [worktreePath, op, keep]);

  const held = useMemo(() => (worktreePath === null ? new Map<string, HandOff>() : heldFiles(read, worktreePath, op)), [read, worktreePath, op]);

  const hand = useCallback((paths: string[]) => {
    if (paths.length > 0) setPicker({ paths, sending: false, failure: null });
  }, []);

  const takeBack = useCallback(
    (file: string) => {
      const worktree = worktreePath;
      if (worktree === null) return;
      const id = ids.current.next();
      invoke<HandOff[]>("git_conflict_take_back", { worktreePath: worktree, paths: [file] }).then(
        (handOffs) => {
          keep(worktree, id, handOffs);
          announce(`Took ${file} back. Topos can change it again.`);
        },
        (e: unknown) => announce(`Couldn't take ${file} back: ${errorMessage(e)}`)
      );
    },
    [worktreePath, keep, announce]
  );

  const choose = useCallback(
    (choice: HandOffChoice) => {
      const worktree = worktreePath;
      if (worktree === null || op === null || picker === null || picker.sending) return;
      const { paths } = picker;
      const fail = (message: string) => setPicker((p) => (p === null ? p : { ...p, sending: false, failure: message }));
      setPicker({ ...picker, sending: true, failure: null });
      void (async () => {
        let agent: PickerAgent;
        if (choice.kind === "agent") {
          agent = choice.agent;
        } else {
          const started = onNewAgent ? await onNewAgent(worktree) : null;
          if (started === null) {
            fail("Quay couldn't start an agent terminal here.");
            return;
          }
          agent = { terminalId: started.id, name: started.name, runKind: started.run_kind };
        }
        // Held first, so nothing in Topos writes the files once the agent may be working on them.
        try {
          const handOffs = await invoke<HandOff[]>("git_conflict_hand_off", {
            worktreePath: worktree,
            paths,
            agent: { terminalId: agent.terminalId, name: agent.name },
          });
          keep(worktree, ids.current.next(), handOffs);
        } catch (e) {
          fail(`Couldn't hand ${filesWord(paths)} to ${agent.name}: ${errorMessage(e)}`);
          return;
        }
        try {
          await invoke("a2a_send_prompt", {
            request: { from_terminal: "", to_terminal: agent.terminalId, prompt: handOffPrompt(op, paths), as_user: true },
          });
        } catch (e) {
          const id = ids.current.next();
          await invoke<HandOff[]>("git_conflict_take_back", { worktreePath: worktree, paths }).then(
            (handOffs) => keep(worktree, id, handOffs),
            (err: unknown) => console.error("Couldn't take the files back:", err)
          );
          fail(`${agent.name} didn't get the prompt, so ${filesWord(paths)} stayed with you: ${errorMessage(e)}`);
          return;
        }
        setPicker(null);
        announce(`Handed ${filesWord(paths)} to ${agent.name}. Topos leaves it alone until ${agent.name} stages it or you take it back.`);
      })();
    },
    [worktreePath, op, picker, onNewAgent, keep, announce]
  );

  const closePicker = useCallback(() => {
    setPicker((p) => (p?.sending ? p : null));
  }, []);

  const agents = useMemo(() => (worktreePath === null ? [] : handOffAgents(terminals, worktreePath)), [terminals, worktreePath]);
  const shown = useMemo(() => (picker === null ? null : { ...picker, agents }), [picker, agents]);

  return {
    hand: worktreePath === null ? null : hand,
    unavailable: worktreePath === null ? "Pick a worktree first." : null,
    held,
    takeBack,
    picker: shown,
    choose,
    closePicker,
  };
}
