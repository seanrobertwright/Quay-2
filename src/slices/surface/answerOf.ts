// What an operator's action is to the agent that asked.
import { RAW_TOOL } from "./rawTool.ts";
import type { SentAction } from "./surfaceTypes.ts";
import { typedTool } from "./typed/index.ts";

/** The result `tool`'s call gets for `action`, or null when Quay has none for that tool's surfaces: a raw one's is the A2UI message itself. */
export const answerOf = (tool: string, action: SentAction): unknown => (tool === RAW_TOOL ? action.message : (typedTool(tool)?.collapse?.(action) ?? null));
