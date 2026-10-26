// Vendors the AI-WS-SDK Rust crate and its shared fixtures into src-tauri/vendor/aiws at one
// commit, reading from git objects so uncommitted changes in the checkout never leak in.
// With --check, writes nothing and fails when the copy no longer matches its SOURCE record.
//
//   node scripts/aiws-sdk/sync.ts --from <AI-WS-SDK checkout> --commit <commit>
//   node scripts/aiws-sdk/sync.ts --check
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatSource,
  type Source,
  parseSource,
  SOURCE_FILE,
  sourceFor,
  sourceMismatches,
  VENDOR_DIR,
  VENDORED_PATHS,
} from './vendor.ts';

const USAGE =
  'Usage: node scripts/aiws-sdk/sync.ts --from <AI-WS-SDK checkout> --commit <commit>\n' +
  '       node scripts/aiws-sdk/sync.ts --check';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const vendorDir = join(repoRoot, VENDOR_DIR);

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv: string[]): { check: true } | { check: false; from: string; commit: string } {
  if (argv.length === 1 && argv[0] === '--check') return { check: true };
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== '--from' && flag !== '--commit') || value === undefined || value.startsWith('--')) {
      fail(USAGE, 2);
    }
    if (values.has(flag)) fail(`${flag} was given twice.\n${USAGE}`, 2);
    values.set(flag, value);
  }
  const from = values.get('--from');
  const commit = values.get('--commit');
  if (!from || !commit) fail(USAGE, 2);
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) fail(`--commit must be a commit id in hex, not ${JSON.stringify(commit)}.`, 2);
  return { check: false, from, commit };
}

/** Every file under `dir`, keyed by its path relative to `dir` with forward slashes. */
async function readTree(dir: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(dir, path).split(sep).join('/'), await readFile(path));
  }
  return files;
}

async function check(): Promise<void> {
  let sourceText: string;
  try {
    sourceText = await readFile(join(vendorDir, SOURCE_FILE), 'utf8');
  } catch {
    fail(`${VENDOR_DIR}/${SOURCE_FILE} is missing. Run the sync to vendor the SDK.`);
  }
  let recorded: Source;
  try {
    recorded = parseSource(sourceText);
  } catch (error) {
    fail(`${VENDOR_DIR}/${SOURCE_FILE} can't be read: ${(error as Error).message}`);
  }
  const files = await readTree(vendorDir);
  files.delete(SOURCE_FILE);
  const problems = sourceMismatches(recorded, sourceFor(recorded.commit, files));
  if (problems.length > 0) {
    fail(
      `${VENDOR_DIR} differs from the sync at ${recorded.commit}: a file was edited, added or removed by hand.\n` +
        problems.map((p) => `  ${p}`).join('\n') +
        '\nRestore it, or run the sync again at the commit you want.'
    );
  }
  console.log(`${VENDOR_DIR} matches AI-WS-SDK ${recorded.commit}.`);
}

const git = (from: string, args: string[]) =>
  execFileSync('git', ['-C', from, ...args], { maxBuffer: 64 * 1024 * 1024 });

async function sync(from: string, commitArg: string): Promise<void> {
  const commit = git(from, ['rev-parse', '--verify', `${commitArg}^{commit}`]).toString().trim();
  const listed = git(from, ['ls-tree', '-r', '-z', '--name-only', commit, '--', ...VENDORED_PATHS])
    .toString()
    .split('\0')
    .filter(Boolean);
  for (const path of VENDORED_PATHS) {
    if (!listed.some((p) => p === path || p.startsWith(`${path}/`))) fail(`${path} doesn't exist at ${commit}.`);
  }

  const files = new Map<string, Uint8Array>();
  for (const path of listed) files.set(path, git(from, ['show', `${commit}:${path}`]));

  // Write the new copy beside the old one and swap it in, so a failed write never leaves a
  // half-vendored crate that Cargo can't build.
  const staging = `${vendorDir}.sync-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  try {
    for (const [path, body] of files) {
      const target = join(staging, ...path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    }
    await writeFile(join(staging, SOURCE_FILE), formatSource(sourceFor(commit, files)));
    await rm(vendorDir, { recursive: true, force: true });
    await rename(staging, vendorDir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  console.log(
    `Vendored ${files.size} files from AI-WS-SDK ${commit} into ${VENDOR_DIR}.\n` +
      'CI doesn\'t run the Rust tests, so run `cargo test --lib praxis` in src-tauri now: it checks the\n' +
      'validator against the SDK\'s graph vectors at this commit.'
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.check) await check();
else await sync(args.from, args.commit);
