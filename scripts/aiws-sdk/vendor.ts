// What scripts/aiws-sdk/sync.ts vendors from AI-WS-SDK, and the SOURCE record that pins it.
// Quay validates Praxis definitions with the SDK's own Rust crate (#220). The SDK repository is
// private and has no tags, so Quay keeps a verbatim copy at a recorded commit instead of a git
// dependency, and the SOURCE digests catch a hand edit to the copy.
import { createHash } from 'node:crypto';

/**
 * The paths copied from the SDK, as upstream names them. Their layout is kept under VENDOR_DIR.
 * The crate's paths are the ones its Cargo.toml `include` packages, so its agent docs stay out.
 * The coding-plan schema and its vectors check workflow templates (#224).
 */
export const VENDORED_PATHS = [
  'crates/aiws/Cargo.toml',
  'crates/aiws/README.md',
  'crates/aiws/src',
  'crates/aiws/tests',
  'crates/aiws/examples',
  'spec/fixtures.json',
  'spec/engine-v1/coding-plan.schema.json',
  'spec/engine-v1/coding-plan.fixtures.json',
] as const;

/** The vendored copy, relative to the repository root. */
export const VENDOR_DIR = 'src-tauri/vendor/aiws';

/** The bundled schema the SDK validates records against, relative to VENDOR_DIR. */
export const SCHEMA_PATH = 'crates/aiws/src/schema.json';

export const SOURCE_FILE = 'SOURCE';

export interface Source {
  /** The full upstream commit the copy was taken from. */
  commit: string;
  /** SHA-256 of SCHEMA_PATH's bytes. */
  schemaSha256: string;
  /** treeDigest of every vendored file. */
  treeSha256: string;
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * One digest over a set of files: SHA-256 of a line `<sha256 of the file> <path>` per file,
 * sorted by path. Paths use forward slashes.
 */
export function treeDigest(files: ReadonlyMap<string, Uint8Array>): string {
  const lines = [...files.keys()]
    .sort()
    .map((path) => `${sha256(files.get(path)!)} ${path}\n`)
    .join('');
  return sha256(lines);
}

export function formatSource(source: Source): string {
  return [
    '# Vendored from seanrobertwright/AI-WS-SDK by scripts/aiws-sdk/sync.ts.',
    '# Never edit the copy by hand; run the sync again at a new commit.',
    `commit: ${source.commit}`,
    `schema-sha256: ${source.schemaSha256}`,
    `tree-sha256: ${source.treeSha256}`,
    '',
  ].join('\n');
}

/** Reads a SOURCE file, refusing a missing, repeated or malformed field. */
export function parseSource(text: string): Source {
  const fields = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([a-z0-9-]+):\s*(\S+)$/.exec(line);
    if (!match) throw new Error(`SOURCE has a line that isn't "key: value": ${JSON.stringify(line)}`);
    const [, key, value] = match;
    if (fields.has(key)) throw new Error(`SOURCE names ${key} twice.`);
    fields.set(key, value);
  }
  const field = (key: string, pattern: RegExp, what: string) => {
    const value = fields.get(key);
    if (value === undefined) throw new Error(`SOURCE has no ${key}.`);
    if (!pattern.test(value)) throw new Error(`SOURCE ${key} isn't ${what}: ${value}`);
    return value;
  };
  return {
    commit: field('commit', COMMIT_PATTERN, 'a full 40-character commit id'),
    schemaSha256: field('schema-sha256', SHA256_PATTERN, 'a SHA-256 in hex'),
    treeSha256: field('tree-sha256', SHA256_PATTERN, 'a SHA-256 in hex'),
  };
}

/** The SOURCE record for a set of vendored files, keyed by path relative to VENDOR_DIR. */
export function sourceFor(commit: string, files: ReadonlyMap<string, Uint8Array>): Source {
  const schema = files.get(SCHEMA_PATH);
  if (!schema) throw new Error(`The vendored files have no ${SCHEMA_PATH}.`);
  return { commit, schemaSha256: sha256(schema), treeSha256: treeDigest(files) };
}

/** What differs between a recorded SOURCE and the files on disk, or [] when they agree. */
export function sourceMismatches(recorded: Source, actual: Source): string[] {
  const problems: string[] = [];
  if (recorded.schemaSha256 !== actual.schemaSha256) {
    problems.push(`${SCHEMA_PATH} doesn't match the schema-sha256 in SOURCE.`);
  }
  if (recorded.treeSha256 !== actual.treeSha256) {
    problems.push('The vendored files don\'t match the tree-sha256 in SOURCE.');
  }
  return problems;
}
