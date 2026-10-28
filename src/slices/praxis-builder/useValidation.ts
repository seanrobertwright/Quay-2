// Validates a definition's file content with the backend's `praxis_validate` (#220). The
// frontend never validates on its own.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PraxisKind, Validation, ValidationStatus } from "./types.ts";

/** The result and the content and graph it is for, so a result for older input is never shown. */
type Checked = { content: unknown; graph: unknown } & ({ validation: Validation } | { error: string });

/**
 * The validation of `content`, with `graph` as its graph's draft for a graph binding (#273),
 * rerun whenever either changes. A null `content` is nothing to check: it stays `checking`.
 */
export function useValidation(kind: PraxisKind, content: unknown, graph?: unknown): ValidationStatus {
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    if (content === null) return;
    let stale = false;
    invoke<Validation>("praxis_validate", { kind, content, ...(graph !== undefined && { graph }) }).then(
      (validation) => {
        if (!stale) setChecked({ content, graph, validation });
      },
      (e) => {
        if (!stale) setChecked({ content, graph, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [kind, content, graph]);

  if (!checked || checked.content !== content || checked.graph !== graph) return { state: "checking" };
  return "error" in checked ? { state: "failed", error: checked.error } : { state: "done", validation: checked.validation };
}
