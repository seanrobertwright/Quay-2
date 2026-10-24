import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Runs the CLI from the project folder, as `node src/cli.ts <args>`. */
function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["src/cli.ts", ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
}

describe("csv2json", () => {
  it("prints the usage line and exits 2 when no file is given", () => {
    const run = runCli();
    expect(run.stderr.trimEnd()).toBe("Usage: node src/cli.ts <file.csv>");
    expect(run.stdout).toBe("");
    expect(run.status).toBe(2);
  });

  it.todo("rule 1: prints the usage line and exits 2 when the file can't be read");
  it.todo("rule 2: ends records at CRLF or LF, with no empty record after a final line break");
  it.todo("rule 3: splits fields at commas, keeps spaces around a field, and reads an empty field as the empty string");
  it.todo('rule 4: reads a quoted field holding commas, line breaks and "" as one value');
  it.todo("rule 5: drops a byte order mark at the start of the file");
  it.todo("rule 6: makes each record after the header an object of strings, keyed by the header fields in order");
  it.todo("rule 7: reports a ragged record with the line it starts on, prints nothing to stdout and exits 1");
  it.todo("rule 8: prints a JSON array indented two spaces, then one line break, and exits 0");
});
