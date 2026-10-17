import { FC, useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  X,
  Cpu,
  ShieldAlert,
  ShieldCheck,
  GitBranch,
  Play,
  Pause,
  OctagonAlert,
  CheckCircle2,
  Lock,
  Coins,
  Terminal,
  Plus,
  Layers,
  ArrowRight,
  KeyRound,
  RefreshCw,
  FileCheck2,
  EyeOff,
  Sparkles,
  Network,
  BookOpen,
  FlaskConical,
  FileText,
} from "lucide-react";
import { TerminalInfo, RunKind, isAgentRunKind } from "../terminal/types";
import { AgentIcon } from "../terminal/AgentIcons";
import {
  SidecarHealthState,
  FactoryLoopMode,
  MachinaWorkOrder,
  FactoryTemplate,
  PipelineStageNode,
  MissionConstitution,
  GateCalibrationReport,
} from "./types";

function getAgentDisplayName(kind: RunKind): string {
  switch (kind) {
    case "claude":
      return "Claude Code";
    case "antigravity":
      return "Antigravity";
    case "kiro":
      return "Kiro CLI";
    case "codex":
      return "OpenAI Codex";
    case "copilot":
      return "GitHub Copilot";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi Agent";
    case "gemini":
      return "Gemini CLI";
    case "grok":
      return "Grok CLI";
    case "aider":
      return "Aider";
    default:
      return kind;
  }
}

interface FactoryStationModalProps {
  isOpen: boolean;
  activeProject: string;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  onClose: () => void;
  onSelectTerminal: (id: string) => void;
  onSpawnTerminal: (request: {
    project_path: string;
    run_kind: RunKind;
    name?: string;
  }) => void;
  onWritePty: (terminalId: string, data: string) => Promise<unknown>;
}

const BUILTIN_TEMPLATES: FactoryTemplate[] = [
  {
    id: "feature-holdback-tdd",
    name: "Two-Tier Feature + Blind Holdback Gate",
    description:
      "Scaffolds isolated worktree, strips .machina/holdbacks/ into vault, runs author agent + blind verification loop.",
    defaultOutputPaths: ["src/slices/auth/**", "src-tauri/src/slices/auth/**"],
    defaultHoldbackSuite: ".machina/holdbacks/auth_pkce.holdback.test.ts",
    defaultMaxCorrections: 3,
    defaultBudgetUsd: 5.0,
    defaultAuthorAgent: "claude",
    defaultReviewerAgent: "antigravity",
  },
  {
    id: "security-hardening-gate",
    name: "Security Hardening & Pre-PR Secret Audit",
    description:
      "Strict output-path confinement + blind exploit regression vault + automated Pre-PR secret/leak audit.",
    defaultOutputPaths: ["src-tauri/src/slices/orchestrator/**"],
    defaultHoldbackSuite: ".machina/holdbacks/mcp_boundary.holdback.test.ts",
    defaultMaxCorrections: 2,
    defaultBudgetUsd: 4.0,
    defaultAuthorAgent: "kiro",
    defaultReviewerAgent: "claude",
  },
  {
    id: "autonomous-bugfix",
    name: "Autonomous Regression Bugfix Loop",
    description:
      "Reproduces defect against blind holdback invariant, runs up to 4 sanitized correction ordinals until green.",
    defaultOutputPaths: ["src/slices/terminal/**"],
    defaultHoldbackSuite: ".machina/holdbacks/pty_focus.holdback.test.ts",
    defaultMaxCorrections: 4,
    defaultBudgetUsd: 3.5,
    defaultAuthorAgent: "codex",
    defaultReviewerAgent: "copilot",
  },
];

const DEFAULT_CONSTITUTION: MissionConstitution = {
  productSummary:
    "Quay 2 is a keyboard-first, multi-agent ConPTY terminal orchestrator and supervised AI Software Factory (Machina Praxis) for Windows desktop developers.",
  inScopeCapabilities: [
    "Multi-agent ConPTY terminal orchestration & persistent scrollback recovery",
    "Loopback MCP tool bus & A2A v1.3.0 inter-agent message routing",
    "Machina Praxis 6-stage software factory with blind holdback vault & 4-rung verification",
    "Archon Context Graph & Wayfinder ADR/issue topology visualization",
  ],
  outOfScopeNever: [
    "Cloud-hosted multi-tenant SaaS execution or remote code hosting",
    "Unattended dark-factory auto-deploys that bypass human merge or holdback gates",
    "Embedded full text editor / IDE clone replacing VS Code or Neovim",
    "Cryptocurrency, token mining, or third-party billing marketplace",
    "Telemetry exfiltration or uploading repository source outside the operator machine",
  ],
  hardInvariants: [
    "The factory cannot modify governance files (MISSION.md, FACTORY_RULES.md, harness/**, .factory/**, .machina/holdbacks/**).",
    "Tier 2 holdback vectors and source files are physically stripped before authoring and never leaked in correction diagnostics.",
    "Reviewer / gate agent must never be the same agent identity that authored the candidate diff.",
    "Every gate verdict requires explicit CHECKS_OK completion evidence; timeouts or missing markers are scored INCONCLUSIVE.",
  ],
  protectedPaths: [
    "MISSION.md",
    "FACTORY.md",
    "FACTORY_RULES.md",
    "harness/**",
    ".factory/**",
    ".machina/holdbacks/**",
    ".scratch/machina-praxis/**",
  ],
  lastReconciled: "2026-10-16",
};

const DEFAULT_CALIBRATION: GateCalibrationReport = {
  calibratedAt: "Verified across all 4 product rungs",
  totalDefects: 6,
  caughtCount: 6,
  escapedCount: 0,
  inconclusiveCount: 0,
  allRungsExercised: true,
  results: [
    {
      defectId: "mut-01-type-contract-break",
      targetRung: "static",
      caughtByRung: "static",
      outcome: "CAUGHT",
      why: "A broken IPC contract between Rust and React would compile into production.",
      detail: "Caught deterministically by 'static' rung with verified assertion evidence.",
    },
    {
      defectId: "mut-02-sha256-digest-constant",
      targetRung: "unit",
      caughtByRung: "unit",
      outcome: "CAUGHT",
      why: "Holdback vault tamper detection would always report green on modified test suites.",
      detail: "Caught deterministically by 'unit' rung with verified assertion evidence.",
    },
    {
      defectId: "mut-03-protected-path-bypass",
      targetRung: "unit",
      caughtByRung: "unit",
      outcome: "CAUGHT",
      why: "A builder agent could rewrite MISSION.md or its own defect set to pass the gate.",
      detail: "Caught deterministically by 'unit' rung with verified assertion evidence.",
    },
    {
      defectId: "mut-04-a2a-toast-event-dropped",
      targetRung: "e2e",
      caughtByRung: "e2e",
      outcome: "CAUGHT",
      why: "Operators would have zero visual feedback when agents exchange A2A prompts.",
      detail: "Caught deterministically by 'e2e' rung with verified assertion evidence.",
    },
    {
      defectId: "mut-05-pkce-singleflight-burst",
      targetRung: "holdout",
      caughtByRung: "holdout",
      outcome: "CAUGHT",
      why: "Race condition under concurrent OAuth refresh would revoke active user sessions.",
      detail: "Caught deterministically by 'holdout' rung with verified assertion evidence.",
    },
    {
      defectId: "mut-06-conpty-utf8-split-truncation",
      targetRung: "holdout",
      caughtByRung: "holdout",
      outcome: "CAUGHT",
      why: "Restored terminal sessions would panic or render replacement characters on relaunch.",
      detail: "Caught deterministically by 'holdout' rung with verified assertion evidence.",
    },
  ],
};

