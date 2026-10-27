import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const project = fileURLToPath(new URL("..", import.meta.url));

/** Runs the CLI from the project folder, the way SPEC.md runs it. */
function cli(...args: string[]) {
  const run = spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: project, encoding: "utf8" });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
}

describe("link checker", () => {
  it("prints the usage line and exits 2 with no argument", () => {
    const run = cli();
    expect(run.stderr.trim()).toBe("Usage: node src/cli.ts <folder>");
    expect(run.status).toBe(2);
  });

  it.todo("Usage: prints the usage line and exits 2 for a path that isn't a folder");
  it.todo("Files: checks every .md file under the folder, in every subfolder");
  it.todo("Links: finds inline links and images, and skips reference-style links, autolinks, bare URLs and fenced code blocks");
  it.todo("External: counts http://, https:// and mailto: links and never reports them broken");
  it.todo("Relative: reports a link to a file that doesn't exist as (missing file)");
  it.todo("Anchors: reports an anchor that matches no heading's slug, in the same file or another, as (missing anchor)");
  it.todo("Report: prints one line per broken link, sorted by path then line, then the summary line");
  it.todo("Exit: exits 0 when nothing is broken and 1 when something is");
});
