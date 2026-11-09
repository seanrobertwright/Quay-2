// What the recorders of the fake `praxis`'s fixtures share: graph_outputs.record.mjs (#460) and
// trigger_outputs.record.mjs (#474). Each runs the real `praxis` CLI of an AI-WS-SDK checkout
// against the simulated host its own tests start, and keeps what it printed.
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

/** The command-line operands every recorder takes, or a usage error naming `script`. */
export function recorderArgs(script) {
  const [checkout, commit, outFile] = process.argv.slice(2);
  if (!checkout || !commit || !outFile) throw new Error(`Usage: node ${script} <checkout> <commit> <out-file>`);
  return { checkout, commit, outFile, from: (path) => import(pathToFileURL(join(checkout, path)).href) };
}

/**
 * A function that runs `praxis <args> --json --state <state>` and keeps it in `cases` under a
 * name: the arguments Quay gives (without `--json` and `--state`, which the runner adds), the exit
 * code, the stdout record and the stderr. It answers the stdout record.
 */
export function caseRecorder(cases, praxis, state) {
  return async function record(name, args, run = praxis, stateDir = state) {
    const r = await run(...args, '--json', '--state', stateDir);
    const stdout = r.stdout.trim() ? JSON.parse(r.stdout) : null;
    cases.push({ name, args, exit: r.code, stdout, stderr: r.stderr });
    return stdout;
  };
}

/**
 * Writes `cases` to `outFile` with their provenance. `scratch`, then every temporary and home
 * folder, are replaced in every string by neutral stand-ins, `scratch` by `C:\Temp\<stand>`. An
 * argument that is a file under `scratch` keeps only the part after its first folder there, so
 * `<scratch>/bundle-3/graph.json` is kept as `graph.json`.
 */
export function writeFixture(outFile, { script, commit, scratch, stand, cases }) {
  const stands = [[scratch, `C:\\Temp\\${stand}`], [tmpdir(), 'C:\\Temp'], [homedir(), 'C:\\Users\\me']];
  const neutral = (value) => {
    if (typeof value === 'string') return stands.reduce((text, [path, stand]) => text.split(path).join(stand), value);
    if (Array.isArray(value)) return value.map(neutral);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neutral(v)]));
    return value;
  };
  const kept = cases.map((c) => ({ ...c, args: c.args.map((a) => (a.startsWith(scratch) ? a.slice(scratch.length + 1).split(/[\\/]/).slice(1).join('/') : a)) }));
  writeFileSync(outFile, JSON.stringify(neutral({
    provenance: `Recorded by ${script} from praxis in seanrobertwright/AI-WS-SDK at ${commit}, run against its simulated host on Node ${process.versions.node}.`,
    cases: kept,
  }), null, 2) + '\n');
}
