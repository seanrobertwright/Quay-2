// How Quay shortens an Archon workflow's name for a label or a terminal name.

/** The workflow's name without its owner: "owner/lril-sdlc:implement" -> "lril-sdlc:implement". */
export const shortWorkflowName = (name: string): string => name.split("/").pop() || name;

/** The name of a terminal that runs the workflow: "owner/lril-sdlc:implement" -> "archon-implement". */
export const workflowTerminalName = (name: string): string =>
  `archon-${name.split("/").pop()?.split(":").pop() || "run"}`;
