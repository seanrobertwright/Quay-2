// How a component or function names a file: a `path`, and a `line` of it.
import { DynamicNumberSchema, DynamicStringSchema } from "@a2ui/web_core/v1_0";

export const FILE_FIELDS = {
  path: DynamicStringSchema.describe("REF:#/$defs/DynamicString|The file, absolute or relative to the terminal's working directory."),
  line: DynamicNumberSchema.describe("REF:#/$defs/DynamicNumber|A line of the file.").optional(),
};

interface NamedFile {
  /** Empty when no path is named. */
  path: string;
  line: number | undefined;
}

/** The file that `path` and `line` name, once they are evaluated. */
export const namedFile = ({ path, line }: { path?: unknown; line?: unknown }): NamedFile => ({
  path: typeof path === "string" ? path : "",
  line: typeof line === "number" && Number.isInteger(line) && line > 0 && line <= 0xffffffff ? line : undefined,
});
