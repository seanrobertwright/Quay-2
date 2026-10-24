// The README's definition of done. These tests read README.md, package.json and src/cli.ts;
// they never run the CLI.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const readme = read("README.md").replaceAll("\r\n", "\n");
const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const cli = read("src/cli.ts");

const SECTIONS = ["Install", "Usage", "Options", "Scripts", "License"];

/** The text under the `## <heading>` heading, up to the next `## ` heading. */
function section(heading: string): string {
  const lines = readme.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return "";
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/** Every long option `src/cli.ts` declares to parseArgs, as `--<name>`. */
const flags = [...cli.matchAll(/^\s+([a-z][a-z-]*): \{ type: "(?:boolean|string)"/gm)].map(([, name]) => `--${name}`);

describe("README.md", () => {
  test("starts with the heading # tally", () => {
    expect(readme.split("\n")[0]).toBe("# tally");
  });

  test(`has the sections ${SECTIONS.join(", ")}, in that order`, () => {
    const headings = readme.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3));
    expect(headings.filter((heading) => SECTIONS.includes(heading))).toEqual(SECTIONS);
  });

  test("documents every option src/cli.ts declares in the Options section", () => {
    expect(flags.length).toBeGreaterThan(0);
    const options = section("Options");
    expect(flags.filter((flag) => !options.includes(flag))).toEqual([]);
  });

  test("documents every package.json script in the Scripts section", () => {
    const scripts = section("Scripts");
    expect(Object.keys(packageJson.scripts).filter((name) => !scripts.includes(name))).toEqual([]);
  });

  test("holds no TODO or TBD", () => {
    expect(readme).not.toMatch(/\b(TODO|TBD)\b/);
  });

  test("names the MIT license in the License section", () => {
    expect(section("License")).toContain("MIT");
  });
});
