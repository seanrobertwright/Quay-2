export interface AuditViolation {
  severity: "blocker" | "warning" | "info";
  category: "leak_user_path" | "leak_secret" | "untracked_artifact" | "file_size";
  file_path: string;
  line_number?: number | null;
  message: string;
  snippet?: string | null;
}

export interface AuditReport {
  passed: boolean;
  blocker_count: usize;
  warning_count: usize;
  info_count: usize;
  files_scanned: usize;
  violations: AuditViolation[];
  generated_at: string;
}

type usize = number;
