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
  working_path?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  total_cost_usd?: number | null;
  codebase_name?: string | null;
  current_step_name?: string | null;
}

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
