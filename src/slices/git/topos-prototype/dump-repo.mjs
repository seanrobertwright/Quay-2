// PROTOTYPE (#351). Dumps a real repo's history for the prototype page:
//   pnpm proto:topos:dump <repo-path> [name]
// Writes data/<name>.json and lists it in data/index.json. Uses the same
// git invocation the #350 findings settled on, in --date-order.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [repoArg, nameArg] = process.argv.slice(2);
if (!repoArg) {
  console.error("usage: pnpm proto:topos:dump <repo-path> [name]");
  process.exit(2);
}
const repo = resolve(repoArg);
const name = nameArg ?? basename(repo);
if (!/^[\w.-]+$/.test(name)) {
  console.error(`name must match [A-Za-z0-9_.-]+: ${name}`);
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", ["-C", repo, "--no-optional-locks", ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
  });

const log = git("log", "--no-color", "--no-show-signature", "--date-order", "-z",
  "--format=%H%x00%P%x00%aN%x00%ct%x00%s", "--branches", "--remotes", "--tags", "HEAD");
const fields = log.split("\0");
const commits = [];
for (let i = 0; i + 4 < fields.length; i += 5) {
  // -z ends each record with NUL, and git puts a newline before the next record's first field.
  commits.push([fields[i].replace(/^\n/, ""), fields[i + 1], fields[i + 2], Number(fields[i + 3]), fields[i + 4]]);
}

const refs = git("for-each-ref", "--format=%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)",
  "refs/heads", "refs/remotes", "refs/tags")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [oid, peeled, refname, head] = line.split("\0");
    return [peeled || oid, refname, head === "*" ? 1 : 0];
  });

let defaultBranch = "main";
try {
  defaultBranch = git("symbolic-ref", "--short", "refs/remotes/origin/HEAD").trim().replace(/^origin\//, "");
} catch {
  if (refs.some(([, r]) => r === "refs/heads/master")) defaultBranch = "master";
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "data", `${name}.json`);
writeFileSync(out, JSON.stringify({ defaultBranch, commits, refs }));
const indexPath = join(here, "data", "index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
if (!index.includes(name)) index.push(name);
writeFileSync(indexPath, JSON.stringify(index));
console.log(`${commits.length} commits, ${refs.length} refs, default branch ${defaultBranch} -> ${out}`);
