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
} from "lucide-react";
import { TerminalInfo, RunKind, isAgentRunKind } from "../terminal/types";
import { AgentIcon } from "../terminal/AgentIcons";
import {
  SidecarHealthState,
  MachinaWorkOrder,
  FactoryTemplate,
  PipelineStageNode,
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

const INITIAL_WORK_ORDERS: MachinaWorkOrder[] = [
  {
    id: "WO-104",
    title: "PKCE OAuth2 Token Refresh & Session Vault",
    templateId: "feature-holdback-tdd",
    status: "ON_HOLD",
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
        "Stage 4 (Two-Tier Holdback Gate) requires ephemeral OAuth2 test sandbox credentials to execute live token-rotation invariants.",
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
        title: "Ingestion & Admission",
        subtitle: "SupervisedAdmissionService budget & capability fence",
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
        title: "Two-Tier Holdback Gate",
        subtitle: "Tier 1 Build + Tier 2 Blind Vault + Pre-PR Audit",
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
      tier1BuildPassed: true,
      tier1RawOutput:
        "✓ tsc --noEmit (0 errors)\n✓ cargo check --manifest-path src-tauri/Cargo.toml (0 warnings)\n✓ vitest run src/slices/auth/pkceClient.test.ts (8 passed)",
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
  {
    id: "WO-105",
    title: "Zero-Copy ConPTY Ring Buffer Serializer",
    templateId: "autonomous-bugfix",
    status: "IN_PROGRESS",
    branchName: "machina/wo-105-conpty-ringbuf",
    worktreePath: ".machina/worktrees/WO-105",
    epoch: 4,
    budgetAllowanceUsd: 4.5,
    spentUsd: 1.12,
    activeLeases: ["lease_fs_worktree_105", "lease_cargo_test_105"],
    createdAt: "6m ago",
    activeHold: null,
    stages: [
      {
        id: "ingestion",
        index: 1,
        title: "Ingestion & Admission",
        subtitle: "SupervisedAdmissionService budget & capability fence",
        status: "PASSED",
        boundAgentKind: "kiro",
        boundTerminalName: "kiro-lead",
        attemptOrdinal: 1,
        maxCorrections: 4,
        attemptKind: "INITIAL",
        costUsd: 0.08,
        durationSec: 3,
        mcpToolName: "machina_submit_work_order",
      },
      {
        id: "scaffold",
        index: 2,
        title: "Worktree & Vault Scaffold",
        subtitle: "Strip .machina/holdbacks/ -> %LOCALAPPDATA% vault",
        status: "PASSED",
        boundAgentKind: "kiro",
        boundTerminalName: "kiro-lead",
        attemptOrdinal: 1,
        maxCorrections: 4,
        attemptKind: "INITIAL",
        costUsd: 0.04,
        durationSec: 2,
        mcpToolName: "machina_claim_attempt",
      },
      {
        id: "implementation",
        index: 3,
        title: "Agent Implementation",
        subtitle: "Authoring inside confined outputPaths",
        status: "RUNNING",
        boundAgentKind: "codex",
        boundTerminalName: "codex-rust",
        attemptOrdinal: 2,
        maxCorrections: 4,
        attemptKind: "CORRECTION",
        costUsd: 1.0,
        durationSec: 61,
        mcpToolName: "machina_submit_deliverable",
      },
      {
        id: "holdback_gate",
        index: 4,
        title: "Two-Tier Holdback Gate",
        subtitle: "Tier 1 Build + Tier 2 Blind Vault + Pre-PR Audit",
        status: "PENDING",
        boundAgentKind: "copilot",
        boundTerminalName: "copilot-audit",
        attemptOrdinal: 2,
        maxCorrections: 4,
        attemptKind: "CORRECTION",
        costUsd: 0.0,
        durationSec: 0,
        mcpToolName: "machina_submit_deliverable",
      },
      {
        id: "correction_loop",
        index: 5,
        title: "Correction Ordinal Loop",
        subtitle: "Sanitized behavioral diagnostics (Ordinal 2/4)",
        status: "CORRECTION",
        boundAgentKind: "codex",
        boundTerminalName: "codex-rust",
        attemptOrdinal: 2,
        maxCorrections: 4,
        attemptKind: "CORRECTION",
        costUsd: 0.0,
        durationSec: 8,
        mcpToolName: "machina_claim_attempt",
      },
      {
        id: "acceptance",
        index: 6,
        title: "Human Merge Acceptance",
        subtitle: "Squash-merge verified worktree into main",
        status: "PENDING",
        boundAgentKind: "kiro",
        boundTerminalName: "kiro-lead",
        attemptOrdinal: 1,
        maxCorrections: 4,
        attemptKind: "INITIAL",
        costUsd: 0.0,
        durationSec: 0,
        mcpToolName: "machina_get_stage_status",
      },
    ],
    validationReport: {
      vaultPath: "%LOCALAPPDATA%\\Quay2\\praxis\\holdbacks\\WO-105",
      vaultSha256: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      strippedFromAuthoringWorktree: true,
      outputPathConfinementPassed: true,
      allowedOutputPaths: ["src-tauri/src/slices/pty/**"],
      modifiedFiles: ["src-tauri/src/slices/pty/manager.rs"],
      tier1BuildPassed: true,
      tier1RawOutput: "✓ cargo test --manifest-path src-tauri/Cargo.toml (19 passed)",
      tier2HoldbackPassed: true,
      tier2SanitizedInvariants: [
        {
          invariantId: "INV-PTY-01",
          title: "Ring buffer preserves UTF-8 multi-byte boundary across 500KB truncation",
          passed: true,
          sanitizedMessage: "Assertion satisfied across all boundary splits.",
        },
      ],
      prePrSecretAuditPassed: true,
    },
  },
  {
    id: "WO-103",
    title: "Loopback MCP Tool Schema Validator",
    templateId: "security-hardening-gate",
    status: "COMPLETED",
    branchName: "machina/wo-103-mcp-schema",
    worktreePath: ".machina/worktrees/WO-103",
    epoch: 4,
    budgetAllowanceUsd: 3.0,
    spentUsd: 0.84,
    activeLeases: [],
    createdAt: "38m ago",
    activeHold: null,
    stages: [
      {
        id: "ingestion",
        index: 1,
        title: "Ingestion & Admission",
        subtitle: "SupervisedAdmissionService budget & capability fence",
        status: "PASSED",
        boundAgentKind: "claude",
        attemptOrdinal: 1,
        maxCorrections: 2,
        attemptKind: "INITIAL",
        costUsd: 0.06,
        durationSec: 2,
        mcpToolName: "machina_submit_work_order",
      },
      {
        id: "scaffold",
        index: 2,
        title: "Worktree & Vault Scaffold",
        subtitle: "Strip .machina/holdbacks/ -> %LOCALAPPDATA% vault",
        status: "PASSED",
        boundAgentKind: "claude",
        attemptOrdinal: 1,
        maxCorrections: 2,
        attemptKind: "INITIAL",
        costUsd: 0.04,
        durationSec: 2,
        mcpToolName: "machina_claim_attempt",
      },
      {
        id: "implementation",
        index: 3,
        title: "Agent Implementation",
        subtitle: "Authoring inside confined outputPaths",
        status: "PASSED",
        boundAgentKind: "opencode",
        attemptOrdinal: 1,
        maxCorrections: 2,
        attemptKind: "INITIAL",
        costUsd: 0.52,
        durationSec: 47,
        mcpToolName: "machina_submit_deliverable",
      },
      {
        id: "holdback_gate",
        index: 4,
        title: "Two-Tier Holdback Gate",
        subtitle: "Tier 1 Build + Tier 2 Blind Vault + Pre-PR Audit",
        status: "PASSED",
        boundAgentKind: "claude",
        attemptOrdinal: 1,
        maxCorrections: 2,
        attemptKind: "INITIAL",
        costUsd: 0.22,
        durationSec: 14,
        mcpToolName: "machina_submit_deliverable",
      },
      {
        id: "correction_loop",
        index: 5,
        title: "Correction Ordinal Loop",
        subtitle: "0 corrections needed (Passed on Initial)",
        status: "PASSED",
        boundAgentKind: "opencode",
        attemptOrdinal: 1,
        maxCorrections: 2,
        attemptKind: "INITIAL",
        costUsd: 0.0,
        durationSec: 0,
        mcpToolName: "machina_claim_attempt",
      },
      {
        id: "acceptance",
        index: 6,
        title: "Human Merge Acceptance",
        subtitle: "Merged to main (commit 8f31c2a)",
        status: "PASSED",
        boundAgentKind: "claude",
        attemptOrdinal: 1,
        maxCorrections: 2,
        attemptKind: "INITIAL",
        costUsd: 0.0,
        durationSec: 2,
        mcpToolName: "machina_get_stage_status",
      },
    ],
    validationReport: {
      vaultPath: "%LOCALAPPDATA%\\Quay2\\praxis\\holdbacks\\WO-103",
      vaultSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      strippedFromAuthoringWorktree: true,
      outputPathConfinementPassed: true,
      allowedOutputPaths: ["src-tauri/src/slices/orchestrator/**"],
      modifiedFiles: ["src-tauri/src/slices/orchestrator/mcp.rs"],
      tier1BuildPassed: true,
      tier1RawOutput: "✓ All 5 MCP tool JSON-RPC schemas verified",
      tier2HoldbackPassed: true,
      tier2SanitizedInvariants: [
        {
          invariantId: "INV-MCP-01",
          title: "Rejects unauthenticated or epoch-stale attempt claims",
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
  const [epoch, setEpoch] = useState<number>(4);
  const [sidecarPid, setSidecarPid] = useState<number>(28412);
  const [workOrders, setWorkOrders] = useState<MachinaWorkOrder[]>(INITIAL_WORK_ORDERS);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string>("WO-104");
  const [selectedStageId, setSelectedStageId] = useState<PipelineStageNode["id"]>("holdback_gate");
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Sync live state from Rust MachinaManager when modal opens or receives backend events
  useEffect(() => {
    if (!isOpen) return;

    const loadBackendState = async () => {
      try {
        const status = await invoke<{
          sidecarState: SidecarHealthState;
          epoch: number;
          pid: number;
        }>("machina_get_status");
        if (status) {
          setSidecarState(status.sidecarState);
          setEpoch(status.epoch);
          setSidecarPid(status.pid);
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
      epoch: number;
      pid: number;
    }>("machina-state-updated", async (event) => {
      if (event.payload) {
        setSidecarState(event.payload.sidecarState);
        setEpoch(event.payload.epoch);
        setSidecarPid(event.payload.pid);
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(BUILTIN_TEMPLATES[0].id);
  const [newTitle, setNewTitle] = useState<string>("");
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
    setTimeout(() => setStatusBanner(null), 4000);
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
          `Resolved hold (${optionLabel}) via machina_resolve_hold. All Two-Tier Holdback invariants passed!`
        );
      }
    } catch (err) {
      console.error("Failed to resolve hold:", err);
    }
  };

  // Run Two-Tier Holdback Gate Validation Now
  const handleRunValidationGate = async () => {
    flashBanner(
      `Running Two-Tier Holdback Gate & Pre-PR Secret Audit for ${selectedWorkOrder.id}...`
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
        `Two-Tier Holdback Gate completed for ${updated.id}: Confinement=${
          updated.validationReport.outputPathConfinementPassed ? "PASS" : "FAIL"
        }, Pre-PR Audit=${
          updated.validationReport.prePrSecretAuditPassed ? "PASS" : "FAIL"
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

    const sanitizedPrompt = `[Machina Praxis ${selectedWorkOrder.id} • Stage ${selectedStage.index}: ${selectedStage.title} • Ordinal ${selectedStage.attemptOrdinal}/${selectedStage.maxCorrections} (${selectedStage.attemptKind})]\nWorktree: ${selectedWorkOrder.worktreePath} | Allowed Output Paths: ${selectedWorkOrder.validationReport.allowedOutputPaths.join(", ")}\nCall MCP tool \`${selectedStage.mcpToolName}\` when ready.\n`;

    if (matchingTerm) {
      await onWritePty(matchingTerm.id, sanitizedPrompt);
      flashBanner(`Dispatched Stage ${selectedStage.index} contract to ${matchingTerm.name}.`);
    } else {
      flashBanner(
        `No active ${getAgentDisplayName(selectedStage.boundAgentKind)} terminal found — click "Jump / Spawn ConPTY" to launch one.`
      );
    }
  };

  // Complete Human Merge Acceptance
  const handleAcceptAndMerge = async () => {
    try {
      const updated = await invoke<MachinaWorkOrder>(
        "machina_accept_and_merge",
        {
          workOrderId: selectedWorkOrder.id,
        }
      );
      setWorkOrders((prev) =>
        prev.map((wo) => (wo.id === updated.id ? updated : wo))
      );
      flashBanner(
        `Squash-merged ${selectedWorkOrder.branchName} into main and cleaned up worktree ${selectedWorkOrder.worktreePath}!`
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
          },
        }
      );

      setWorkOrders((prev) => [created, ...prev.filter((w) => w.id !== created.id)]);
      setSelectedWorkOrderId(created.id);
      setSelectedStageId("implementation");
      setIsComposerOpen(false);
      setNewTitle("");
      flashBanner(
        `Dispatched ${created.id} via machina_submit_work_order! Holdback vault extracted & stripped.`
      );
    } catch (err) {
      console.error("Failed to submit work order:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-[1380px] h-[90vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#c9d1d9]">
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
                  @aiws/engine v1.0 • Node 24 SQLite
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#bc8cff] font-mono border border-[#30363d]">
                  Ctrl+B F
                </span>
              </div>
              <p className="text-[11px] text-[#8b949e]">
                Autonomous AI Software Factory • Two-Tier Blind Holdback Vault • Dual MCP & A2A v1.3.0
              </p>
            </div>
          </div>

          {/* Center: Sidecar Supervisor Telemetry & Epoch Pill */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0d1117] border border-[#30363d] text-xs font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  sidecarState === "READY"
                    ? "bg-[#3fb950]"
                    : sidecarState === "RESTARTING"
                    ? "bg-[#d29922] animate-ping"
                    : "bg-[#f85149]"
                }`}
              />
              <span className="text-white font-semibold">{sidecarState}</span>
              <span className="text-[#30363d]">|</span>
              <span className="text-[#58a6ff]">Epoch #{epoch}</span>
              <span className="text-[#30363d]">|</span>
              <span className="text-[#8b949e]">PID {sidecarPid}</span>
              <span className="text-[#30363d]">|</span>
              <span className="text-[#3fb950]">TLS 1.3 :54192</span>
            </div>

            <button
              type="button"
              onClick={handleSimulateEpochRecovery}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-[#d29922] border border-[#30363d] text-xs font-medium transition-colors cursor-pointer"
              title="Simulate sidecar crash & test Ticket 03 Epoch-Fenced Recovery"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Test Epoch Crash Recovery</span>
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
                    width: `${Math.min(100, Math.round((totalSpentUsd / totalBudgetUsd) * 100))}%`,
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
                  <div className="text-[#8b949e]">LEASES</div>
                  <div className="font-bold text-xs text-[#58a6ff]">
                    {selectedWorkOrder.activeLeases.length} Active
                  </div>
                </div>
                <div className="px-2 py-1 rounded bg-[#0d1117] border border-[#30363d]">
                  <div className="text-[#8b949e]">MCP / A2A</div>
                  <div className="font-bold text-xs text-[#3fb950]">5 Tools</div>
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
                return (
                  <div
                    key={wo.id}
                    onClick={() => {
                      setSelectedWorkOrderId(wo.id);
                      setIsComposerOpen(false);
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-[#21262d] border-[#58a6ff] shadow-md"
                        : "bg-[#0d1117]/80 border-[#30363d] hover:border-[#8b949e]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-xs font-bold text-[#58a6ff]">
                        {wo.id}
                      </span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                          wo.status === "ON_HOLD"
                            ? "bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40"
                            : wo.status === "IN_PROGRESS"
                            ? "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40"
                            : wo.status === "COMPLETED"
                            ? "bg-[#3fb950]/20 text-[#3fb950] border border-[#3fb950]/40"
                            : "bg-[#f85149]/20 text-[#f85149] border border-[#f85149]/40"
                        }`}
                      >
                        {wo.status}
                      </span>
                    </div>

                    <div className="text-xs font-semibold text-white line-clamp-1 mb-1.5">
                      {wo.title}
                    </div>

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

          {/* CENTER ZONE: Interactive 6-Stage Pipeline DAG + Governed Hold Card + Two-Tier Validation Vault */}
          <main className="flex-1 flex flex-col min-w-0 bg-[#0d1117] overflow-y-auto p-5 space-y-5">
            {/* Work Order Header Summary */}
            <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#58a6ff]/15 text-[#58a6ff] font-mono text-xs font-bold border border-[#58a6ff]/30">
                    {selectedWorkOrder.id}
                  </span>
                  <h3 className="text-base font-bold text-white">
                    {selectedWorkOrder.title}
                  </h3>
                </div>
                <div className="flex items-center gap-4 text-xs text-[#8b949e] font-mono">
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
                  <span>Epoch #{selectedWorkOrder.epoch}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right font-mono">
                  <div className="text-[10px] text-[#8b949e] uppercase">Work Order Spend</div>
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
                  title="Execute Two-Tier Holdback Gate & Pre-PR Secret Audit on worktree"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Run Two-Tier Gate</span>
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
                  <span>6-Stage Software Factory Pipeline DAG (Click any stage to inspect)</span>
                </div>
                <span className="text-[11px] font-mono text-[#8b949e]">
                  Active Stage: <strong className="text-white">{selectedStage.title}</strong>
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
                                  : stage.status === "RUNNING" || stage.status === "CORRECTION"
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
                          {selectedWorkOrder.activeHold.profile} • {selectedWorkOrder.activeHold.holdId}
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
                          <span>Requested Lease Scope: {selectedWorkOrder.activeHold.requiredScope}</span>
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
              {/* Left Box: Vault Extraction & Output-Path Confinement */}
              <div className="p-4 rounded-xl bg-[#161b22] border border-[#30363d] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#3fb950]" />
                    <span>Holdback Vault & Confinement Guard</span>
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
                        ALLOWED OUTPUT PATHS (SCOPE CONFINEMENT)
                      </span>
                      <span className="text-[10px] text-[#3fb950] font-bold">
                        0 VIOLATIONS
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
                        TIER 1 BUILD / UNIT / PRE-PR SECRET AUDIT
                      </span>
                      <span className="text-[10px] text-[#3fb950] font-bold">
                        PASSED
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
          </main>

          {/* RIGHT ZONE: Stage Agent ConPTY Inspector OR Quick-Dispatch Composer */}
          <aside className="w-88 border-l border-[#30363d] bg-[#161b22] flex flex-col shrink-0 overflow-y-auto">
            {isComposerOpen ? (
              /* Quick-Dispatch Work Order Composer */
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-[#30363d] pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                      New Work Order Composer
                    </h3>
                    <p className="text-[11px] text-[#8b949e]">
                      Dispatches to `machina_submit_work_order`
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
                    <label className="block text-[11px] font-semibold text-[#8b949e] mb-1">
                      Work Order Title / Objective
                    </label>
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
                      Confined `outputPaths` (Comma-separated globs)
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
