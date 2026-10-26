// Validates a definition's file content with the backend's `praxis_validate` (#220). The
// frontend never validates on its own.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ValidationStatus } from "./ProblemsPanel.tsx";
import type { PraxisKind, Validation } from "./types.ts";

/** The result and the content it is for, so a result for older content is never shown. */
type Checked = { content: unknown } & ({ validation: Validation } | { error: string });

/** The validation of `content`, rerun whenever the content changes. */
export function useValidation(kind: PraxisKind, content: unknown): ValidationStatus {
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    let stale = false;
    invoke<Validation>("praxis_validate", { kind, content }).then(
      (validation) => {
        if (!stale) setChecked({ content, validation });
      },
      (e) => {
        if (!stale) setChecked({ content, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [kind, content]);

  if (!checked || checked.content !== content) return { state: "checking" };
  return "error" in checked ? { state: "failed", error: checked.error } : { state: "done", validation: checked.validation };
}
