// The check suite: the same rules as SPEC.md, on docs the agents never saw.
// Run it from the project folder with `npx vitest run check`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const project = fileURLToPath(new URL("..", import.meta.url));

/** Runs the CLI the way SPEC.md says, with Windows line endings turned into \n. */
function cli(...args: string[]) {
  const run = spawnSync(process.execPath, ["src/cli.ts", ...args], { cwd: project, encoding: "utf8" });
  return {
    stdout: run.stdout.replaceAll("\r\n", "\n"),
    stderr: run.stderr.replaceAll("\r\n", "\n"),
    status: run.status,
  };
}

it("reports the four broken links in check/docs-check and exits 1", () => {
  const run = cli("check/docs-check");
  expect(run.stdout).toBe(
    [
      "README.md:6: img/architecture.svg (missing file)",
      "setup/advanced/network/proxy.md:7: ../../uninstall.md#steps (missing file)",
      "setup/advanced/network/proxy.md:9: #troubleshooting (missing anchor)",
      "setup/install.md:13: advanced/network/proxy.md#https-proxy-settings (missing anchor)",
      "Checked 12 links in 3 files: 4 broken.",
      "",
    ].join("\n"),
  );
  expect(run.status).toBe(1);
});

it("reports nothing broken in check/docs-clean and exits 0", () => {
  const run = cli("check/docs-clean");
  expect(run.stdout).toBe("Checked 3 links in 2 files: 0 broken.\n");
  expect(run.status).toBe(0);
});

it("prints the usage line to stderr and exits 2 with no argument", () => {
  const run = cli();
  expect(run.stderr).toBe("Usage: node src/cli.ts <folder>\n");
  expect(run.status).toBe(2);
});
