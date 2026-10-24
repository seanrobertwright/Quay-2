// Writes a tutorial's fixture Claude config from the Claude config its test run used: the
// transcripts of the recorded run, scrubbed down to their token counts. README.md beside this
// file says when to run it.
//
//   pnpm docs:claude-config <slug> --from <Claude config folder>
//
// Exits 0 when the config is written, 1 when it can't be, and 2 on a bad argument.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { TUTORIALS } from '../../docs/.vitepress/tutorials.ts';
import { capturePaths, parseCaptureManifest, readRecordings } from './capture.ts';
import { claudeConfigProblems, claudeProjectFolder, readClaudeConfig, scrubTranscript } from './claude-config.ts';

const root = join(import.meta.dirname, '..', '..');
const USAGE = 'usage: pnpm docs:claude-config <slug> --from <Claude config folder>';

function parse() {
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { from: { type: 'string' } }, allowPositionals: true });
    const tutorial = TUTORIALS.find((each) => each.slug === positionals[0]);
    if (positionals.length !== 1 || tutorial === undefined) throw new Error(`name one tutorial by its slug, such as first-swarm`);
    const from = values.from?.trim() ?? '';
    if (from === '' || !existsSync(from) || !statSync(from).isDirectory()) throw new Error('--from must name the Claude config folder the test run used, such as C:\\Users\\<tester>\\.claude');
    return { tutorial, from };
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    process.exit(2);
  }
}

function main() {
  const { tutorial, from } = parse();
  const paths = capturePaths(root, tutorial);
  const recordings = readRecordings(paths.recordings);
  if (recordings.some((recording) => recording.startedAt === null || recording.endedAt === null)) {
    throw new Error('a recording does not say when it started; re-make it with the current record and replay tool');
  }
  // The recorded run's responses only: none from an earlier or a later run on the same project path.
  const run = {
    start: Math.min(...recordings.map((recording) => recording.startedAt as number)),
    end: Math.max(...recordings.map((recording) => recording.endedAt as number)),
  };
  const project = existsSync(paths.manifest)
    ? parseCaptureManifest(readFileSync(paths.manifest, 'utf8'), tutorial.slug).project
    : `C:\\tutorials\\${tutorial.slug}`;
  const folder = join('projects', claudeProjectFolder(project));
  if (!existsSync(join(from, folder))) throw new Error(`${join(from, folder)} does not exist; is ${from} the Claude config the test run used?`);

  // Scrubbed in full before the old config is replaced, so a failure leaves it as it was.
  const scrubbed = new Map<string, string>();
  for (const [path, text] of readClaudeConfig(join(from, folder))) {
    const kept = path.endsWith('.jsonl') ? scrubTranscript(text, run) : '';
    if (kept !== '') scrubbed.set(`${folder.replaceAll('\\', '/')}/${path}`, kept);
  }
  const responses = [...scrubbed.values()].reduce((all, text) => all + text.split('\n').length - 1, 0);
  if (responses === 0) throw new Error(`no transcript in ${join(from, folder)} has a response from the recorded run`);
  const problems = claudeConfigProblems(scrubbed);
  if (problems.length > 0) throw new Error(problems.join('\n'));

  rmSync(paths.claudeConfig, { recursive: true, force: true });
  for (const [path, text] of scrubbed) {
    const to = join(paths.claudeConfig, ...path.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
  console.log(`wrote ${responses} scrubbed responses to ${relative(root, paths.claudeConfig)}`);
}

try {
  main();
} catch (error) {
  console.error(`docs:claude-config: ${(error as Error).message}`);
  process.exit(1);
}
