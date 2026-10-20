// Runs scripts/pack-starters.mjs the way `docs:build` does, inside a scratch
// git repository, and reads the zips it writes back with an independent reader.
// Run with `pnpm docs:test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";

const script = join(dirname(fileURLToPath(import.meta.url)), "pack-starters.mjs");

// A scratch repository with the given files, so the script sees a git
// work tree just as it does in a real checkout.
function scratchRepo(t, files) {
  const root = mkdtempSync(join(tmpdir(), "pack-starters-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

// Reads a zip through its central directory and returns { name: content }.
// Checks every entry's CRC, so a corrupt archive fails the test.
function readZip(path) {
  const zip = readFileSync(path);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, `${path} has no end of central directory record`);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, "central directory header");
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    assert.equal(zip.readUInt32LE(localAt), 0x04034b50, `local header of ${name}`);
    const dataAt =
      localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const raw = zip.subarray(dataAt, dataAt + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    entries[name] = data.toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function pack(root) {
  return spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
}

test("with no examples folder, packing succeeds and writes no zips", (t) => {
  const root = scratchRepo(t, { "README.md": "# repo\n" });

  const run = pack(root);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(join(root, "docs/public/starters")), false);
});

test("with an examples folder that holds no starter or check folder, no zips are written", (t) => {
  const root = scratchRepo(t, {
    "examples/README.md": "# Examples\n",
    "examples/tutorials/bug-hunt/test-runs.md": "# Runs\n",
  });

  const run = pack(root);

  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(join(root, "docs/public/starters")), false);
});

test("a starter folder is packed into <slug>.zip with its files at the zip root", (t) => {
  const root = scratchRepo(t, {
    "examples/hello/starter/package.json": '{ "name": "hello" }\n',
    "examples/hello/starter/src/index.ts": "export const greeting = 'hi';\n",
    "examples/hello/starter/README.md": "# Hello\n".repeat(50),
  });

  const run = pack(root);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readZip(join(root, "docs/public/starters/hello.zip")), {
    "README.md": "# Hello\n".repeat(50),
    "package.json": '{ "name": "hello" }\n',
    "src/index.ts": "export const greeting = 'hi';\n",
  });
});

test("a check folder is packed into <slug>-check.zip, keeping its check/ folder", (t) => {
  const root = scratchRepo(t, {
    "examples/bug-hunt/starter/src/cart.ts": "export const total = 0;\n",
    "examples/bug-hunt/check/cart.test.ts": "// hidden tests\n",
  });

  const run = pack(root);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readZip(join(root, "docs/public/starters/bug-hunt.zip")), {
    "src/cart.ts": "export const total = 0;\n",
  });
  assert.deepEqual(readZip(join(root, "docs/public/starters/bug-hunt-check.zip")), {
    "check/cart.test.ts": "// hidden tests\n",
  });
});

test("ignored files never reach a zip, even when force-added to git", (t) => {
  const root = scratchRepo(t, {
    ".gitignore": "node_modules\ndist\n",
    "examples/hello/starter/.gitignore": "coverage/\n",
    "examples/hello/starter/src/index.ts": "export {};\n",
    "examples/hello/starter/node_modules/left-pad/index.js": "module.exports = 1;\n",
    "examples/hello/starter/dist/index.js": "export {};\n",
    "examples/hello/starter/coverage/lcov.info": "TN:\n",
    "examples/hello/check/dist/bundle.js": "1;\n",
    "examples/hello/check/smoke.test.ts": "// smoke\n",
  });
  const add = spawnSync("git", ["add", "-f", "examples/hello/starter/dist/index.js"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(add.status, 0, add.stderr);

  const run = pack(root);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readZip(join(root, "docs/public/starters/hello.zip")), {
    ".gitignore": "coverage/\n",
    "src/index.ts": "export {};\n",
  });
  assert.deepEqual(readZip(join(root, "docs/public/starters/hello-check.zip")), {
    "check/smoke.test.ts": "// smoke\n",
  });
});

test("a slug that is not lowercase letters, digits and hyphens fails the build", (t) => {
  const root = scratchRepo(t, {
    "examples/good-one/starter/a.txt": "a\n",
    "examples/Bug_Hunt/starter/a.txt": "a\n",
  });

  const run = pack(root);

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /"Bug_Hunt"/);
  assert.equal(existsSync(join(root, "docs/public/starters")), false);
});

test("starters grouped one level deeper, as in examples/tutorials/<slug>/, pack by slug", (t) => {
  const root = scratchRepo(t, {
    "examples/tutorials/first-swarm/starter/AGENTS.md": "# Goal\n",
    "examples/tutorials/first-swarm/test-runs.md": "# Runs\n",
    "examples/tutorials/README.md": "# Tutorials\n",
  });

  const run = pack(root);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readZip(join(root, "docs/public/starters/first-swarm.zip")), {
    "AGENTS.md": "# Goal\n",
  });
});

test("two folders that would write the same zip fail the build", (t) => {
  const root = scratchRepo(t, {
    "examples/bug-hunt/check/a.test.ts": "// a\n",
    "examples/bug-hunt-check/starter/a.txt": "a\n",
  });

  const run = pack(root);

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /bug-hunt-check\.zip/);
  assert.match(run.stderr, /examples\/bug-hunt\/check/);
  assert.match(run.stderr, /examples\/bug-hunt-check\/starter/);
});

test("zips left over from an earlier build are removed", (t) => {
  const root = scratchRepo(t, {
    "docs/public/starters/renamed-away.zip": "stale",
    "docs/public/starters/renamed-away-check.zip": "stale",
    "examples/hello/starter/a.txt": "a\n",
  });

  const run = pack(root);

  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readdirSync(join(root, "docs/public/starters")), ["hello.zip"]);
});
