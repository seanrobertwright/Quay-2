// Check on host for the template form (#596): the host's authoring preview of the draft, asked
// for only when the button is pressed. The form is mounted for one template of one project, so
// leaving either unmounts it, which cancels the check in flight and drops its answer.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Json } from "./model.ts";
import { createPreviewChecks, type PreviewChecksState } from "./templatePreview.ts";

export interface TemplatePreviewState extends PreviewChecksState {
  /** Asks the host about `content`, the draft as the form holds it. */
  check: (content: Json) => void;
}

/** The checks of the template a form shows, on `projectPath`'s host. */
export function useTemplatePreview(projectPath: string): TemplatePreviewState {
  const [checks] = useState(() => createPreviewChecks());
  useEffect(() => () => checks.drop(), [checks]);
  const state = useSyncExternalStore(checks.subscribe, checks.current);
  const check = useCallback((content: Json) => checks.check(projectPath, content), [checks, projectPath]);
  return { ...state, check };
}
