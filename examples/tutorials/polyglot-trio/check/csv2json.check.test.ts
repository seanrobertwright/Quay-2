// The check suite for Swarm 9: Polyglot Trio. None of the agents saw these tests or their
// fixtures. Each runs the finished CLI on one fixture and compares its stdout, stderr and
// exit code with what SPEC.md's rules say.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Runs the CLI from the project folder, as `node src/cli.ts check/fixtures/<fixture>`. */
function convert(fixture: string) {
  return spawnSync(process.execPath, ["src/cli.ts", `check/fixtures/${fixture}`], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
}

/** The JSON SPEC.md rule 8 asks for: indented two spaces, then one line break. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe("csv2json check suite", () => {
  it("rule 2: reads LF line endings with no line break at the end of the file", () => {
    const run = convert("lf-no-final-break.csv");
    expect(run.stdout).toBe(json([{ name: "Ada", city: "London" }, { name: "Grace", city: "Arlington" }]));
    expect(run.status).toBe(0);
  });

  it('rules 3 and 4: reads a quoted "" and an unquoted empty field as the empty string', () => {
    const run = convert("empty-fields.csv");
    expect(run.stdout).toBe(json([{ a: "", b: "", c: "x" }]));
    expect(run.status).toBe(0);
  });

  it("rule 5: drops the byte order mark before the header", () => {
    const run = convert("bom.csv");
    expect(run.stdout).toBe(json([{ id: "1", name: "Ada" }]));
    expect(run.status).toBe(0);
  });

  it("rule 6: keeps values that look like numbers and booleans as strings", () => {
    const run = convert("strings.csv");
    expect(run.stdout).toBe(json([{ sku: "A-1", price: "4.50", in_stock: "true", count: "007" }]));
    expect(run.status).toBe(0);
  });

  it("rule 7: reports a ragged record by the line it starts on, after a quoted line break", () => {
    const run = convert("ragged.csv");
    expect(run.stderr.trimEnd()).toBe("Line 4: expected 2 fields, got 3");
    expect(run.stdout).toBe("");
    expect(run.status).toBe(1);
  });

  it("rule 1: prints the usage line and exits 2 for a file that doesn't exist", () => {
    const run = convert("no-such-file.csv");
    expect(run.stderr.trimEnd()).toBe("Usage: node src/cli.ts <file.csv>");
    expect(run.stdout).toBe("");
    expect(run.status).toBe(2);
  });
});
