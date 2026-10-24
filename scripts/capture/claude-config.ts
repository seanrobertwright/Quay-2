// The fixture Claude config a capture hands Quay as CLAUDE_CONFIG_DIR: transcripts cut down to the
// token counts Quay prices the spend figure from. README.md beside this file says how it is made.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseUtcTimestamp } from '../../src/lib/dates.ts';

type Json = Record<string, unknown>;

/** The usage counters Quay reads from a response, as `src-tauri/src/slices/sessions/usage.rs` does. */
const USAGE_COUNTS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;
const CACHE_CREATION_COUNTS = ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'] as const;

/** Claude Code's folder for a project's transcripts: the path with every character but a letter or digit made `-`. */
export function claudeProjectFolder(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-');
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** Copies the named counts that are there from `from` into a new object. */
function counts(from: Json, names: readonly string[]): Json {
  return Object.fromEntries(names.filter((name) => Object.hasOwn(from, name) && isCount(from[name])).map((name) => [name, from[name]]));
}

/**
 * Scrubs one transcript: keeps each assistant response with usage timestamped within the run,
 * from `run.start` to `run.end` inclusive (milliseconds since the epoch), cut down to its type,
 * request id, session id, timestamp, message id, model, token counts and, for a response Claude
 * Code ran in fast mode, `speed: "fast"`, which Quay prices higher. Everything a person or an agent
 * wrote is left out. Returns the kept lines, each ending in a newline, or an empty string when none
 * is kept.
 */
export function scrubTranscript(text: string, run: { start: number; end: number }): string {
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(entry) || entry.type !== 'assistant' || !isObject(entry.message) || !isObject(entry.message.usage)) continue;
    const { message } = entry;
    const usage = message.usage as Json;
    const at = typeof entry.timestamp === 'string' ? parseUtcTimestamp(entry.timestamp) : null;
    if (at === null || at < run.start || at > run.end || typeof message.id !== 'string' || typeof message.model !== 'string') continue;
    const scrubbed: Json = counts(usage, USAGE_COUNTS);
    if (isObject(usage.cache_creation)) scrubbed.cache_creation = counts(usage.cache_creation, CACHE_CREATION_COUNTS);
    if (usage.speed === 'fast') scrubbed.speed = 'fast';
    kept.push(
      JSON.stringify({
        type: 'assistant',
        ...(typeof entry.requestId === 'string' ? { requestId: entry.requestId } : {}),
        ...(typeof entry.sessionId === 'string' ? { sessionId: entry.sessionId } : {}),
        timestamp: entry.timestamp,
        message: { id: message.id, model: message.model, usage: scrubbed },
      }),
    );
  }
  return kept.map((line) => `${line}\n`).join('');
}

/** Whether a value holds only the given keys, each passing its check. */
function only(value: unknown, checks: Record<string, (field: unknown) => boolean>): boolean {
  return isObject(value) && Object.keys(value).every((key) => Object.hasOwn(checks, key) && checks[key](value[key]));
}

const isText = (value: unknown) => typeof value === 'string';
const COUNT_CHECKS = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, isCount]));

/** Whether one transcript line has the shape `scrubTranscript` writes, and nothing more. */
function isScrubbedLine(line: string): boolean {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return false;
  }
  const usage = (value: unknown) =>
    only(value, {
      ...COUNT_CHECKS(USAGE_COUNTS),
      cache_creation: (field) => only(field, COUNT_CHECKS(CACHE_CREATION_COUNTS)),
      speed: (field) => field === 'fast',
    });
  return only(entry, {
    type: (field) => field === 'assistant',
    requestId: isText,
    sessionId: isText,
    timestamp: (field) => typeof field === 'string' && parseUtcTimestamp(field) !== null,
    message: (field) => only(field, { id: isText, model: isText, usage }),
  });
}

/**
 * What keeps a fixture Claude config from being committed or handed to Quay: every file in it
 * must be a transcript under `projects/`, and every line in one the shape `scrubTranscript`
 * writes. `files` maps each file's path in the config, with `/`, to its text. Returns one
 * problem per file, naming it; empty when the config is clean.
 */
export function claudeConfigProblems(files: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [path, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^projects\/[^/]+\/.+\.jsonl$/.test(path)) {
      problems.push(`${path} is not a transcript under projects/; a fixture Claude config holds nothing else`);
      continue;
    }
    const bad = text.split('\n').findIndex((line, i, lines) => !(line === '' && i === lines.length - 1) && !isScrubbedLine(line));
    if (bad !== -1) problems.push(`${path} line ${bad + 1} holds more than a scrubbed response's token counts`);
  }
  return problems;
}

/** Every file in a Claude config folder, by its path in the folder with `/`, with its text. */
export function readClaudeConfig(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(dir, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
  }
  return files;
}
