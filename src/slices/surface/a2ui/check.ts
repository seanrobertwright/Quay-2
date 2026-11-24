// The check Rust asks for before it commits a call: run on a scratch engine, applied nowhere.
import type { CheckRequest, Verdict } from "../surfaceTypes.ts";
import { RAW_TOOL } from "../rawTool.ts";
import { typedTool } from "../typed/index.ts";
import { acceptedVerdict, compact } from "./accepted.ts";
import { CATALOG_ID } from "./catalog.ts";
import { engineError, engineFor } from "./engine.ts";
import { checkRaw } from "./raw/checkRaw.ts";

/** The verdict on a call. Whatever is wrong with it is in the verdict, so a check always has one. */
export function check({ tool, surface_id, arguments: args }: CheckRequest): Verdict {
  try {
    if (tool === RAW_TOOL) return checkRaw(args, surface_id);
    const typed = typedTool(tool);
    if (!typed) throw new Error(`Quay has no tool "${tool}".`);
    const { version, createSurface } = typed.expand(args, surface_id);
    const scratch = engineFor({ version, createSurface: { ...createSurface, catalogId: CATALOG_ID } });
    try {
      return acceptedVerdict(scratch.surface, compact(scratch.surface));
    } finally {
      scratch.dispose();
    }
  } catch (error) {
    return { errors: [engineError(error, surface_id)] };
  }
}