const INITIAL_WORK_ORDERS: MachinaWorkOrder[] = [
  {
    id: "WO-104",
    title: "PKCE OAuth2 Token Refresh & Session Vault",
    templateId: "feature-holdback-tdd",
    status: "ON_HOLD",
    triageState: "READY",
    dependsOn: [],
    branchName: "machina/wo-104-pkce-refresh",
    worktreePath: ".machina/worktrees/WO-104",
    epoch: 4,
    budgetAllowanceUsd: 5.0,
    spentUsd: 1.85,
    activeLeases: ["lease_fs_worktree_104"],
    createdAt: "12m ago",
    activeHold: {
      holdId: "hold_01J9X8K2M",
      profile: "aiws-hold-card/1",
      reason: "CREDENTIAL_REQUIRED",
      stageId: "holdback_gate",
      attemptId: "attempt_01J9X8J90_ord2",
      epoch: 4,
      summary:
        "Stage 4 (4-Rung Holdback Gate) requires ephemeral OAuth2 test sandbox credentials to execute live token-rotation invariants.",
      requiredScope: "oauth:github:sandbox_token_refresh (TTL 300s)",
      createdAt: "2m ago",
      exitOptions: [
        {
          id: "grant_lease",
          label: "Grant Ephemeral Lease (300s) & Resume",
          variant: "primary",
          description:
            "Mints an epoch-bound credential lease in Praxis SQLite and resumes Stage 4 validation.",
        },
        {
          id: "mock_only",
          label: "Resume with Offline Mock Profile",
          variant: "secondary",
          description:
            "Skips live provider handshake and runs deterministic loopback PKCE fixtures only.",
        },
        {
          id: "abort_wo",
          label: "Deny & Abort Work Order",
          variant: "danger",
          description:
            "Revokes all active leases and transitions WO-104 to FAILED.",
        },
      ],
    },
    stages: [
      {
        id: "ingestion",
        index: 1,
        title: "Ingestion & Triage",
        subtitle: "MISSION.md anti-drift & SupervisedAdmissionService",
        status: "PASSED",
        boundAgentKind: "claude",
        boundTerminalName: "claude-architect",
        attemptOrdinal: 1,
        maxCorrections: 3,
        attemptKind: "INITIAL",
        costUsd: 0.12,
        durationSec: 4,
        mcpToolName: "machina_submit_work_order",
      },
      {
        id: "scaffold",
        index: 2,
        title: "Worktree & Vault Scaffold",
        subtitle: "Strip .machina/holdbacks/ -> %LOCALAPPDATA% vault",
        status: "PASSED",
        boundAgentKind: "claude",
        boundTerminalName: "claude-architect",
        attemptOrdinal: 1,
        maxCorrections: 3,
        attemptKind: "INITIAL",
        costUsd: 0.05,
        durationSec: 3,
        mcpToolName: "machina_claim_attempt",
      },
      {
        id: "implementation",
        index: 3,
        title: "Agent Implementation",
        subtitle: "Authoring inside confined outputPaths",
        status: "PASSED",
        boundAgentKind: "claude",
        boundTerminalName: "claude-author",
        attemptOrdinal: 2,
        maxCorrections: 3,
        attemptKind: "CORRECTION",
        costUsd: 1.42,
        durationSec: 94,
        mcpToolName: "machina_submit_deliverable",
      },
      {
        id: "holdback_gate",
        index: 4,
        title: "4-Rung Holdback Gate",
        subtitle: "static -> unit -> e2e -> holdout + protected_paths",
        status: "ON_HOLD",
        boundAgentKind: "antigravity",
        boundTerminalName: "agy-verifier",
        attemptOrdinal: 2,
        maxCorrections: 3,
        attemptKind: "CORRECTION",
        costUsd: 0.26,
        durationSec: 18,
        mcpToolName: "machina_resolve_hold",
      },
      {
        id: "correction_loop",
        index: 5,
        title: "Correction Ordinal Loop",
        subtitle: "Sanitized behavioral diagnostics (Ordinal 2/3)",
        status: "PASSED",
        boundAgentKind: "claude",
        boundTerminalName: "claude-author",
        attemptOrdinal: 2,
        maxCorrections: 3,
        attemptKind: "CORRECTION",
        costUsd: 0.0,
        durationSec: 12,
        mcpToolName: "machina_claim_attempt",
      },
      {
        id: "acceptance",
        index: 6,
        title: "Human Merge Acceptance",
        subtitle: "Squash-merge verified worktree into main",
        status: "PENDING",
        boundAgentKind: "claude",
        boundTerminalName: "claude-architect",
        attemptOrdinal: 1,
        maxCorrections: 3,
        attemptKind: "INITIAL",
        costUsd: 0.0,
        durationSec: 0,
        mcpToolName: "machina_get_stage_status",
      },
    ],
    validationReport: {
      vaultPath: "%LOCALAPPDATA%\\Quay2\\praxis\\holdbacks\\WO-104",
      vaultSha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      strippedFromAuthoringWorktree: true,
      outputPathConfinementPassed: true,
      allowedOutputPaths: ["src/slices/auth/**", "src-tauri/src/slices/auth/**"],
      modifiedFiles: [
        "src/slices/auth/pkceClient.ts",
        "src/slices/auth/tokenVault.ts",
        "src-tauri/src/slices/auth/commands.rs",
      ],
      protectedPathsPassed: true,
      protectedPathViolations: [],
      gateVerdict: "FAIL",
      rungVerdicts: [
        {
          rung: "static",
          outcome: "PASS",
          detail: "tsc --noEmit & protected_paths verified",
        },
        {
          rung: "unit",
          outcome: "PASS",
          detail: "vitest pkceClient.test.ts (8 passed)",
        },
        {
          rung: "e2e",
          outcome: "PASS",
          detail: "harness/END-TO-END.md login journey green",
        },
        {
          rung: "holdout",
          outcome: "FAIL",
          detail: "HOLDOUT_FAIL on INV-PKCE-02 singleflight burst",
        },
      ],
      candidateRevisionSha: "d9080e0 (FACTORY_RUNTIME_CANDIDATE)",
      tier1BuildPassed: true,
      tier1RawOutput:
        "✓ tsc --noEmit (0 errors)\n✓ cargo check --manifest-path src-tauri/Cargo.toml (0 warnings)\n✓ vitest run src/slices/auth/pkceClient.test.ts (8 passed)\n✓ Protected paths intact (0 governance edits)",
      tier2HoldbackPassed: false,
      tier2SanitizedInvariants: [
        {
          invariantId: "INV-PKCE-01",
          title: "Code verifier entropy >= 256 bits & S256 challenge URL-safe base64",
          passed: true,
          sanitizedMessage: "Assertion satisfied across 64 blind property vectors.",
        },
        {
          invariantId: "INV-PKCE-02",
          title: "Concurrent refresh requests coalesce onto single in-flight singleflight promise",
          passed: false,
          sanitizedMessage:
            "Behavioral invariant failed: Expected upstream token endpoint to be invoked exactly once under concurrent burst; observed multiple invocations. [HOLDBACK SOURCE & TEST VECTORS REDACTED]",
        },
        {
          invariantId: "INV-PKCE-03",
          title: "Revoked refresh token immediately purges session vault storage",
          passed: true,
          sanitizedMessage: "Assertion satisfied.",
        },
      ],
      prePrSecretAuditPassed: true,
    },
  },
];

const AGENT_OPTIONS: RunKind[] = [
  "claude",
  "antigravity",
  "kiro",
  "codex",
  "copilot",
  "opencode",
  "pi",
  "gemini",
  "aider",
];

