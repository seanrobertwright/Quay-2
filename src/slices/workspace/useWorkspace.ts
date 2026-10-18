import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  TerminalInfo,
  SpawnTerminalRequest,
  StageLayout,
  PermissionMode,
} from "../terminal/types";
import { Envelope } from "../bridge/useBridgeEvents";
import { Project } from "./types";
import { SwarmPreset } from "../orchestrator/swarmTypes";
import { GitWorktree } from "../git/types";
import { playTurnCompletedChime, playAttentionChime } from "../metrics/audioChime";
import { ClaudeTokenStats } from "../sessions/types";
import { isSamePath, isSubpathOf } from "../../utils/paths";
import { getGlobalTerminalDimensions } from "../terminal/useTerminal";

export type { Project };

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
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [isWorkspaceSettingsOpen, setIsWorkspaceSettingsOpen] = useState(false);
  const [workspaceSettingsTarget, setWorkspaceSettingsTarget] = useState<Project | null>(null);
  const [isSwarmModalOpen, setIsSwarmModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isDiffInspectorOpen, setIsDiffInspectorOpen] = useState(false);
  const [projectWorktrees, setProjectWorktrees] = useState<Record<string, GitWorktree[]>>({});
  const [isNewWorktreeOpen, setIsNewWorktreeOpen] = useState(false);
  const [worktreeModalTarget, setWorktreeModalTarget] = useState<{
    repoPath: string;
    projectName: string;
    suggestedIssueNumber?: number;
  } | null>(null);
  const [isGithubDrawerOpen, setIsGithubDrawerOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isSessionHistoryOpen, setIsSessionHistoryOpen] = useState(false);
  const [isTokenSpendOpen, setIsTokenSpendOpen] = useState(false);
  const [isArchonGraphOpen, setIsArchonGraphOpen] = useState(false);
  const [isFactoryStationOpen, setIsFactoryStationOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [claudeStats, setClaudeStats] = useState<ClaudeTokenStats | null>(null);

  // Multi-terminal layout and split pane state
  const [layout, setLayout] = useState<StageLayout>("single");
  const [primaryTerminalId, setPrimaryTerminalId] = useState<string | null>(null);
  const [secondaryTerminalId, setSecondaryTerminalId] = useState<string | null>(null);
  const [gridTerminalIds, setGridTerminalIds] = useState<[string | null, string | null, string | null, string | null]>([
    null,
    null,
    null,
    null,
  ]);
  const [focusedPane, setFocusedPane] = useState<
    "primary" | "secondary" | "grid-0" | "grid-1" | "grid-2" | "grid-3"
  >("primary");
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [zoomedFromLayout, setZoomedFromLayout] = useState<StageLayout | null>(null);

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

  const refreshClaudeStats = useCallback(async () => {
    try {
      const res = await invoke<ClaudeTokenStats>("get_claude_stats");
      setClaudeStats(res);
      return res;
    } catch (err) {
      console.error("Failed to load Claude token stats:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshProjects();
    refreshTerminals();
    refreshClaudeStats();
  }, [refreshProjects, refreshTerminals, refreshClaudeStats]);

  // Keep the spend figure current; rescans only re-read transcripts that changed
  useEffect(() => {
    const timer = setInterval(refreshClaudeStats, 120_000);
    return () => clearInterval(timer);
  }, [refreshClaudeStats]);

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

  // Listen for claude-mod-events bridge telemetry for live status, tool badges, and auto-naming
  useEffect(() => {
    const unlistenPromise = listen<Envelope>("bridge-event", (event) => {
      const envelope = event.payload;
      const tag = envelope.tag;
      if (!tag) return;

      setTerminals((prev) =>
        prev.map((t) => {
          if (t.id !== tag) return t;

          const updated = { ...t };
          switch (envelope.type) {
            case "turn.started": {
              updated.claude_status = "working";
              const rawPrompt =
                envelope.data?.prompt ||
                envelope.data?.text ||
                envelope.data?.query ||
                envelope.data?.user_input;
              if (rawPrompt && typeof rawPrompt === "string") {
                const clean = rawPrompt
                  .trim()
                  .replace(/^\[Message from peer agent[^\]]*\]:\s*/, "")
                  .split("\n")[0]
                  .trim()
                  .slice(0, 36);
                if (clean) {
                  updated.task_title = clean;
                  // Auto-update session display name if it hasn't been custom-named
                  if (
                    !t.custom_name &&
                    (t.name === "claude" ||
                      t.name === "claude.cmd" ||
                      t.name.startsWith("term-") ||
                      t.name.startsWith("claude-"))
                  ) {
                    updated.name = clean;
                  }
                }
              }
              break;
            }
            case "turn.completed": {
              playTurnCompletedChime();
              updated.claude_status = "idle";
              updated.current_tool = null;
              updated.tool_detail = null;
              break;
            }
            case "tool.started": {
              updated.claude_status = "working";
              const tool = envelope.data?.tool || "Tool";
              let detail = "";
              if (envelope.data?.input) {
                const inp = envelope.data.input;
                if (typeof inp === "object") {
                  detail =
                    inp.command ||
                    inp.file_path ||
                    inp.path ||
                    inp.pattern ||
                    inp.query ||
                    inp.prompt ||
                    "";
                } else if (typeof inp === "string") {
                  detail = inp;
                }
              }
              if (detail) {
                detail = detail.trim().split("\n")[0].trim().slice(0, 32);
              }
              updated.current_tool = tool;
              updated.tool_detail = detail || null;
              break;
            }
            case "tool.finished": {
              updated.current_tool = null;
              updated.tool_detail = null;
              updated.auto_approved_count = (updated.auto_approved_count || 0) + 1;
              break;
            }
            case "attention.notification": {
              playAttentionChime();
              updated.claude_status = "waiting";
              break;
            }
            case "session.started": {
              updated.claude_status = "idle";
              break;
            }
            case "session.ended": {
              updated.claude_status = "exited";
              updated.current_tool = null;
              updated.tool_detail = null;
              break;
            }
          }
          return updated;
        })
      );
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Listen for terminal output to transition 'starting' status to 'idle'
  useEffect(() => {
    const unlistenPromise = listen<{ terminal_id: string }>("pty-output", (event) => {
      const { terminal_id } = event.payload;
      setTerminals((prev) => {
        const target = prev.find((t) => t.id === terminal_id);
        if (target && target.claude_status === "starting") {
          return prev.map((t) =>
            t.id === terminal_id ? { ...t, claude_status: "idle" } : t
          );
        }
        return prev;
      });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Listen for A2A message dispatches to immediately update receiver's status and task title
  useEffect(() => {
    const unlistenPromise = listen<{
      id: string;
      from_terminal: string;
      to_terminal: string;
      content: string;
    }>("a2a-message-dispatched", (event) => {
      const { to_terminal, content } = event.payload;
      const cleanTitle = content.trim().replace(/^\[Peer agent[^\]]*\]:\s*/, "").slice(0, 36);

      setTerminals((prev) =>
        prev.map((t) => {
          if (t.id === to_terminal) {
            return {
              ...t,
              claude_status: "working",
              task_title: cleanTitle || t.task_title,
            };
          }
          return t;
        })
      );
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Add a new project workspace
  const addProject = async (path: string) => {
    try {
      const proj = await invoke<Project>("add_project", { path });
      await refreshProjects();
      await selectProject(proj.path);
    } catch (err) {
      console.error("Failed to add project:", err);
      throw err;
    }
  };

  // Remove a project workspace
  const removeProject = async (path: string) => {
    try {
      // Clean up any terminals belonging to this project
      const projectTerms = terminals.filter((t) => isSamePath(t.project_path, path) || isSubpathOf(t.project_path, path));
      for (const term of projectTerms) {
        try {
          await invoke("kill_terminal", { terminalId: term.id });
        } catch (e) {
          console.error("Failed to kill terminal during project removal:", e);
        }
      }
      setTerminals((prev) => prev.filter((t) => !isSamePath(t.project_path, path) && !isSubpathOf(t.project_path, path)));

      const updated = await invoke<Project[]>("remove_project", { path });
      setProjects(updated);

      if (isSamePath(activeProject, path)) {
        const nextActive = updated[0]?.path || "";
        setActiveProject(nextActive);
        const nextTerms = terminals.filter((t) => isSamePath(t.project_path, nextActive));
        setActiveTerminalId(nextTerms[0]?.id || null);
      }
    } catch (err) {
      console.error("Failed to remove project:", err);
    }
  };

  // Open workspace settings modal
  const openWorkspaceSettings = (target?: Project | string) => {
    let proj: Project | undefined;
    if (typeof target === "string") {
      proj = projects.find((p) => isSamePath(p.path, target));
    } else if (target) {
      proj = target;
    } else {
      proj = projects.find((p) => isSamePath(p.path, activeProject));
    }
    if (proj) {
      setWorkspaceSettingsTarget(proj);
      setIsWorkspaceSettingsOpen(true);
    }
  };

  const closeWorkspaceSettings = () => {
    setIsWorkspaceSettingsOpen(false);
    setWorkspaceSettingsTarget(null);
  };

  // Update project settings (env vars and default flags)
  const updateProjectSettings = async (
    path: string,
    envVars: Record<string, string>,
    defaultFlags?: string | null
  ) => {
    try {
      const updated = await invoke<Project>("update_project_settings", {
        path,
        envVars,
        defaultFlags: defaultFlags || null,
      });
      setProjects((prev) => prev.map((p) => (isSamePath(p.path, path) ? updated : p)));
      return updated;
    } catch (err) {
      console.error("Failed to update project settings:", err);
      throw err;
    }
  };

  // Launch a multi-agent swarm preset in active project
  const launchSwarm = async (preset: SwarmPreset) => {
    try {
      const dims = getGlobalTerminalDimensions();
      const spawnedTerms: TerminalInfo[] = [];
      for (const agent of preset.agents) {
        const term = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: activeProject,
            run_kind: agent.run_kind,
            name: agent.name,
            custom_flags: agent.custom_flags || null,
            cols: dims.cols,
            rows: dims.rows,
          },
        });
        spawnedTerms.push(term);
      }

      setTerminals((prev) => [...prev, ...spawnedTerms]);

      if (preset.layout === "single") {
        setLayout("single");
        setPrimaryTerminalId(spawnedTerms[0]?.id || null);
        setActiveTerminalId(spawnedTerms[0]?.id || null);
      } else if (preset.layout === "split-horizontal" || preset.layout === "split-vertical") {
        setLayout(preset.layout);
        setPrimaryTerminalId(spawnedTerms[0]?.id || null);
        setSecondaryTerminalId(spawnedTerms[1]?.id || spawnedTerms[0]?.id || null);
        setActiveTerminalId(spawnedTerms[0]?.id || null);
      } else if (preset.layout === "grid") {
        setLayout("grid");
        setGridTerminalIds([
          spawnedTerms[0]?.id || null,
          spawnedTerms[1]?.id || null,
          spawnedTerms[2]?.id || null,
          spawnedTerms[3]?.id || null,
        ]);
        setActiveTerminalId(spawnedTerms[0]?.id || null);
      }
    } catch (err) {
      console.error("Failed to launch swarm:", err);
      throw err;
    }
  };

  // Refresh git worktrees for a repo
  const refreshWorktrees = useCallback(async (repoPath: string) => {
    try {
      const list = await invoke<GitWorktree[]>("list_git_worktrees", { projectPath: repoPath });
      setProjectWorktrees((prev) => ({ ...prev, [repoPath]: list }));
      return list;
    } catch (err) {
      console.error("Failed to list worktrees:", err);
      return [];
    }
  }, []);

  // Auto-refresh worktrees when projects update
  useEffect(() => {
    projects.forEach((p) => {
      refreshWorktrees(p.path);
    });
  }, [projects, refreshWorktrees]);

  // Auto-refresh worktrees if any terminal belongs to a worktree subpath not yet cached
  useEffect(() => {
    projects.forEach((p) => {
      const knownWts = projectWorktrees[p.path] || [];
      const hasUnknownSubpath = terminals.some((t) => {
        if (!isSubpathOf(t.project_path, p.path)) return false;
        if (isSamePath(t.project_path, p.path)) return false;
        return !knownWts.some((wt) => isSamePath(wt.path, t.project_path));
      });
      if (hasUnknownSubpath) {
        refreshWorktrees(p.path);
      }
    });
  }, [projects, terminals, projectWorktrees, refreshWorktrees]);

  // Open New Worktree modal
  const openNewWorktreeModal = (repoPath?: string, suggestedIssueNumber?: number) => {
    const targetPath = repoPath || activeProject;
    const proj = projects.find((p) => isSamePath(p.path, targetPath)) || {
      name: targetPath.split(/[/\\]/).filter(Boolean).pop() || "Repo",
    };
    setWorktreeModalTarget({
      repoPath: targetPath,
      projectName: proj.name,
      suggestedIssueNumber,
    });
    setIsNewWorktreeOpen(true);
  };

  // Create a worktree and optionally launch Claude Code
  const createWorktree = async (
    repoPath: string,
    branch: string,
    newBranch: boolean,
    baseBranch?: string,
    launchClaude: boolean = true
  ) => {
    try {
      const created = await invoke<GitWorktree>("create_git_worktree", {
        request: {
          repo_path: repoPath,
          branch,
          new_branch: newBranch,
          base_branch: baseBranch || null,
          custom_path: null,
        },
      });

      await refreshWorktrees(repoPath);

      let term: TerminalInfo | null = null;
      if (launchClaude) {
        const dims = getGlobalTerminalDimensions();
        const branchClean = branch.replace(/^feat\//, "").replace(/^fix\//, "").replace(/^wayfinder\//, "");
        term = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: created.path,
            run_kind: "claude",
            name: `wt-${branchClean}`,
            cols: dims.cols,
            rows: dims.rows,
          },
        });
        setTerminals((prev) => [...prev, term!]);
        setActiveProject(created.path);
        setPrimaryTerminalId(term.id);
        setActiveTerminalId(term.id);
      }

      return { worktree: created, terminal: term };
    } catch (err) {
      console.error("Failed to create worktree:", err);
      throw err;
    }
  };

  // Remove a worktree
  const removeWorktree = async (repoPath: string, worktreePath: string, force: boolean = false) => {
    try {
      const matchingTerms = terminals.filter((t) => isSamePath(t.project_path, worktreePath));
      for (const term of matchingTerms) {
        try {
          await invoke("kill_terminal", { terminalId: term.id });
        } catch (e) {
          console.error(e);
        }
      }
      setTerminals((prev) => prev.filter((t) => t.project_path !== worktreePath));

      await invoke("remove_git_worktree", {
        repoPath,
        worktreePath,
        force,
      });

      await refreshWorktrees(repoPath);

      if (activeProject === worktreePath) {
        setActiveProject(repoPath);
      }
    } catch (err) {
      console.error("Failed to remove worktree:", err);
      throw err;
    }
  };

  // Resume an existing Claude session
  const resumeSession = async (sessionId: string, projectPath?: string) => {
    const targetPath = projectPath || activeProject;
    try {
      const shortId = sessionId.slice(0, 8);
      const term = await invoke<TerminalInfo>("spawn_terminal", {
        request: {
          project_path: targetPath,
          run_kind: "claude",
          name: `res-${shortId}`,
          custom_flags: `--resume ${sessionId}`,
        },
      });
      setTerminals((prev) => [...prev, term]);
      setActiveProject(targetPath);
      setPrimaryTerminalId(term.id);
      setActiveTerminalId(term.id);
      setIsSessionHistoryOpen(false);
      return term;
    } catch (err) {
      console.error("Failed to resume session:", err);
      throw err;
    }
  };

  // Visible terminals for active project
  const visibleTerminals = terminals.filter((t) => isSamePath(t.project_path, activeProject));

  // Keep primary and secondary terminal IDs synced with visible terminals
  useEffect(() => {
    if (visibleTerminals.length === 0) {
      if (primaryTerminalId) setPrimaryTerminalId(null);
      if (secondaryTerminalId) setSecondaryTerminalId(null);
      if (activeTerminalId) setActiveTerminalId(null);
      return;
    }

    // Ensure primaryTerminalId is valid
    let curPrimary = primaryTerminalId;
    if (!curPrimary || !visibleTerminals.some((t) => t.id === curPrimary)) {
      curPrimary = visibleTerminals[0].id;
      setPrimaryTerminalId(curPrimary);
      if (focusedPane === "primary" || !activeTerminalId) {
        setActiveTerminalId(curPrimary);
      }
    }

    // Ensure secondaryTerminalId is valid in split layout
    if (layout === "split-horizontal" || layout === "split-vertical") {
      let curSecondary = secondaryTerminalId;
      if (
        !curSecondary ||
        !visibleTerminals.some((t) => t.id === curSecondary) ||
        curSecondary === curPrimary
      ) {
        const other = visibleTerminals.find((t) => t.id !== curPrimary);
        if (other) {
          setSecondaryTerminalId(other.id);
          if (focusedPane === "secondary") {
            setActiveTerminalId(other.id);
          }
        } else {
          // If only 1 terminal remains, fall back to single view
          setLayout("single");
          setSecondaryTerminalId(null);
          setFocusedPane("primary");
          setActiveTerminalId(curPrimary);
        }
      }
    }
  }, [
    visibleTerminals,
    activeTerminalId,
    primaryTerminalId,
    secondaryTerminalId,
    layout,
    focusedPane,
  ]);

  // Switch active project
  const selectProject = async (path: string, targetTerminalId?: string) => {
    try {
      await invoke("set_active_project", { path });
      setActiveProject(path);

      // Select terminal belonging to this project if one exists
      const projectTerms = terminals.filter((t) => isSamePath(t.project_path, path));
      if (projectTerms.length > 0) {
        const chosenId =
          targetTerminalId && projectTerms.some((t) => t.id === targetTerminalId)
            ? targetTerminalId
            : activeTerminalId && projectTerms.some((t) => t.id === activeTerminalId)
            ? activeTerminalId
            : projectTerms[0].id;
        const secondId = projectTerms.find((t) => t.id !== chosenId)?.id || null;
        setPrimaryTerminalId(chosenId);
        setSecondaryTerminalId(secondId);
        setActiveTerminalId(chosenId);
        setFocusedPane("primary");
        if (projectTerms.length < 2 && (layout === "split-horizontal" || layout === "split-vertical")) {
          setLayout("single");
        }
      } else {
        setPrimaryTerminalId(null);
        setSecondaryTerminalId(null);
        setActiveTerminalId(null);
      }
    } catch (err) {
      console.error("Failed to switch project:", err);
    }
  };

  // Select / activate a terminal (e.g. from Rail or shortcut)
  const selectTerminal = useCallback(
    (id: string) => {
      const targetTerm = terminals.find((t) => t.id === id);
      if (targetTerm && targetTerm.project_path && !isSamePath(targetTerm.project_path, activeProject)) {
        selectProject(targetTerm.project_path, id);
        return;
      }

      setActiveTerminalId(id);
      if (layout === "single") {
        setPrimaryTerminalId(id);
        setFocusedPane("primary");
      } else if (layout === "split-horizontal" || layout === "split-vertical") {
        if (id === primaryTerminalId) {
          setFocusedPane("primary");
        } else if (id === secondaryTerminalId) {
          setFocusedPane("secondary");
        } else {
          // Replace terminal in currently focused pane
          if (focusedPane === "secondary") {
            setSecondaryTerminalId(id);
          } else {
            setPrimaryTerminalId(id);
          }
        }
      } else if (layout === "grid") {
        const idx = gridTerminalIds.indexOf(id);
        if (idx !== -1) {
          setFocusedPane(`grid-${idx}` as any);
        } else {
          const curIdx = parseInt(focusedPane.replace("grid-", ""), 10) || 0;
          setGridTerminalIds((prev) => {
            const next = [...prev] as [string | null, string | null, string | null, string | null];
            next[curIdx] = id;
            return next;
          });
        }
      }

      // Lock focus on the newly selected terminal
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("quay:focus-terminal", { detail: { terminalId: id } })
        );
      }, 20);
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("quay:focus-terminal", { detail: { terminalId: id } })
        );
      }, 100);
    },
    [terminals, activeProject, layout, primaryTerminalId, secondaryTerminalId, focusedPane, gridTerminalIds]
  );

  // Focus a specific pane
  const focusPane = useCallback(
    (pane: "primary" | "secondary" | number) => {
      if (pane === "primary") {
        setFocusedPane("primary");
        if (primaryTerminalId) setActiveTerminalId(primaryTerminalId);
      } else if (pane === "secondary") {
        setFocusedPane("secondary");
        if (secondaryTerminalId) setActiveTerminalId(secondaryTerminalId);
      } else if (typeof pane === "number") {
        setFocusedPane(`grid-${pane}` as any);
        const target = gridTerminalIds[pane];
        if (target) setActiveTerminalId(target);
      }
    },
    [primaryTerminalId, secondaryTerminalId, gridTerminalIds]
  );

  // Switch which terminal is shown in a pane
  const switchPaneTerminal = useCallback(
    (pane: "primary" | "secondary" | number, terminalId: string) => {
      if (pane === "primary") {
        setPrimaryTerminalId(terminalId);
        setActiveTerminalId(terminalId);
        setFocusedPane("primary");
      } else if (pane === "secondary") {
        setSecondaryTerminalId(terminalId);
        setActiveTerminalId(terminalId);
        setFocusedPane("secondary");
      } else if (typeof pane === "number") {
        setGridTerminalIds((prev) => {
          const next = [...prev] as [string | null, string | null, string | null, string | null];
          next[pane] = terminalId;
          return next;
        });
        setActiveTerminalId(terminalId);
        setFocusedPane(`grid-${pane}` as any);
      }
    },
    []
  );

  // Toggle Zoom on active pane
  const toggleZoom = useCallback(() => {
    if (layout !== "single") {
      setZoomedFromLayout(layout);
      setLayout("single");
    } else if (zoomedFromLayout) {
      setLayout(zoomedFromLayout);
      setZoomedFromLayout(null);
    } else if (visibleTerminals.length > 1) {
      setLayout("split-horizontal");
    }
  }, [layout, zoomedFromLayout, visibleTerminals.length]);

  // Focus next pane
  const focusNextPane = useCallback(() => {
    if (layout === "single") return;
    if (layout === "split-horizontal" || layout === "split-vertical") {
      if (focusedPane === "primary") {
        setFocusedPane("secondary");
        if (secondaryTerminalId) setActiveTerminalId(secondaryTerminalId);
      } else {
        setFocusedPane("primary");
        if (primaryTerminalId) setActiveTerminalId(primaryTerminalId);
      }
    } else if (layout === "grid") {
      const paneKeys: Array<"grid-0" | "grid-1" | "grid-2" | "grid-3"> = [
        "grid-0",
        "grid-1",
        "grid-2",
        "grid-3",
      ];
      const curIdx = paneKeys.indexOf(focusedPane as any);
      const nextIdx = (curIdx + 1) % 4;
      setFocusedPane(paneKeys[nextIdx]);
      const targetId = gridTerminalIds[nextIdx];
      if (targetId) setActiveTerminalId(targetId);
    }
  }, [layout, focusedPane, primaryTerminalId, secondaryTerminalId, gridTerminalIds]);

  // Unsplit back to single layout
  const unsplit = useCallback(() => {
    setLayout("single");
    setZoomedFromLayout(null);
  }, []);

  // Split Horizontal (side-by-side)
  const splitHorizontal = useCallback(async () => {
    if (
      secondaryTerminalId &&
      secondaryTerminalId !== activeTerminalId &&
      visibleTerminals.some((t) => t.id === secondaryTerminalId)
    ) {
      setLayout("split-horizontal");
      setZoomedFromLayout(null);
      return;
    }
    const other = visibleTerminals.find((t) => t.id !== activeTerminalId);
    if (other) {
      setSecondaryTerminalId(other.id);
      setLayout("split-horizontal");
      setZoomedFromLayout(null);
    } else {
      try {
        const dims = getGlobalTerminalDimensions();
        const newTerm = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: activeProject,
            run_kind: "powershell",
            name: "powershell",
            cols: dims.cols,
            rows: dims.rows,
          },
        });
        setTerminals((prev) => [...prev, newTerm]);
        setSecondaryTerminalId(newTerm.id);
        setLayout("split-horizontal");
        setZoomedFromLayout(null);
      } catch (e) {
        console.error("Failed to spawn terminal for split:", e);
      }
    }
  }, [secondaryTerminalId, activeTerminalId, visibleTerminals, activeProject]);

  // Split Vertical (stacked)
  const splitVertical = useCallback(async () => {
    if (
      secondaryTerminalId &&
      secondaryTerminalId !== activeTerminalId &&
      visibleTerminals.some((t) => t.id === secondaryTerminalId)
    ) {
      setLayout("split-vertical");
      setZoomedFromLayout(null);
      return;
    }
    const other = visibleTerminals.find((t) => t.id !== activeTerminalId);
    if (other) {
      setSecondaryTerminalId(other.id);
      setLayout("split-vertical");
      setZoomedFromLayout(null);
    } else {
      try {
        const dims = getGlobalTerminalDimensions();
        const newTerm = await invoke<TerminalInfo>("spawn_terminal", {
          request: {
            project_path: activeProject,
            run_kind: "powershell",
            name: "powershell",
            cols: dims.cols,
            rows: dims.rows,
          },
        });
        setTerminals((prev) => [...prev, newTerm]);
        setSecondaryTerminalId(newTerm.id);
        setLayout("split-vertical");
        setZoomedFromLayout(null);
      } catch (e) {
        console.error("Failed to spawn terminal for split:", e);
      }
    }
  }, [secondaryTerminalId, activeTerminalId, visibleTerminals, activeProject]);

  // Split Grid (2x2)
  const splitGrid = useCallback(() => {
    const ids = visibleTerminals.map((t) => t.id);
    const slot0 = activeTerminalId || ids[0] || null;
    const rem1 = ids.filter((id) => id !== slot0);
    const slot1 = rem1[0] || null;
    const rem2 = rem1.filter((id) => id !== slot1);
    const slot2 = rem2[0] || null;
    const rem3 = rem2.filter((id) => id !== slot2);
    const slot3 = rem3[0] || null;
    setGridTerminalIds([slot0, slot1, slot2, slot3]);
    setLayout("grid");
    setZoomedFromLayout(null);
  }, [visibleTerminals, activeTerminalId]);

  // Spawn terminal
  const spawnTerminal = async (request: SpawnTerminalRequest) => {
    try {
      const dims = getGlobalTerminalDimensions();
      const enrichedRequest: SpawnTerminalRequest = {
        cols: request.cols ?? dims.cols,
        rows: request.rows ?? dims.rows,
        ...request,
      };
      const newTerm = await invoke<TerminalInfo>("spawn_terminal", { request: enrichedRequest });
      setTerminals((prev) => [...prev, newTerm]);
      if (layout === "single") {
        setPrimaryTerminalId(newTerm.id);
        setActiveTerminalId(newTerm.id);
        setFocusedPane("primary");
      } else if (layout === "split-horizontal" || layout === "split-vertical") {
        if (focusedPane === "secondary") {
          setSecondaryTerminalId(newTerm.id);
          setActiveTerminalId(newTerm.id);
        } else {
          setPrimaryTerminalId(newTerm.id);
          setActiveTerminalId(newTerm.id);
        }
      } else if (layout === "grid") {
        const emptyIdx = gridTerminalIds.indexOf(null);
        if (emptyIdx !== -1) {
          setGridTerminalIds((prev) => {
            const next = [...prev] as [string | null, string | null, string | null, string | null];
            next[emptyIdx] = newTerm.id;
            return next;
          });
          setFocusedPane(`grid-${emptyIdx}` as any);
          setActiveTerminalId(newTerm.id);
        } else {
          const curIdx = parseInt(focusedPane.replace("grid-", ""), 10) || 0;
          setGridTerminalIds((prev) => {
            const next = [...prev] as [string | null, string | null, string | null, string | null];
            next[curIdx] = newTerm.id;
            return next;
          });
          setActiveTerminalId(newTerm.id);
        }
      }

      // Proactively notify the terminal to lock focus as soon as it mounts in the DOM
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("quay:focus-terminal", { detail: { terminalId: newTerm.id } })
        );
      }, 20);
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("quay:focus-terminal", { detail: { terminalId: newTerm.id } })
        );
      }, 100);
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("quay:focus-terminal", { detail: { terminalId: newTerm.id } })
        );
      }, 250);

      // Fallback timer: if terminal is still in "starting" after 3s, mark it "idle"
      setTimeout(() => {
        setTerminals((prev) =>
          prev.map((t) =>
            t.id === newTerm.id && t.claude_status === "starting"
              ? { ...t, claude_status: "idle" }
              : t
          )
        );
      }, 3000);
    } catch (err) {
      console.error("Failed to spawn terminal:", err);
    }
  };

  // Close / kill terminal
  const killTerminal = async (id: string) => {
    try {
      await invoke("kill_terminal", { terminalId: id });
      setTerminals((prev) => prev.filter((t) => t.id !== id));

      const remainingVisible = visibleTerminals.filter((t) => t.id !== id);

      if (primaryTerminalId === id) {
        if (secondaryTerminalId && secondaryTerminalId !== id) {
          setPrimaryTerminalId(secondaryTerminalId);
          setActiveTerminalId(secondaryTerminalId);
          setSecondaryTerminalId(null);
          setLayout("single");
        } else {
          const next = remainingVisible[0]?.id || null;
          setPrimaryTerminalId(next);
          setActiveTerminalId(next);
          setLayout("single");
        }
      } else if (secondaryTerminalId === id) {
        setSecondaryTerminalId(null);
        setLayout("single");
      }

      if (gridTerminalIds.includes(id)) {
        setGridTerminalIds((prev) =>
          prev.map((gid) => (gid === id ? null : gid)) as [
            string | null,
            string | null,
            string | null,
            string | null
          ]
        );
        if (remainingVisible.length < 2) {
          setLayout("single");
        }
      }
    } catch (err) {
      console.error("Failed to kill terminal:", err);
    }
  };

  // Relaunch an exited or restored dormant terminal
  const relaunchTerminal = async (terminalId: string) => {
    try {
      const updated = await invoke<TerminalInfo>("relaunch_terminal", { terminalId });
      setTerminals((prev) => prev.map((t) => (t.id === terminalId ? updated : t)));
      setActiveTerminalId(terminalId);

      // Lock focus on the relaunched terminal
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("quay:focus-terminal", { detail: { terminalId } })
        );
      }, 50);
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("quay:focus-terminal", { detail: { terminalId } })
        );
      }, 150);
    } catch (err) {
      console.error("Failed to relaunch terminal:", err);
    }
  };


  // Keyboard shortcut listener (^b n, ^b %, ^b ", ^b o, ^b z, ^b x, ^b g, ^b s, ^b d, Ctrl+K, and ^b 1..9)
  useEffect(() => {
    let ctrlBActive = false;
    let ctrlBTimer: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Global Ctrl+K / Cmd+K Command Palette trigger
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

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
          e.stopPropagation();
          setIsNewTerminalOpen(true);
          ctrlBActive = false;
          return;
        }

        if (e.key === "%") {
          e.preventDefault();
          e.stopPropagation();
          splitHorizontal();
          ctrlBActive = false;
          return;
        }

        if (e.key === '"' || e.key === "'") {
          e.preventDefault();
          e.stopPropagation();
          splitVertical();
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "g") {
          e.preventDefault();
          e.stopPropagation();
          splitGrid();
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          e.stopPropagation();
          setIsSwarmModalOpen(true);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "d") {
          e.preventDefault();
          e.stopPropagation();
          setIsDiffInspectorOpen(true);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "w") {
          e.preventDefault();
          e.stopPropagation();
          openNewWorktreeModal();
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "i") {
          e.preventDefault();
          e.stopPropagation();
          setIsGithubDrawerOpen((prev) => !prev);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "a") {
          e.preventDefault();
          e.stopPropagation();
          setIsAuditModalOpen(true);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "h") {
          e.preventDefault();
          e.stopPropagation();
          setIsSessionHistoryOpen((prev) => !prev);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "t" || e.key === "$") {
          e.preventDefault();
          e.stopPropagation();
          setIsTokenSpendOpen((prev) => !prev);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          e.stopPropagation();
          setIsArchonGraphOpen((prev) => !prev);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          setIsFactoryStationOpen((prev) => !prev);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "u") {
          e.preventDefault();
          e.stopPropagation();
          setIsUpdateModalOpen((prev) => !prev);
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "o") {
          e.preventDefault();
          e.stopPropagation();
          focusNextPane();
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.stopPropagation();
          toggleZoom();
          ctrlBActive = false;
          return;
        }

        if (e.key.toLowerCase() === "x") {
          e.preventDefault();
          e.stopPropagation();
          unsplit();
          ctrlBActive = false;
          return;
        }

        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          e.preventDefault();
          e.stopPropagation();
          const target = visibleTerminals[num - 1];
          if (target) {
            selectTerminal(target.id);
          }
          ctrlBActive = false;
          return;
        }
      }

      // Also support standard Alt+1..9 for accessibility
      if (e.altKey && !isNaN(parseInt(e.key, 10))) {
        const num = parseInt(e.key, 10);
        const target = visibleTerminals[num - 1];
        if (target) {
          e.preventDefault();
          selectTerminal(target.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    visibleTerminals,
    layout,
    focusedPane,
    primaryTerminalId,
    secondaryTerminalId,
    gridTerminalIds,
    zoomedFromLayout,
    splitHorizontal,
    splitVertical,
    splitGrid,
    focusNextPane,
    toggleZoom,
    unsplit,
    selectTerminal,
  ]);

  // Rename terminal
  const renameTerminal = async (terminalId: string, name: string) => {
    try {
      await invoke("rename_terminal", { terminalId, name });
      setTerminals((prev) =>
        prev.map((t) => (t.id === terminalId ? { ...t, name, custom_name: true } : t))
      );
    } catch (err) {
      console.error("Failed to rename terminal:", err);
    }
  };

  // Toggle terminal live permission mode between Skip and Normal
  const toggleTerminalLiveMode = async (terminalId: string, currentMode: PermissionMode) => {
    const newMode: PermissionMode = currentMode === "skip" ? "normal" : "skip";
    try {
      await invoke("set_terminal_live_mode", {
        terminalId,
        mode: newMode,
      });
      setTerminals((prev) =>
        prev.map((t) => (t.id === terminalId ? { ...t, live_mode: newMode } : t))
      );
    } catch (err) {
      console.error("Failed to toggle live permission mode:", err);
    }
  };

  return {
    projects,
    activeProject,
    terminals,
    visibleTerminals,
    activeTerminalId,
    primaryTerminalId,
    secondaryTerminalId,
    gridTerminalIds,
    layout,
    focusedPane,
    splitRatio,
    zoomedFromLayout,
    bridgePort,
    setActiveTerminalId: selectTerminal,
    selectTerminal,
    focusPane,
    switchPaneTerminal,
    setLayout,
    setSplitRatio,
    toggleZoom,
    focusNextPane,
    unsplit,
    splitHorizontal,
    splitVertical,
    splitGrid,
    setActiveProject: selectProject,
    selectProject,
    isNewTerminalOpen,
    setIsNewTerminalOpen,
    isAddProjectOpen,
    setIsAddProjectOpen,
    isA2AOpen,
    setIsA2AOpen,
    isActionLogOpen,
    setIsActionLogOpen,
    isWorkspaceSettingsOpen,
    setIsWorkspaceSettingsOpen,
    workspaceSettingsTarget,
    openWorkspaceSettings,
    closeWorkspaceSettings,
    updateProjectSettings,
    isSwarmModalOpen,
    setIsSwarmModalOpen,
    launchSwarm,
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    isDiffInspectorOpen,
    setIsDiffInspectorOpen,
    projectWorktrees,
    refreshWorktrees,
    isNewWorktreeOpen,
    setIsNewWorktreeOpen,
    worktreeModalTarget,
    openNewWorktreeModal,
    createWorktree,
    removeWorktree,
    isGithubDrawerOpen,
    setIsGithubDrawerOpen,
    isAuditModalOpen,
    setIsAuditModalOpen,
    isSessionHistoryOpen,
    setIsSessionHistoryOpen,
    isTokenSpendOpen,
    setIsTokenSpendOpen,
    isArchonGraphOpen,
    setIsArchonGraphOpen,
    isFactoryStationOpen,
    setIsFactoryStationOpen,
    isUpdateModalOpen,
    setIsUpdateModalOpen,
    claudeStats,
    refreshClaudeStats,
    resumeSession,
    addProject,
    removeProject,
    renameTerminal,
    spawnTerminal,
    killTerminal,
    relaunchTerminal,
    toggleTerminalLiveMode,
  };
}
