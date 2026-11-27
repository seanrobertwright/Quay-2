// The text quay_surface_guide returns. `pnpm surface:guide` writes it to where Rust builds it in, and
// `pnpm build` does so before anything else.
import { catalog } from "../catalog.ts";
import { callJson, COPY, EXAMPLES } from "./examples.ts";
import { CALL, ERRORS, NOTES, OPENING, SHAPE, SURFACE, TYPES, UPDATES } from "./rules.ts";
import { componentLines, functionLines } from "./signatures.ts";

const section = (heading: string, ...parts: string[]): string => [`## ${heading}`, ...parts].join("\n\n");

const fenced = (json: string): string => `\`\`\`json\n${json}\n\`\`\``;

/** The whole guide. A call to copy comes first, so that a model reads its shape before the rules and the catalog. */
export const guide = (): string =>
  [
    "# Raw surfaces",
    OPENING,
    section("A call to copy", fenced(callJson(COPY)), SHAPE),
    section("The call", CALL),
    section("A surface", SURFACE),
    section("Updates and deletes", UPDATES),
    section("Errors", ERRORS),
    section("Types", TYPES),
    section("Components", componentLines(catalog).join("\n")),
    section("Functions", functionLines(catalog).join("\n")),
    section("What Quay does with them", NOTES),
    section("Examples", ...EXAMPLES.map(({ heading, call }) => `${heading}\n\n${fenced(callJson(call))}`)),
  ].join("\n\n") + "\n";