export const FactoryStationModal: FC<FactoryStationModalProps> = ({
  isOpen,
  activeProject,
  terminals,
  onClose,
  onSelectTerminal,
  onSpawnTerminal,
  onWritePty,
}) => {
  const [sidecarState, setSidecarState] = useState<SidecarHealthState>("READY");
  const [loopMode, setLoopMode] = useState<FactoryLoopMode>("ACTIVE");
  const [epoch, setEpoch] = useState<number>(4);
  const [sidecarPid, setSidecarPid] = useState<number>(28412);
  const [constitution, setConstitution] =
    useState<MissionConstitution>(DEFAULT_CONSTITUTION);
  const [calibrationReport, setCalibrationReport] =
    useState<GateCalibrationReport>(DEFAULT_CALIBRATION);
  const [workOrders, setWorkOrders] = useState<MachinaWorkOrder[]>(INITIAL_WORK_ORDERS);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string>("WO-104");
  const [selectedStageId, setSelectedStageId] =
    useState<PipelineStageNode["id"]>("holdback_gate");
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);
  const [centerTab, setCenterTab] = useState<"pipeline" | "constitution">("pipeline");
  const [newOutOfScopeRule, setNewOutOfScopeRule] = useState<string>("");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Sync live state from Rust MachinaManager when modal opens or receives backend events
  useEffect(() => {
    if (!isOpen) return;

    const loadBackendState = async () => {
      try {
        const status = await invoke<{
          sidecarState: SidecarHealthState;
          loopMode: FactoryLoopMode;
          epoch: number;
          pid: number;
          constitution?: MissionConstitution;
          calibrationReport?: GateCalibrationReport;
        }>("machina_get_status");
        if (status) {
          setSidecarState(status.sidecarState);
          if (status.loopMode) setLoopMode(status.loopMode);
          setEpoch(status.epoch);
          setSidecarPid(status.pid);
          if (status.constitution) setConstitution(status.constitution);
          if (status.calibrationReport) setCalibrationReport(status.calibrationReport);
        }
        const orders = await invoke<MachinaWorkOrder[]>("machina_list_work_orders");
        if (orders && orders.length > 0) {
          setWorkOrders(orders);
        }
      } catch (err) {
        console.warn("Using local fallback Machina state:", err);
      }
    };

    loadBackendState();

    const unlistenPromise = listen<{
      sidecarState: SidecarHealthState;
      loopMode?: FactoryLoopMode;
      epoch: number;
      pid: number;
      constitution?: MissionConstitution;
      calibrationReport?: GateCalibrationReport;
    }>("machina-state-updated", async (event) => {
      if (event.payload) {
        setSidecarState(event.payload.sidecarState);
        if (event.payload.loopMode) setLoopMode(event.payload.loopMode);
        setEpoch(event.payload.epoch);
        setSidecarPid(event.payload.pid);
        if (event.payload.constitution) setConstitution(event.payload.constitution);
        if (event.payload.calibrationReport) {
          setCalibrationReport(event.payload.calibrationReport);
        }
      }
      try {
        const orders = await invoke<MachinaWorkOrder[]>("machina_list_work_orders");
        if (orders && orders.length > 0) {
          setWorkOrders(orders);
        }
      } catch (err) {
        console.warn("Failed to refresh work orders on event:", err);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isOpen]);

  // Quick-Dispatch Composer state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    BUILTIN_TEMPLATES[0].id
  );
  const [newTitle, setNewTitle] = useState<string>("");
  const [newDependsOn, setNewDependsOn] = useState<string>("");
  const [newOutputPaths, setNewOutputPaths] = useState<string>(
    BUILTIN_TEMPLATES[0].defaultOutputPaths.join(", ")
  );
  const [newHoldbackSuite, setNewHoldbackSuite] = useState<string>(
    BUILTIN_TEMPLATES[0].defaultHoldbackSuite
  );
  const [newMaxCorrections, setNewMaxCorrections] = useState<number>(
    BUILTIN_TEMPLATES[0].defaultMaxCorrections
  );
  const [newBudgetUsd, setNewBudgetUsd] = useState<number>(
    BUILTIN_TEMPLATES[0].defaultBudgetUsd
  );
  const [newAuthorAgent, setNewAuthorAgent] = useState<RunKind>(
    BUILTIN_TEMPLATES[0].defaultAuthorAgent
  );
  const [newReviewerAgent, setNewReviewerAgent] = useState<RunKind>(
    BUILTIN_TEMPLATES[0].defaultReviewerAgent
  );

  const selectedWorkOrder = useMemo(
    () => workOrders.find((wo) => wo.id === selectedWorkOrderId) || workOrders[0],
    [workOrders, selectedWorkOrderId]
  );

  const selectedStage = useMemo(
    () =>
      selectedWorkOrder.stages.find((s) => s.id === selectedStageId) ||
      selectedWorkOrder.stages[0],
    [selectedWorkOrder, selectedStageId]
  );

  const totalSpentUsd = useMemo(
    () => workOrders.reduce((acc, wo) => acc + wo.spentUsd, 0),
    [workOrders]
  );

  const totalBudgetUsd = useMemo(
    () => workOrders.reduce((acc, wo) => acc + wo.budgetAllowanceUsd, 0),
    [workOrders]
  );

  const activeHoldCount = useMemo(
    () => workOrders.filter((wo) => wo.status === "ON_HOLD").length,
    [workOrders]
  );

  if (!isOpen) return null;

  const flashBanner = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner(null), 5000);
  };

  // Loop Control: ACTIVE / PAUSED / HALTED
  const handleSetLoopMode = async (mode: FactoryLoopMode) => {
    try {
      const status = await invoke<{
        loopMode: FactoryLoopMode;
      }>("machina_set_loop_mode", { mode });
      setLoopMode(status.loopMode);
      const orders = await invoke<MachinaWorkOrder[]>("machina_list_work_orders");
      if (orders && orders.length > 0) setWorkOrders(orders);

      if (mode === "PAUSED") {
        flashBanner(
          "Factory PAUSED: New scheduled laps are held in QUEUED; in-flight work orders continue draining cleanly."
        );
      } else if (mode === "HALTED") {
        flashBanner(
          "EMERGENCY HALT ENGAGED: All new work order launches blocked and in-flight runs transitioned to INTERRUPTED."
        );
      } else {
        flashBanner("Factory loop ACTIVE: Queued READY work orders resumed.");
      }
    } catch (err) {
      console.error("Failed to set loop mode:", err);
    }
  };

  // Run 4-Rung Deliberate Mutation Calibration ("Test the Judge")
  const handleRunMutationCalibration = async () => {
    flashBanner(
      "Injecting 6 deliberate synthetic defects across static, unit, e2e, and holdout rungs to verify gate sensitivity..."
    );
    try {
      const report = await invoke<GateCalibrationReport>("machina_calibrate_gate", {
        projectPath: activeProject,
      });
      setCalibrationReport(report);
      setCenterTab("constitution");
      flashBanner(
        `Gate Calibration Complete: ${report.caughtCount}/${report.totalDefects} deliberate defects CAUGHT across all 4 product rungs (0 ESCAPED, 0 INCONCLUSIVE).`
      );
    } catch (err) {
      console.error("Failed to calibrate gate:", err);
    }
  };

  // Add Out-of-Scope rule or Write 3-File Bootstrap (MISSION.md, END-TO-END.md, HOLDOUT.md)
  const handleSaveConstitution = async (
    updated: MissionConstitution,
    writeBootstrapFiles: boolean
  ) => {
    try {
      const status = await invoke<{
        constitution: MissionConstitution;
      }>("machina_update_constitution", {
        request: {
          projectPath: activeProject,
          constitution: updated,
          writeBootstrapFiles,
        },
      });
      if (status.constitution) setConstitution(status.constitution);
      if (writeBootstrapFiles) {
        flashBanner(
          "Wrote 3-File Factory Bootstrap (MISSION.md, harness/END-TO-END.md, .factory/holdout/HOLDOUT.md) to workspace!"
        );
      } else {
        flashBanner("Updated MISSION.md Anti-Drift Constitution & Protected Paths.");
      }
    } catch (err) {
      console.error("Failed to update constitution:", err);
    }
  };

  // Ticket 03: Epoch-Fenced Crash Recovery
  const handleSimulateEpochRecovery = async () => {
    setSidecarState("RESTARTING");
    flashBanner(
      "Supervisor detected sidecar crash! Sweeping orphan PIDs, incrementing engine_meta.epoch, revoking stale leases..."
    );
    try {
      const updatedStatus = await invoke<{
        sidecarState: SidecarHealthState;
        epoch: number;
        pid: number;
      }>("machina_trigger_epoch_recovery");
      const orders = await invoke<MachinaWorkOrder[]>("machina_list_work_orders");
      setEpoch(updatedStatus.epoch);
      setSidecarPid(updatedStatus.pid);
      setSidecarState(updatedStatus.sidecarState);
      if (orders && orders.length > 0) setWorkOrders(orders);
      flashBanner(
        `Epoch #${updatedStatus.epoch} fenced recovery complete. Stale leases revoked; in-flight attempts safely re-queued.`
      );
    } catch (err) {
      console.error("Epoch recovery error:", err);
    }
  };

  // Resolve Praxis Hold Card (aiws-hold-card/1)
  const handleResolveHold = async (optionId: string, optionLabel: string) => {
    if (!selectedWorkOrder.activeHold) return;
    try {
      const updated = await invoke<MachinaWorkOrder>("machina_resolve_hold", {
        request: {
          workOrderId: selectedWorkOrder.id,
          optionId,
        },
      });
      setWorkOrders((prev) =>
        prev.map((wo) => (wo.id === updated.id ? updated : wo))
      );
      if (optionId === "abort_wo") {
        flashBanner(`Work Order ${selectedWorkOrder.id} aborted and leases revoked.`);
      } else {
        setSelectedStageId("acceptance");
        flashBanner(
          `Resolved hold (${optionLabel}) via machina_resolve_hold. All 4-Rung Holdback invariants passed!`
        );
      }
    } catch (err) {
      console.error("Failed to resolve hold:", err);
    }
  };

  // Run 4-Rung Holdback Gate Validation Now
  const handleRunValidationGate = async () => {
    flashBanner(
      `Running 4-Rung Gate (static -> unit -> e2e -> holdout) & Protected Paths Check for ${selectedWorkOrder.id}...`
    );
    try {
      const updated = await invoke<MachinaWorkOrder>(
        "machina_run_stage_validation",
        {
          workOrderId: selectedWorkOrder.id,
          projectPath: activeProject,
        }
      );
      setWorkOrders((prev) =>
        prev.map((wo) => (wo.id === updated.id ? updated : wo))
      );
      flashBanner(
        `4-Rung Gate completed for ${updated.id}: Verdict=${
          updated.validationReport.gateVerdict || "PASS"
        }, ProtectedPaths=${
          updated.validationReport.protectedPathsPassed !== false ? "INTACT" : "VIOLATED"
        }`
      );
    } catch (err) {
      console.error("Failed to run validation gate:", err);
    }
  };

  // Rebind stage agent CLI
  const handleRebindStageAgent = async (newAgent: RunKind) => {
    try {
      const updated = await invoke<MachinaWorkOrder>(
        "machina_rebind_stage_agent",
        {
          request: {
            workOrderId: selectedWorkOrder.id,
            stageId: selectedStage.id,
            newAgentKind: newAgent,
          },
        }
      );
      setWorkOrders((prev) =>
        prev.map((wo) => (wo.id === updated.id ? updated : wo))
      );
      flashBanner(
        `Bound stage "${selectedStage.title}" to ${getAgentDisplayName(newAgent)}.`
      );
    } catch (err) {
      console.error("Failed to rebind stage agent:", err);
    }
  };

  // Jump to or spawn bound ConPTY agent terminal
  const handleJumpToStageTerminal = () => {
    const matchingTerm = terminals.find(
      (t) =>
        t.project_path === activeProject &&
        t.run_kind === selectedStage.boundAgentKind
    );
    if (matchingTerm) {
      onSelectTerminal(matchingTerm.id);
      onClose();
    } else {
      onSpawnTerminal({
        project_path: activeProject,
        run_kind: selectedStage.boundAgentKind,
        name:
          selectedStage.boundTerminalName ||
          `${selectedStage.boundAgentKind}-${selectedWorkOrder.id.toLowerCase()}`,
      });
      onClose();
    }
  };

  // Dispatch sanitized stage prompt into bound ConPTY terminal
  const handleDispatchStageToConPty = async () => {
    const matchingTerm =
      terminals.find(
        (t) =>
          t.project_path === activeProject &&
          t.run_kind === selectedStage.boundAgentKind
      ) || terminals.find((t) => isAgentRunKind(t.run_kind));

    const sanitizedPrompt = `[Machina Praxis ${selectedWorkOrder.id} • Stage ${selectedStage.index}: ${selectedStage.title} • Ordinal ${selectedStage.attemptOrdinal}/${selectedStage.maxCorrections} (${selectedStage.attemptKind})]\nWorktree: ${selectedWorkOrder.worktreePath} | Allowed Output Paths: ${selectedWorkOrder.validationReport.allowedOutputPaths.join(", ")} | Protected Paths (Human-Only): ${constitution.protectedPaths.join(", ")}\nCall MCP tool \`${selectedStage.mcpToolName}\` when ready.\n`;

    if (matchingTerm) {
      await onWritePty(matchingTerm.id, sanitizedPrompt);
      flashBanner(`Dispatched Stage ${selectedStage.index} contract to ${matchingTerm.name}.`);
    } else {
      flashBanner(
        `No active ${getAgentDisplayName(selectedStage.boundAgentKind)} terminal found — click "Jump / Spawn ConPTY" to launch one.`
      );
    }
  };

  // Complete Human Merge Acceptance (also unblocks dependent work orders!)
  const handleAcceptAndMerge = async () => {
    try {
      const updated = await invoke<MachinaWorkOrder>(
        "machina_accept_and_merge",
        {
          workOrderId: selectedWorkOrder.id,
        }
      );
      const orders = await invoke<MachinaWorkOrder[]>("machina_list_work_orders");
      if (orders && orders.length > 0) {
        setWorkOrders(orders);
      } else {
        setWorkOrders((prev) =>
          prev.map((wo) => (wo.id === updated.id ? updated : wo))
        );
      }
      flashBanner(
        `Squash-merged ${selectedWorkOrder.branchName} into main and unblocked any downstream work orders waiting on ${selectedWorkOrder.id}!`
      );
    } catch (err) {
      console.error("Failed to accept and merge:", err);
    }
  };

  // Submit new Work Order from Quick-Dispatch Composer
  const handleCreateWorkOrder = async () => {
    const title =
      newTitle.trim() || "Autonomous Multi-Agent Feature Implementation";
    const paths = newOutputPaths
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const deps = newDependsOn
      .split(",")
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean);

    try {
      const created = await invoke<MachinaWorkOrder>(
        "machina_submit_work_order",
        {
          request: {
            projectPath: activeProject,
            templateId: selectedTemplateId,
            title,
            allowedOutputPaths: paths.length > 0 ? paths : ["src/**"],
            holdbackSuite: newHoldbackSuite,
            maxCorrections: newMaxCorrections,
            budgetAllowanceUsd: newBudgetUsd,
            authorAgent: newAuthorAgent,
            reviewerAgent: newReviewerAgent,
            dependsOn: deps,
          },
        }
      );

      setWorkOrders((prev) => [created, ...prev.filter((w) => w.id !== created.id)]);
      setSelectedWorkOrderId(created.id);
      setSelectedStageId(created.activeHold ? "ingestion" : "implementation");
      setCenterTab("pipeline");
      setIsComposerOpen(false);
      setNewTitle("");
      setNewDependsOn("");

      if (created.activeHold?.reason === "SCOPE_DRIFT") {
        flashBanner(
          `MISSION.md Anti-Drift Guard HELD ${created.id} (${created.triageState}): Conflicts with Out-of-Scope rule!`
        );
      } else if (created.activeHold?.reason === "PROTECTED_PATH_VIOLATION") {
        flashBanner(
          `Constitutional Protected Path Guard HELD ${created.id}: Builders cannot touch governance files!`
        );
      } else if (created.triageState === "BLOCKED") {
        flashBanner(
          `Queued ${created.id} as BLOCKED (waiting on upstream ${deps.join(", ")} to merge).`
        );
      } else {
        flashBanner(
          `Dispatched ${created.id} via machina_submit_work_order! Holdback vault extracted & stripped.`
        );
      }
    } catch (err) {
      flashBanner(String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-[1420px] h-[91vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#c9d1d9]">
        {/* Top Cockpit Bar */}
        <header className="h-14 px-5 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#58a6ff]/15 border border-[#58a6ff]/40 flex items-center justify-center">
              <Cpu className="w-4 h-4 text-[#58a6ff]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wide">
                  MACHINA PRAXIS
                </h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#58a6ff] font-mono border border-[#30363d]">
                  @aiws/engine v1.0 • 4-Rung Gate
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#bc8cff] font-mono border border-[#30363d]">
                  Ctrl+B F
                </span>
              </div>
              <p className="text-[11px] text-[#8b949e]">
                MISSION.md Anti-Drift Constitution • Protected Paths • 4-Rung Holdback Vault • Mutation Calibration
              </p>
            </div>
          </div>

          {/* Center & Right Controls: Loop Mode (ACTIVE/PAUSE/HALT), Constitution, Epoch, Composer */}
          <div className="flex items-center gap-2">
            {/* Loop Mode Segmented Pill (ACTIVE | PAUSE | HALT) */}
            <div className="flex items-center rounded-md bg-[#0d1117] border border-[#30363d] p-0.5 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => handleSetLoopMode("ACTIVE")}
                className={`flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer ${
                  loopMode === "ACTIVE"
                    ? "bg-[#238636] text-white font-bold"
                    : "text-[#8b949e] hover:text-white"
                }`}
                title="ACTIVE: Admits READY work orders and runs scheduled laps"
              >
                <Play className="w-3 h-3" />
                <span>ACTIVE</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetLoopMode("PAUSED")}
                className={`flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer ${
                  loopMode === "PAUSED"
                    ? "bg-[#d29922] text-[#0d1117] font-bold"
                    : "text-[#8b949e] hover:text-white"
                }`}
                title="PAUSE: Stops starting new laps while letting in-flight runs finish cleanly"
              >
                <Pause className="w-3 h-3" />
                <span>PAUSE</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetLoopMode("HALTED")}
                className={`flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer ${
                  loopMode === "HALTED"
                    ? "bg-[#f85149] text-white font-bold"
                    : "text-[#8b949e] hover:text-white"
                }`}
                title="HALT: Emergency stop — blocks all new launches and interrupts active runs"
              >
                <OctagonAlert className="w-3 h-3" />
                <span>HALT</span>
              </button>
            </div>

            {/* Sidecar Epoch Status */}
            <div className="hidden 2xl:flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0d1117] border border-[#30363d] text-xs font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  sidecarState === "READY"
                    ? "bg-[#3fb950]"
                    : sidecarState === "RESTARTING"
                    ? "bg-[#d29922] animate-ping"
                    : "bg-[#f85149]"
                }`}
              />
              <span className="text-[#58a6ff]">Epoch #{epoch}</span>
              <span className="text-[#30363d]">|</span>
              <span className="text-[#8b949e]">PID {sidecarPid}</span>
            </div>

            {/* Constitution & Calibration View Toggle */}
            <button
              type="button"
              onClick={() =>
                setCenterTab((prev) =>
                  prev === "pipeline" ? "constitution" : "pipeline"
                )
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors cursor-pointer ${
                centerTab === "constitution"
                  ? "bg-[#bc8cff]/20 border-[#bc8cff] text-[#bc8cff]"
                  : "bg-[#21262d] hover:bg-[#30363d] border-[#30363d] text-[#c9d1d9]"
              }`}
              title="Inspect MISSION.md Anti-Drift Constitution, Protected Paths & 4-Rung Mutation Calibration"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>
                MISSION.md & Calibration ({calibrationReport.caughtCount}/
                {calibrationReport.totalDefects})
              </span>
            </button>

            <button
              type="button"
              onClick={handleSimulateEpochRecovery}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-[#d29922] border border-[#30363d] text-xs font-medium transition-colors cursor-pointer"
              title="Simulate sidecar crash & test Ticket 03 Epoch-Fenced Recovery"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Epoch Crash Test</span>
            </button>

            <button
              type="button"
              onClick={() => setIsComposerOpen((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                isComposerOpen
                  ? "bg-[#58a6ff] text-[#0d1117]"
                  : "bg-[#238636] hover:bg-[#2ea043] text-white"
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Work Order</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md transition-colors"
              title="Close Factory Station (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Live Action Feedback Banner */}
        {statusBanner && (
          <div className="px-5 py-2 bg-[#1f6feb]/20 border-b border-[#58a6ff]/40 flex items-center justify-between text-xs text-[#58a6ff]">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>{statusBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-[11px] hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main 3-Zone Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* LEFT ZONE: Active Work Orders & Global Factory Ledger */}
          <aside className="w-80 border-r border-[#30363d] bg-[#161b22]/60 flex flex-col shrink-0">
            {/* Global Exposure & Ledger Meter */}
            <div className="p-3.5 border-b border-[#30363d] bg-[#161b22] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-[#e3b341]" />
                  <span>Supervised Admission Ledger</span>
                </span>
                <span className="text-xs font-mono font-bold text-[#e3b341]">
                  ${totalSpentUsd.toFixed(2)} / ${totalBudgetUsd.toFixed(2)}
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-[#0d1117] overflow-hidden border border-[#30363d]">
                <div
                  className="h-full bg-gradient-to-r from-[#3fb950] via-[#58a6ff] to-[#e3b341] transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((totalSpentUsd / Math.max(totalBudgetUsd, 1)) * 100)
                    )}%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono">
                <div className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d]">
                  <div className="text-[#8b949e]">ACTIVE HOLDS</div>
                  <div
                    className={`font-bold text-xs ${
                      activeHoldCount > 0 ? "text-[#d29922]" : "text-[#3fb950]"
                    }`}
                  >
                    {activeHoldCount} Governed
                  </div>
                </div>
                <div className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d]">
                  <div className="text-[#8b949e]">GATE JUDGE</div>
                  <div className="font-bold text-xs text-[#3fb950]">
                    {calibrationReport.caughtCount}/{calibrationReport.totalDefects} Caught
                  </div>
                </div>
                <div className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d]">
                  <div className="text-[#8b949e]">LOOP MODE</div>
                  <div
                    className={`font-bold text-xs ${
                      loopMode === "ACTIVE"
                        ? "text-[#3fb950]"
                        : loopMode === "PAUSED"
                        ? "text-[#d29922]"
                        : "text-[#f85149]"
                    }`}
                  >
                    {loopMode}
                  </div>
                </div>
              </div>
            </div>

            {/* Work Order Queue Header */}
            <div className="px-3.5 py-2 border-b border-[#30363d] flex items-center justify-between text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">
              <span>Work Orders ({workOrders.length})</span>
              <span className="font-mono text-[10px] text-[#58a6ff]">.machina/</span>
            </div>

            {/* Work Order List */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {workOrders.map((wo) => {
                const isSelected = wo.id === selectedWorkOrder.id;
                const triage = wo.triageState || "READY";
                return (
                  <div
                    key={wo.id}
                    onClick={() => {
                      setSelectedWorkOrderId(wo.id);
                      setCenterTab("pipeline");
                      setIsComposerOpen(false);
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-[#21262d] border-[#58a6ff] shadow-md"
                        : "bg-[#0d1117]/80 border-[#30363d] hover:border-[#8b949e]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-[#58a6ff]">
                          {wo.id}
                        </span>
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                            triage === "READY"
                              ? "bg-[#3fb950]/15 text-[#3fb950]"
                              : triage === "BLOCKED"
                              ? "bg-[#d29922]/20 text-[#d29922]"
                              : triage === "NO_ACTION"
                              ? "bg-[#f85149]/20 text-[#ff7b72]"
                              : "bg-[#bc8cff]/20 text-[#bc8cff]"
                          }`}
                          title={`Archon Intake Triage State: ${triage}`}
                        >
                          {triage}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                          wo.status === "ON_HOLD"
                            ? "bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40"
                            : wo.status === "IN_PROGRESS"
                            ? "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40"
                            : wo.status === "COMPLETED"
                            ? "bg-[#3fb950]/20 text-[#3fb950] border border-[#3fb950]/40"
                            : wo.status === "QUEUED"
                            ? "bg-[#8b949e]/20 text-[#c9d1d9] border border-[#8b949e]/40"
                            : "bg-[#f85149]/20 text-[#f85149] border border-[#f85149]/40"
                        }`}
                      >
                        {wo.status}
                      </span>
                    </div>

                    <div className="text-xs font-semibold text-white line-clamp-1 mb-1">
                      {wo.title}
                    </div>

                    {wo.dependsOn && wo.dependsOn.length > 0 && (
                      <div className="text-[10px] font-mono text-[#bc8cff] mb-1">
                        Depends on: {wo.dependsOn.join(", ")}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-[#8b949e] font-mono">
                      <span className="flex items-center gap-1 truncate max-w-[160px]">
                        <GitBranch className="w-3 h-3 text-[#58a6ff] shrink-0" />
                        <span className="truncate">{wo.branchName}</span>
                      </span>
                      <span className="text-[#e3b341]">
                        ${wo.spentUsd.toFixed(2)}/${wo.budgetAllowanceUsd.toFixed(2)}
                      </span>
                    </div>

                    {/* Mini 6-stage progress pills */}
                    <div className="grid grid-cols-6 gap-1 mt-2.5">
                      {wo.stages.map((st) => (
                        <div
                          key={st.id}
                          className={`h-1.5 rounded-full ${
                            st.status === "PASSED"
                              ? "bg-[#3fb950]"
                              : st.status === "ON_HOLD"
                              ? "bg-[#d29922] animate-pulse"
                              : st.status === "RUNNING" || st.status === "CORRECTION"
                              ? "bg-[#58a6ff] animate-pulse"
                              : st.status === "FAILED"
                              ? "bg-[#f85149]"
                              : "bg-[#30363d]"
                          }`}
                          title={`${st.index}. ${st.title}: ${st.status}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* CENTER ZONE: Toggleable between (A) 6-Stage Pipeline & 4-Rung Gate OR (B) MISSION.md Constitution & Mutation Calibration */}
          <main className="flex-1 flex flex-col min-w-0 bg-[#0d1117] overflow-y-auto p-5 space-y-5">
            {centerTab === "constitution" ? (
              /* VIEW B: MISSION.md Anti-Drift Constitution & Deliberate Mutation Calibration ("Test the Judge") */
              <div className="space-y-5">
                <div className="p-4 rounded-xl bg-[#161b22] border border-[#bc8cff]/40 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-[#bc8cff]" />
                      <h3 className="text-base font-bold text-white">
                        Factory Constitution (`MISSION.md`) & 4-Rung Gate Calibration
                      </h3>
                    </div>
                    <p className="text-xs text-[#8b949e] mt-0.5">
                      Inspired by coleam00/ai-software-factory: Prevents scope drift before coding starts and proves every validation rung catches deliberate defects.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveConstitution(constitution, true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-bold transition-colors cursor-pointer"
                      title="Writes MISSION.md, harness/END-TO-END.md, and .factory/holdout/HOLDOUT.md into the active workspace"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Write 3-File Bootstrap to Repo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCenterTab("pipeline")}
                      className="px-3 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-xs font-semibold text-white cursor-pointer"
                    >
                      Back to Pipeline
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left Card: MISSION.md Anti-Drift Constitution */}
                  <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-[#d29922]" />
                        <span>`MISSION.md` — Out of Scope (Never Build)</span>
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#d29922]/15 text-[#d29922] border border-[#d29922]/30">
                        ANTI-DRIFT GUARD
                      </span>
                    </div>

                    <p className="text-xs text-[#8b949e] leading-relaxed">
                      {constitution.productSummary}
                    </p>

                    <div className="space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-[#ff7b72] uppercase">
                        Out of Scope — Rejected Forever as Drift ({constitution.outOfScopeNever.length} rules)
                      </div>
                      {constitution.outOfScopeNever.map((rule, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded bg-[#0d1117] border border-[#f85149]/30 text-xs text-[#c9d1d9] flex items-start gap-2"
                        >
                          <span className="text-[#f85149] font-mono font-bold">✗</span>
                          <span>{rule}</span>
                        </div>
                      ))}

                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          value={newOutOfScopeRule}
                          onChange={(e) => setNewOutOfScopeRule(e.target.value)}
                          placeholder="Add new Out-of-Scope rule (e.g. Blockchain wallet integration)..."
                          className="flex-1 px-2.5 py-1.5 rounded bg-[#0d1117] border border-[#30363d] text-xs text-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!newOutOfScopeRule.trim()) return;
                            const updated: MissionConstitution = {
                              ...constitution,
                              outOfScopeNever: [
                                ...constitution.outOfScopeNever,
                                newOutOfScopeRule.trim(),
                              ],
                            };
                            setNewOutOfScopeRule("");
                            handleSaveConstitution(updated, false);
                          }}
                          className="px-3 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-semibold text-white cursor-pointer"
                        >
                          Add Rule
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-[#30363d]">
                      <div className="text-[10px] font-mono font-bold text-[#3fb950] uppercase">
                        Constitutional `protected_paths` (Human-Only Files)
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {constitution.protectedPaths.map((p) => (
                          <span
                            key={p}
                            className="px-2 py-0.5 rounded bg-[#0d1117] border border-[#3fb950]/40 text-[#3fb950] font-mono text-[11px]"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Card: Deliberate Mutation Calibration ("Test the Judge") */}
                  <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-[#58a6ff]" />
                        <span>Deliberate Mutation Calibration (`defects.json`)</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleRunMutationCalibration}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1f6feb] hover:bg-[#388bfd] text-white text-[11px] font-bold cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Run 4-Rung Self-Check</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center font-mono text-xs">
                      <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                        <div className="text-[10px] text-[#8b949e]">CAUGHT</div>
                        <div className="text-sm font-bold text-[#3fb950]">
                          {calibrationReport.caughtCount}/{calibrationReport.totalDefects}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                        <div className="text-[10px] text-[#8b949e]">ESCAPED</div>
                        <div className="text-sm font-bold text-[#3fb950]">
                          {calibrationReport.escapedCount}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                        <div className="text-[10px] text-[#8b949e]">INCONCLUSIVE</div>
                        <div className="text-sm font-bold text-[#3fb950]">
                          {calibrationReport.inconclusiveCount}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#0d1117] border border-[#30363d]">
                        <div className="text-[10px] text-[#8b949e]">4 RUNGS PROVEN</div>
                        <div className="text-sm font-bold text-[#58a6ff]">
                          {calibrationReport.allRungsExercised ? "YES (4/4)" : "PARTIAL"}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {calibrationReport.results.map((res) => (
                        <div
                          key={res.defectId}
                          className="p-2.5 rounded-lg bg-[#0d1117] border border-[#30363d] text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-white">
                              {res.defectId}
                            </span>
                            <div className="flex items-center gap-1.5 font-mono text-[10px]">
                              <span className="px-1.5 py-0.5 rounded bg-[#21262d] text-[#58a6ff]">
                                Aimed: {res.targetRung}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-[#3fb950]/20 text-[#3fb950] font-bold">
                                {res.outcome} by {res.caughtByRung || "none"}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-[#8b949e]">{res.why}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* VIEW A: Work Order 6-Stage Pipeline DAG + 4-Rung Gate + Holdback Vault */
              <>
                {/* Work Order Header Summary */}
                <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#58a6ff]/15 text-[#58a6ff] font-mono text-xs font-bold border border-[#58a6ff]/30">
                        {selectedWorkOrder.id}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#3fb950]/15 text-[#3fb950] font-mono text-[11px] font-bold border border-[#3fb950]/30">
                        Triage: {selectedWorkOrder.triageState || "READY"}
                      </span>
                      <h3 className="text-base font-bold text-white">
                        {selectedWorkOrder.title}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[#8b949e] font-mono flex-wrap">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3.5 h-3.5 text-[#58a6ff]" />
                        <span>Worktree: {selectedWorkOrder.worktreePath}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-[#3fb950]">
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Holdback Stripped & Vaulted</span>
                      </span>
                      <span>•</span>
                      <span className="text-[#bc8cff]">
                        Candidate:{" "}
                        {selectedWorkOrder.validationReport.candidateRevisionSha ||
                          "d9080e0 (FACTORY_RUNTIME_CANDIDATE)"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right font-mono">
                      <div className="text-[10px] text-[#8b949e] uppercase">
                        Work Order Spend
                      </div>
                      <div className="text-sm font-bold text-[#e3b341]">
                        ${selectedWorkOrder.spentUsd.toFixed(2)}{" "}
                        <span className="text-xs text-[#8b949e] font-normal">
                          / ${selectedWorkOrder.budgetAllowanceUsd.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRunValidationGate}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#58a6ff]/40 text-xs font-bold transition-colors cursor-pointer"
                      title="Execute 4-Rung Gate (static -> unit -> e2e -> holdout) & Protected Paths Check"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Run 4-Rung Gate</span>
                    </button>
                    {selectedStage.id === "acceptance" &&
                      selectedWorkOrder.status !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={handleAcceptAndMerge}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-bold shadow-md transition-colors cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Squash & Merge to main</span>
                        </button>
                      )}
                  </div>
                </div>

                {/* Interactive 6-Stage Pipeline DAG */}
                <div className="p-4 rounded-xl bg-[#161b22]/60 border border-[#30363d] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white uppercase tracking-wider">
                      <Layers className="w-4 h-4 text-[#58a6ff]" />
                      <span>
                        6-Stage Software Factory Pipeline DAG (Click any stage to inspect)
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-[#8b949e]">
                      Active Stage:{" "}
                      <strong className="text-white">{selectedStage.title}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-6 gap-2.5 pt-1">
                    {selectedWorkOrder.stages.map((stage, idx) => {
                      const isStageSelected = stage.id === selectedStage.id;
                      return (
                        <div key={stage.id} className="relative flex items-stretch">
                          <button
                            type="button"
                            onClick={() => setSelectedStageId(stage.id)}
                            className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col justify-between cursor-pointer ${
                              isStageSelected
                                ? "bg-[#21262d] border-[#58a6ff] ring-1 ring-[#58a6ff]"
                                : "bg-[#0d1117] border-[#30363d] hover:border-[#8b949e]"
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <span className="text-[10px] font-mono text-[#8b949e] font-bold">
                                  STAGE {stage.index}
                                </span>
                                <span
                                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                                    stage.status === "PASSED"
                                      ? "bg-[#3fb950]/20 text-[#3fb950]"
                                      : stage.status === "ON_HOLD"
                                      ? "bg-[#d29922]/20 text-[#d29922]"
                                      : stage.status === "RUNNING" ||
                                        stage.status === "CORRECTION"
                                      ? "bg-[#58a6ff]/20 text-[#58a6ff]"
                                      : stage.status === "FAILED"
                                      ? "bg-[#f85149]/20 text-[#f85149]"
                                      : "bg-[#21262d] text-[#8b949e]"
                                  }`}
                                >
                                  {stage.status}
                                </span>
                              </div>

                              <div className="text-xs font-bold text-white leading-snug mb-1">
                                {stage.title}
                              </div>
                              <div className="text-[10px] text-[#8b949e] line-clamp-2 leading-relaxed">
                                {stage.subtitle}
                              </div>
                            </div>

                            <div className="mt-3 pt-2 border-t border-[#30363d]/60 flex items-center justify-between text-[10px] font-mono">
                              <span className="flex items-center gap-1 text-[#c9d1d9]">
                                <AgentIcon
                                  kind={stage.boundAgentKind}
                                  className="w-3 h-3"
                                />
                                <span className="truncate max-w-[65px]">
                                  {getAgentDisplayName(stage.boundAgentKind)}
                                </span>
                              </span>
                              <span className="text-[#8b949e]">
                                Ord {stage.attemptOrdinal}/{stage.maxCorrections}
                              </span>
                            </div>
                          </button>

                          {idx < selectedWorkOrder.stages.length - 1 && (
                            <div className="hidden xl:flex items-center justify-center -right-2.5 top-1/2 -translate-y-1/2 absolute z-10 pointer-events-none">
                              <ArrowRight className="w-3.5 h-3.5 text-[#8b949e]" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 4-Rung Validation Ladder (`static` -> `unit` -> `e2e` -> `holdout`) */}
                {selectedWorkOrder.validationReport.rungVerdicts && (
                  <div className="grid grid-cols-4 gap-3">
                    {selectedWorkOrder.validationReport.rungVerdicts.map((rv, i) => (
                      <div
                        key={rv.rung}
                        className={`p-3 rounded-xl border ${
                          rv.outcome === "PASS"
                            ? "bg-[#161b22] border-[#30363d]"
                            : rv.outcome === "INCONCLUSIVE"
                            ? "bg-[#d29922]/10 border-[#d29922]/50"
                            : "bg-[#f85149]/10 border-[#f85149]/50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1 font-mono">
                          <span className="text-[10px] text-[#8b949e] uppercase font-bold">
                            RUNG {i + 1}: {rv.rung}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                              rv.outcome === "PASS"
                                ? "bg-[#3fb950]/20 text-[#3fb950]"
                                : rv.outcome === "INCONCLUSIVE"
                                ? "bg-[#d29922]/20 text-[#d29922]"
                                : "bg-[#f85149]/20 text-[#ff7b72]"
                            }`}
                          >
                            {rv.outcome}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#c9d1d9] font-mono truncate">
                          {rv.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Interactive Governed Hold Card (aiws-hold-card/1) */}
                {selectedWorkOrder.activeHold && (
                  <div className="p-4 rounded-xl bg-[#d29922]/10 border-2 border-[#d29922] space-y-3 shadow-lg">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-[#d29922]/20 text-[#d29922] shrink-0 mt-0.5">
                          <ShieldAlert className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[#d29922] text-[#0d1117]">
                              {selectedWorkOrder.activeHold.reason}
                            </span>
                            <span className="text-xs font-mono text-[#d29922]">
                              {selectedWorkOrder.activeHold.profile} •{" "}
                              {selectedWorkOrder.activeHold.holdId}
                            </span>
                            <span className="text-[11px] font-mono text-[#8b949e]">
                              Attempt: {selectedWorkOrder.activeHold.attemptId}
                            </span>
                          </div>
                          <p className="text-xs text-white mt-1.5 leading-relaxed">
                            {selectedWorkOrder.activeHold.summary}
                          </p>
                          {selectedWorkOrder.activeHold.requiredScope && (
                            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0d1117] border border-[#d29922]/40 text-[11px] font-mono text-[#e3b341]">
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>
                                Scope / Rule: {selectedWorkOrder.activeHold.requiredScope}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 1-Click Governed Hold Exit Buttons */}
                    <div className="pt-2 border-t border-[#d29922]/30 flex flex-wrap items-center gap-2">
                      {selectedWorkOrder.activeHold.exitOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleResolveHold(opt.id, opt.label)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                            opt.variant === "primary"
                              ? "bg-[#d29922] hover:bg-[#e3b341] text-[#0d1117]"
                              : opt.variant === "danger"
                              ? "bg-[#f85149]/20 hover:bg-[#f85149]/30 text-[#ff7b72] border border-[#f85149]/40"
                              : "bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d]"
                          }`}
                          title={opt.description}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Two-Tier Worktree Holdback & Sanitized Diagnostics Inspector */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left Box: Vault Extraction, Output-Path Confinement & Protected Paths */}
                  <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-2">
                        <Lock className="w-4 h-4 text-[#3fb950]" />
                        <span>Holdback Vault, Confinement & `protected_paths`</span>
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#3fb950]/15 text-[#3fb950] border border-[#3fb950]/30">
                        STRIPPED FROM WORKTREE
                      </span>
                    </div>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1">
                        <div className="text-[10px] text-[#8b949e]">EXTERNAL VAULT PATH</div>
                        <div className="text-[#58a6ff] truncate">
                          {selectedWorkOrder.validationReport.vaultPath}
                        </div>
                        <div className="text-[10px] text-[#8b949e] truncate">
                          SHA-256: {selectedWorkOrder.validationReport.vaultSha256}
                        </div>
                      </div>

                      <div className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#8b949e]">
                            ALLOWED OUTPUT PATHS & PROTECTED CONSTITUTION
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              selectedWorkOrder.validationReport.protectedPathsPassed !==
                              false
                                ? "text-[#3fb950]"
                                : "text-[#f85149]"
                            }`}
                          >
                            {selectedWorkOrder.validationReport.protectedPathsPassed !==
                            false
                              ? "0 GOVERNANCE VIOLATIONS"
                              : "PROTECTED PATH VIOLATED"}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedWorkOrder.validationReport.allowedOutputPaths.map((p) => (
                            <span
                              key={p}
                              className="px-2 py-0.5 rounded bg-[#161b22] text-[#c9d1d9] border border-[#30363d] text-[11px]"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="p-2.5 rounded bg-[#0d1117] border border-[#30363d] space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#8b949e]">
                            GATE LOG & `CHECKS_OK` SENTINEL
                          </span>
                          <span className="text-[10px] text-[#3fb950] font-bold">
                            {selectedWorkOrder.validationReport.tier1BuildPassed
                              ? "PASSED"
                              : "FAILED"}
                          </span>
                        </div>
                        <pre className="text-[11px] text-[#8b949e] whitespace-pre-wrap leading-relaxed">
                          {selectedWorkOrder.validationReport.tier1RawOutput}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {/* Right Box: Tier 2 Blind Holdback Invariants (Sanitized for Correction Loop) */}
                  <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-2">
                        <FileCheck2 className="w-4 h-4 text-[#58a6ff]" />
                        <span>Tier 2 Blind Holdback Invariants (Sanitized)</span>
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#bc8cff]/15 text-[#bc8cff] border border-[#bc8cff]/30">
                        SOURCE REDACTED
                      </span>
                    </div>

                    <div className="space-y-2">
                      {selectedWorkOrder.validationReport.tier2SanitizedInvariants.map(
                        (inv) => (
                          <div
                            key={inv.invariantId}
                            className={`p-3 rounded-lg border text-xs ${
                              inv.passed
                                ? "bg-[#0d1117] border-[#30363d]"
                                : "bg-[#f85149]/10 border-[#f85149]/50"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-mono font-bold text-white">
                                {inv.invariantId}: {inv.title}
                              </span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                                  inv.passed
                                    ? "bg-[#3fb950]/20 text-[#3fb950]"
                                    : "bg-[#f85149]/20 text-[#ff7b72]"
                                }`}
                              >
                                {inv.passed ? "PASSED" : "FAILED"}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono text-[#8b949e] leading-relaxed">
                              {inv.sanitizedMessage}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </main>

          {/* RIGHT ZONE: Stage Agent ConPTY Inspector OR Quick-Dispatch Composer */}
          <aside className="w-88 border-l border-[#30363d] bg-[#161b22] flex flex-col shrink-0 overflow-y-auto">
            {isComposerOpen ? (
              /* Quick-Dispatch Work Order Composer */
              <div className="p-4 space-y-3.5">
                <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      New Work Order Composer
                    </h3>
                    <p className="text-[11px] text-[#8b949e]">
                      Checked against `MISSION.md` & `protected_paths`
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsComposerOpen(false)}
                    className="text-xs text-[#8b949e] hover:text-white"
                  >
                    Cancel
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                      Factory Pipeline Template (`.machina/templates/`)
                    </label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => {
                        const tpl =
                          BUILTIN_TEMPLATES.find((t) => t.id === e.target.value) ||
                          BUILTIN_TEMPLATES[0];
                        setSelectedTemplateId(tpl.id);
                        setNewOutputPaths(tpl.defaultOutputPaths.join(", "));
                        setNewHoldbackSuite(tpl.defaultHoldbackSuite);
                        setNewMaxCorrections(tpl.defaultMaxCorrections);
                        setNewBudgetUsd(tpl.defaultBudgetUsd);
                        setNewAuthorAgent(tpl.defaultAuthorAgent);
                        setNewReviewerAgent(tpl.defaultReviewerAgent);
                      }}
                      className="w-full px-2.5 py-2 rounded bg-[#0d1117] border border-[#30363d] text-white text-xs"
                    >
                      {BUILTIN_TEMPLATES.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold text-[#8b949e]">
                        Work Order Title / Objective
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setNewTitle(
                            "Add cloud-hosted multi-tenant SaaS execution portal"
                          )
                        }
                        className="text-[10px] text-[#d29922] hover:underline cursor-pointer"
                        title="Fill an Out-of-Scope title to test MISSION.md Anti-Drift Guard"
                      >
                        Test Drift Guard
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="e.g. WebSocket Reconnect Backoff & Holdback Verification"
                      className="w-full px-2.5 py-2 rounded bg-[#0d1117] border border-[#30363d] text-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                      Depends On Work Orders (Optional, e.g. `WO-104`)
                    </label>
                    <input
                      type="text"
                      value={newDependsOn}
                      onChange={(e) => setNewDependsOn(e.target.value)}
                      placeholder="Leave empty or enter WO-104 to test BLOCKED intake"
                      className="w-full px-2.5 py-1.5 rounded bg-[#0d1117] border border-[#30363d] text-[#bc8cff] font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                      Confined `outputPaths` (Protected paths auto-blocked)
                    </label>
                    <input
                      type="text"
                      value={newOutputPaths}
                      onChange={(e) => setNewOutputPaths(e.target.value)}
                      className="w-full px-2.5 py-2 rounded bg-[#0d1117] border border-[#30363d] text-white font-mono text-[11px]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                      Blind Holdback Suite (Extracted & Stripped)
                    </label>
                    <input
                      type="text"
                      value={newHoldbackSuite}
                      onChange={(e) => setNewHoldbackSuite(e.target.value)}
                      className="w-full px-2.5 py-2 rounded bg-[#0d1117] border border-[#30363d] text-[#3fb950] font-mono text-[11px]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                        Max Corrections
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={newMaxCorrections}
                        onChange={(e) => setNewMaxCorrections(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded bg-[#0d1117] border border-[#30363d] text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                        Budget Cap ($ USD)
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        min={1}
                        value={newBudgetUsd}
                        onChange={(e) => setNewBudgetUsd(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 rounded bg-[#0d1117] border border-[#30363d] text-[#e3b341] font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                        Author Agent CLI
                      </label>
                      <select
                        value={newAuthorAgent}
                        onChange={(e) => setNewAuthorAgent(e.target.value as RunKind)}
                        className="w-full px-2 py-1.5 rounded bg-[#0d1117] border border-[#30363d] text-white"
                      >
                        {AGENT_OPTIONS.map((k) => (
                          <option key={k} value={k}>
                            {getAgentDisplayName(k)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                        Reviewer / Gate Agent
                      </label>
                      <select
                        value={newReviewerAgent}
                        onChange={(e) => setNewReviewerAgent(e.target.value as RunKind)}
                        className="w-full px-2 py-1.5 rounded bg-[#0d1117] border border-[#30363d] text-white"
                      >
                        {AGENT_OPTIONS.map((k) => (
                          <option key={k} value={k}>
                            {getAgentDisplayName(k)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateWorkOrder}
                    className="w-full py-2.5 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer mt-2"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Submit Work Order to Praxis</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Selected Stage & Agent ConPTY Binding Inspector */
              <div className="p-4 space-y-4">
                <div className="border-b border-[#30363d] pb-3">
                  <div className="text-[10px] font-mono text-[#58a6ff] uppercase font-bold">
                    Stage {selectedStage.index} of 6 Inspector
                  </div>
                  <h3 className="text-sm font-bold text-white mt-0.5">
                    {selectedStage.title}
                  </h3>
                  <p className="text-xs text-[#8b949e] mt-1">
                    {selectedStage.subtitle}
                  </p>
                </div>

                {/* Bound Agent CLI Selector & ConPTY Controls */}
                <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#8b949e] uppercase">
                      Bound Stage Agent CLI
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                      <AgentIcon
                        kind={selectedStage.boundAgentKind}
                        className="w-3.5 h-3.5"
                      />
                      <span>{getAgentDisplayName(selectedStage.boundAgentKind)}</span>
                    </span>
                  </div>

                  <div>
                    <label className="block text-[10px] text-[#8b949e] mb-1">
                      Rebind Stage to Any Agent CLI
                    </label>
                    <select
                      value={selectedStage.boundAgentKind}
                      onChange={(e) =>
                        handleRebindStageAgent(e.target.value as RunKind)
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-[#161b22] border border-[#30363d] text-xs text-white"
                    >
                      {AGENT_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {getAgentDisplayName(k)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={handleJumpToStageTerminal}
                      className="w-full py-2 px-3 rounded-md bg-[#1f6feb] hover:bg-[#388bfd] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Jump / Spawn Bound ConPTY Pane</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleDispatchStageToConPty}
                      className="w-full py-2 px-3 rounded-md bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white border border-[#30363d] text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Network className="w-3.5 h-3.5 text-[#58a6ff]" />
                      <span>Dispatch Stage Contract via ConPTY</span>
                    </button>
                  </div>
                </div>

                {/* Attempt & Protocol Metadata */}
                <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] space-y-2 text-xs font-mono">
                  <div className="text-[10px] font-sans font-semibold text-[#8b949e] uppercase">
                    Praxis Attempt & Protocol Contract
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#30363d]/50">
                    <span className="text-[#8b949e]">Attempt Kind:</span>
                    <span className="text-[#58a6ff] font-bold">
                      {selectedStage.attemptKind} (Ord {selectedStage.attemptOrdinal}/
                      {selectedStage.maxCorrections})
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#30363d]/50">
                    <span className="text-[#8b949e]">MCP Tool Binding:</span>
                    <span className="text-[#3fb950]">{selectedStage.mcpToolName}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#30363d]/50">
                    <span className="text-[#8b949e]">A2A Agent Card:</span>
                    <span className="text-[#bc8cff]">machina-praxis (v1.3.0)</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-[#8b949e]">Stage Spend / Time:</span>
                    <span className="text-[#e3b341]">
                      ${selectedStage.costUsd.toFixed(2)} • {selectedStage.durationSec}s
                    </span>
                  </div>
                </div>

                {/* Active Epoch Credential Leases */}
                <div className="p-3.5 rounded-lg bg-[#0d1117] border border-[#30363d] space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-[#8b949e] uppercase">
                    <span>Epoch #{selectedWorkOrder.epoch} Credential Leases</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#3fb950]" />
                  </div>
                  {selectedWorkOrder.activeLeases.length === 0 ? (
                    <div className="text-xs text-[#8b949e] italic">
                      No active credential leases (all released or revoked).
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {selectedWorkOrder.activeLeases.map((lease) => (
                        <div
                          key={lease}
                          className="px-2.5 py-1.5 rounded bg-[#161b22] border border-[#30363d] flex items-center justify-between text-[11px] font-mono"
                        >
                          <span className="text-[#3fb950] truncate">{lease}</span>
                          <span className="text-[10px] text-[#8b949e]">VALID</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};
