import { describe, expect, test } from "vitest";
import { run } from "../src/cli/index.js";

const GROCERIES = "# Saturday shop\n2 x Apples @ 0.40\n1 x Bread @ 2.25\n3 x Milk @ 1.10\n";

/** Runs receipt against an in-memory file system and collects what it prints. */
function receipt(argv: string[], files: Record<string, string> = { "list.txt": GROCERIES }) {
  const printed: string[] = [];
  const exitCode = run(argv, {
    readFile: (path: string) => {
      if (!Object.hasOwn(files, path)) throw new Error("no such file");
      return files[path];
    },
    out: (line: string) => printed.push(line),
  });
  return { exitCode, output: printed.join("\n") };
}

describe("run", () => {
  test("prints the receipt for a shopping-list file", () => {
    const { exitCode, output } = receipt(["list.txt"]);
    expect(exitCode).toBe(0);
    expect(output).toContain("2 x Apples @ 0.40");
    expect(output.split("\n").at(-1)).toMatch(/^TOTAL +6\.35$/);
  });

  test("prints only the TOTAL line with --total", () => {
    const { exitCode, output } = receipt(["list.txt", "--total"]);
    expect(exitCode).toBe(0);
    expect(output).toMatch(/^TOTAL +6\.35$/);
  });

  test("prints the usage and exits 2 without a file", () => {
    const { exitCode, output } = receipt([]);
    expect(exitCode).toBe(2);
    expect(output).toContain("Usage:");
  });
});
