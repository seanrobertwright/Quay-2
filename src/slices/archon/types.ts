export interface ArchonServiceStatus {
  running: boolean;
  port: number;
  version?: string | null;
  binary_path?: string | null;
  message: string;
}

export interface ArchonPlanNode {
  id: string;
  depends_on?: string[];
  kind?: string;
  provider?: string;
  model?: string;
  skills?: string[];
  when?: string;
  reason?: string;
  script?: string;
  description?: string;
}

export interface ArchonPlan {
  nodes: ArchonPlanNode[];
  layers?: ArchonPlanNode[][];
  sinks?: string[];
}

export interface ArchonWorkflow {
  id: string;
  name: string;
  description?: string | null;
  plan?: ArchonPlan | null;
  inputs?: any;
  returns?: string | null;
  source?: string | null;
  provider?: string | null;
  model?: string | null;
}

export interface ArchonRun {
  id: string;
  workflow_name: string;
  user_message?: string | null;
  status: string;
  outcome?: string | null;
  working_path?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  total_cost_usd?: number | null;
  codebase_name?: string | null;
  current_step_name?: string | null;
  active_nodes?: string[] | null;
  nodes_completed?: number | null;
  nodes_total?: number | null;
  /** started_at as epoch ms (UTC), parsed on the Rust side. */
  started_ms?: number | null;
  completed_ms?: number | null;
  /** Conversation that holds the run's chat messages. */
  conversation_platform_id?: string | null;
}

export type ArchonNodeRunState = "running" | "completed" | "failed" | "skipped" | "cancelled";

export interface ArchonNodeState {
  /** Plan node id; loop children are `group.child`. */
  node_id: string;
  state: ArchonNodeRunState | string;
  started_ms?: number | null;
  duration_ms?: number | null;
  cost_usd?: number | null;
  model?: string | null;
  /** Failure message, or the skip reason. */
  detail?: string | null;
}

export type ArchonLogKind =
  | "node"
  | "tool"
  | "task"
  | "loop"
  | "approval"
  | "system"
  | "warning"
  | "error"
  | "hook"
  | "text";

export interface ArchonLogEntry {
  id: string;
  ts_ms?: number | null;
  kind: ArchonLogKind | string;
  node_id?: string | null;
  label: string;
  detail?: string | null;
  status?: "running" | "ok" | "failed" | "skipped" | null;
  duration_ms?: number | null;
}

export interface ArchonChatMessage {
  id: string;
  role: string;
  content: string;
  ts_ms?: number | null;
  category?: string | null;
}

export interface ArchonPendingApproval {
  prompt: string;
  node_id?: string | null;
  requested_ms?: number | null;
}

export interface ArchonRunDetail {
  run: ArchonRun;
  last_activity_ms?: number | null;
  error?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  nodes: ArchonNodeState[];
  active_nodes: string[];
  /** Oldest first; only the most recent entries. */
  logs: ArchonLogEntry[];
  total_events: number;
  hidden_hook_events: number;
  logs_truncated: boolean;
  /** Oldest first. */
  messages: ArchonChatMessage[];
  pending_approval?: ArchonPendingApproval | null;
  fetched_at_ms: number;
}

export type ArchonRunAction = "cancel" | "resume" | "abandon" | "approve" | "reject";

export interface SpecTask {
  id: string;
  title: string;
  completed: boolean;
  line_number: number;
  section: string;
  file_name: string;
}

export interface AdrItem {
  id: string;
  number: string;
  title: string;
  status: string;
  file_path: string;
  summary?: string | null;
  date?: string | null;
}

export interface RepoSpecSummary {
  project_path: string;
  tasks: SpecTask[];
  adrs: AdrItem[];
  spec_files_found: string[];
}
