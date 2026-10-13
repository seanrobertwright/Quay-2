import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalInfo, SpawnTerminalRequest } from "../terminal/types";

export interface Project {
  path: string;
  name: string;
  terminal_ids: string[];
  last_viewed_terminal?: string | null;
}

interface PtyExitPayload {
  terminal_id: string;
  exit_code?: number | null;
}

export function useWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>("E:\\Projects\\Quay2");
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [bridgePort, setBridgePort] = useState<number>(0);
  const [isNewTerminalOpen, setIsNewTerminalOpen] = useState(false);
  const [isA2AOpen, setIsA2AOpen] = useState(false);
  const [isActionLogOpen, setIsActionLogOpen] = useState(false);

  useEffect(() => {
    invoke<number>("get_bridge_port")
      .then((port) => {
        if (port) setBridgePort(port);
      })
      .catch(console.error);
  }, []);

  // Load projects and active terminals
  const refreshProjects = useCallback(async () => {
    try {
      const projs = await invoke<Project[]>("list_projects");
      setProjects(projs);
      const active = await invoke<string | null>("get_active_project");
      if (active) setActiveProject(active);
    } catch (err) {
      console.error("Failed to load projects:", err);
    }
  }, []);

  const refreshTerminals = useCallback(async () => {
    try {
      const terms = await invoke<TerminalInfo[]>("list_terminals");
      setTerminals(terms);
      if (terms.length > 0 && !activeTerminalId) {
        setActiveTerminalId(terms[0].id);
      }
    } catch (err) {
      console.error("Failed to load terminals:", err);
    }
  }, [activeTerminalId]);

  useEffect(() => {
    refreshProjects();
    refreshTerminals();
  }, [refreshProjects, refreshTerminals]);

  // Listen for terminal process exits
  useEffect(() => {
    const unlistenPromise = listen<PtyExitPayload>("terminal-exited", (event) => {
      const { terminal_id, exit_code } = event.payload;
      setTerminals((prev) =>
        prev.map((t) =>
          t.id === terminal_id
            ? { ...t, claude_status: "exited", exit_code }
            : t
        )
      );
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Spawn terminal
  const spawnTerminal = async (request: SpawnTerminalRequest) => {
    try {
      const newTerm = await invoke<TerminalInfo>("spawn_terminal", { request });
      setTerminals((prev) => [...prev, newTerm]);
      setActiveTerminalId(newTerm.id);
    } catch (err) {
      console.error("Failed to spawn terminal:", err);
    }
  };

  // Close / kill terminal
  const killTerminal = async (id: string) => {
    try {
      await invoke("kill_terminal", { terminalId: id });
      setTerminals((prev) => prev.filter((t) => t.id !== id));
      if (activeTerminalId === id) {
        const remaining = terminals.filter((t) => t.id !== id);
        setActiveTerminalId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err) {
      console.error("Failed to kill terminal:", err);
    }
  };

  // Keyboard shortcut listener (^b n and ^b 1..9)
  useEffect(() => {
    let ctrlBActive = false;
    let ctrlBTimer: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+B prefix sequence (tmux/psmux style)
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        ctrlBActive = true;
        clearTimeout(ctrlBTimer);
        ctrlBTimer = setTimeout(() => {
          ctrlBActive = false;
        }, 1500); // 1.5s prefix window
        return;
      }

      if (ctrlBActive) {
        if (e.key.toLowerCase() === "n") {
          e.preventDefault();
          setIsNewTerminalOpen(true);
          ctrlBActive = false;
          return;
        }

        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          e.preventDefault();
          const target = terminals[num - 1];
          if (target) {
            setActiveTerminalId(target.id);
          }
          ctrlBActive = false;
          return;
        }
      }

      // Also support standard Alt+1..9 or Ctrl+T for accessibility
      if (e.altKey && !isNaN(parseInt(e.key, 10))) {
        const num = parseInt(e.key, 10);
        const target = terminals[num - 1];
        if (target) {
          e.preventDefault();
          setActiveTerminalId(target.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [terminals]);

  return {
    projects,
    activeProject,
    terminals,
    activeTerminalId,
    bridgePort,
    setActiveTerminalId,
    setActiveProject,
    isNewTerminalOpen,
    setIsNewTerminalOpen,
    isA2AOpen,
    setIsA2AOpen,
    isActionLogOpen,
    setIsActionLogOpen,
    spawnTerminal,
    killTerminal,
  };
}
