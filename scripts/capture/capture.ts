// The parts of the capture script that need no Quay: its arguments, a tutorial's capture
// manifest and recordings, the plan of which replays each shot waits for, the fixture
// workspace, the capture-machine check, a clip's frames and the sidecar manifest. README.md
// beside this file says how a capture runs.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { SHOT_NAME, VERSION } from '../../docs/.vitepress/step-cards.ts';
import { TUTORIALS, tutorialPage, type Tutorial } from '../../docs/.vitepress/tutorials.ts';
import { formatUtcDateStamp, isDateStamp } from '../../src/lib/dates.ts';
/** A recording's file name: the CLI it stood in for, and that CLI's terminals counted from 1. */
const RECORDING = /^([a-z0-9][a-z0-9_.]*(?:-[a-z0-9_.]+)*?)-(\d+)\.cast\.gz$/;

const DEFAULT_PORT = 9333;
const DEFAULT_FAST = 10;
const MAX_FAST = 100;
const DEFAULT_TIMEOUT_SECONDS = 120;
/** A clip runs at real speed for this long at most; motion that takes longer is not a clip. */
export const MAX_CLIP_SECONDS = 10;

export interface CaptureArgs {
  tutorial: Tutorial;
  /** The built Quay to capture: an installed release, or `src-tauri/target/release/tauri-app.exe`. */
  exe: string;
  /** `quay-record-replay.exe`, copied into the fixture under each recorded CLI's name. */
  tool: string;
  /** The loopback port WebView2's remote debugging listens on. */
  port: number;
  /** The replay speed until the marker before a shot. */
  fast: number;
  /** The `ffmpeg` that encodes a clip, `ffmpeg` on the `PATH` unless given. */
  ffmpeg: string;
  /** Builds the fixture and launches Quay with no debugging port, for a capture by hand. */
  byHand: boolean;
}

/** Reads `<slug> --exe <path> [--tool <path>] [--port <n>] [--fast <n>] [--ffmpeg <path>] [--by-hand]`. */
export function parseCaptureArgs(argv: string[], root: string): CaptureArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      exe: { type: 'string' },
      tool: { type: 'string' },
      port: { type: 'string' },
      fast: { type: 'string' },
      ffmpeg: { type: 'string' },
      'by-hand': { type: 'boolean' },
    },
  });
  if (positionals.length === 0) throw new Error('name the tutorial to capture by its slug, such as hello-a2a');
  if (positionals.length > 1) throw new Error(`capture one tutorial at a time, not ${positionals.join(', ')}`);
  const tutorial = TUTORIALS.find((t) => t.slug === positionals[0]);
  if (tutorial === undefined) throw new Error(`${JSON.stringify(positionals[0])} is not a tutorial slug`);
  const exe = values.exe?.trim() ?? '';
  if (exe === '') throw new Error('--exe must name the built Quay to capture');
  const tool = values.tool?.trim() || join(root, 'tools', 'record-replay', 'target', 'release', 'quay-record-replay.exe');

  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    if (!/^\d+$/.test(values.port)) throw new Error(`--port must be a whole number, not ${JSON.stringify(values.port)}`);
    port = Number.parseInt(values.port, 10);
    if (port < 1024 || port > 65535) throw new Error(`--port must be from 1024 to 65535, not ${port}`);
  }
  let fast = DEFAULT_FAST;
  if (values.fast !== undefined) {
    fast = /^\d+(?:\.\d+)?$/.test(values.fast) ? Number(values.fast) : Number.NaN;
    if (!(fast >= 1 && fast <= MAX_FAST)) throw new Error(`--fast must be a speed from 1 to ${MAX_FAST}, not ${JSON.stringify(values.fast)}`);
  }
  const ffmpeg = values.ffmpeg === undefined ? 'ffmpeg' : values.ffmpeg.trim();
  if (ffmpeg === '') throw new Error('--ffmpeg must name the ffmpeg that encodes clips');
  return { tutorial, exe, tool, port, fast, ffmpeg, byHand: values['by-hand'] ?? false };
}

export interface CapturePaths {
  /** The tutorial's recordings, `tools/record-replay/recordings/<slug>/`. */
  recordings: string;
  /** Its capture manifest, beside the recordings. */
  manifest: string;
  /** The Claude config folder whose transcripts give the spend figure, beside the recordings. */
  claudeConfig: string;
  /** The tutorial's page folder, where its `NN-<what>.webp` stills go. */
  stills: string;
  /** Its sidecar manifest, `examples/tutorials/<slug>/sidecar.json`, which the docs build's release check reads. */
  sidecar: string;
  /** Its starter project, copied into the neutral project path. */
  starter: string;
}

export function capturePaths(root: string, tutorial: Tutorial): CapturePaths {
  const recordings = join(root, 'tools', 'record-replay', 'recordings', tutorial.slug);
  const examples = join(root, 'examples', 'tutorials', tutorial.slug);
  return {
    recordings,
    manifest: join(recordings, 'capture.json'),
    claudeConfig: join(recordings, 'claude-config'),
    stills: join(root, 'docs', ...tutorialPage(tutorial).split('/').slice(0, -1)),
    sidecar: join(examples, 'sidecar.json'),
    starter: join(examples, 'starter'),
  };
}

/**
 * What the script does in Quay before a step's shot, as the learner does it. The manifest
 * writes one as `{ "click": <selector> }`, `{ "press": <key>, "in": <selector> }`,
 * `{ "fill": <selector>, "text": <text> }` or `{ "type": <text>, "in": <selector> }`.
 */
export type Action =
  | { kind: 'click'; selector: string }
  | { kind: 'press'; key: string; selector: string }
  | { kind: 'fill'; selector: string; text: string }
  | { kind: 'type'; text: string; selector: string };

/** A value shown in Quay's own UI, set for the shot. Never agent output. */
export interface Pin {
  selector: string;
  text: string;
}

/** An overlay drawn around an element for the shot, with an optional label. */
export interface Annotation {
  target: string;
  label?: string;
}

export interface Shot {
  /** The still's name, `NN-<what>`, written as `NN-<what>.webp` beside the tutorial's page. */
  name: string;
  /** A selector for the one pane to capture, or null for the full window. */
  pane: string | null;
  /** Selectors masked in the shot, beside the bridge-port badge, which is always masked. */
  mask: string[];
  pins: Pin[];
  annotations: Annotation[];
  /**
   * Whether the step is also recorded as the tutorial's clip, `NN-<what>.mp4` beside this still,
   * from the start of the step's actions until the still is ready.
   */
  clip: boolean;
}

export interface CaptureStep {
  marker: string;
  actions: Action[];
  /** Selectors that must be visible before the step's shots are taken. */
  waitFor: string[];
  /** Seconds to wait for the replays to reach the marker and the selectors to show. */
  timeout: number;
  /** Plays the replays in real time from the previous marker to this one, as a clip needs. */
  realTime: boolean;
  shots: Shot[];
}

export interface CaptureManifest {
  tutorial: string;
  /** The neutral project path the recordings were made on, `C:\tutorials\<slug>` by default. */
  project: string;
  steps: CaptureStep[];
}

type Json = unknown;

/** Reads a JSON object at `at`, refusing keys outside `allowed`. */
function object(value: Json, at: string, allowed: readonly string[]): Record<string, Json> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${at} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${at} has ${JSON.stringify(key)}, which is not one of ${allowed.join(', ')}`);
  }
  return value as Record<string, Json>;
}

function text(value: Json, at: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${at} must be a non-empty string`);
  return value;
}

function list<T>(value: Json, at: string, item: (value: Json, at: string) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${at} must be a list`);
  return value.map((entry, i) => item(entry, `${at}[${i}]`));
}

function marker(value: Json, at: string): string {
  const name = text(value, at);
  if (!SHOT_NAME.test(name)) throw new Error(`${at} must be a step marker, NN-<what> in lower case, like 06-reply-quoted, not ${JSON.stringify(name)}`);
  return name;
}

function action(value: Json, at: string): Action {
  const entry = object(value, at, ['click', 'press', 'fill', 'type', 'in', 'text']);
  const verbs = ['click', 'press', 'fill', 'type'].filter((verb) => Object.hasOwn(entry, verb));
  if (verbs.length !== 1) throw new Error(`${at} must do one of click, press, fill or type`);
  const allow = (keys: string[]) => {
    const extra = Object.keys(entry).filter((key) => !keys.includes(key));
    if (extra.length > 0) throw new Error(`${at} has ${extra.join(', ')}, which ${verbs[0]} does not take`);
  };
  switch (verbs[0]) {
    case 'click':
      allow(['click']);
      return { kind: 'click', selector: text(entry.click, `${at}.click`) };
    case 'press':
      allow(['press', 'in']);
      return { kind: 'press', key: text(entry.press, `${at}.press`), selector: text(entry.in, `${at}.in`) };
    case 'fill':
      allow(['fill', 'text']);
      if (typeof entry.text !== 'string') throw new Error(`${at}.text must be a string`);
      return { kind: 'fill', selector: text(entry.fill, `${at}.fill`), text: entry.text };
    default:
      allow(['type', 'in']);
      return { kind: 'type', text: text(entry.type, `${at}.type`), selector: text(entry.in, `${at}.in`) };
  }
}

/** Whether a selector names terminal output, which a shot never edits. */
const namesAgentOutput = (selector: string) => /xterm/i.test(selector);

function shot(value: Json, at: string, step: string): Shot {
  const entry = object(value, at, ['name', 'pane', 'mask', 'pin', 'annotations', 'clip']);
  const name = entry.name === undefined ? step : marker(entry.name, `${at}.name`);
  if (name.slice(0, 2) !== step.slice(0, 2)) throw new Error(`${at}.name must start with its step's number, ${step.slice(0, 2)}`);
  const pins = list(entry.pin, `${at}.pin`, (pin, pinAt) => {
    const fields = object(pin, pinAt, ['selector', 'text']);
    const selector = text(fields.selector, `${pinAt}.selector`);
    if (namesAgentOutput(selector)) throw new Error(`${pinAt}.selector names agent output, which a shot never edits; mask it or make a new recording`);
    if (typeof fields.text !== 'string') throw new Error(`${pinAt}.text must be a string`);
    return { selector, text: fields.text };
  });
  const annotations = list(entry.annotations, `${at}.annotations`, (note, noteAt) => {
    const fields = object(note, noteAt, ['target', 'label']);
    const annotation: Annotation = { target: text(fields.target, `${noteAt}.target`) };
    if (fields.label !== undefined) annotation.label = text(fields.label, `${noteAt}.label`);
    return annotation;
  });
  if (entry.clip !== undefined && typeof entry.clip !== 'boolean') throw new Error(`${at}.clip must be true or false`);
  const pane = entry.pane === undefined ? null : text(entry.pane, `${at}.pane`);
  const clip = entry.clip === true;
  if (clip && pane !== null) throw new Error(`${at}.clip records the full window, as the still beside it must be; leave out pane`);
  // A value pinned in the still would change under it in the clip, its poster.
  if (clip && pins.length > 0) throw new Error(`${at}.clip can't have a pin, since the clip would show the value the still pins`);
  return { name, pane, mask: list(entry.mask, `${at}.mask`, text), pins, annotations, clip };
}

/**
 * Reads a tutorial's `capture.json`: for each step marker, in step order, the actions that get
 * Quay there, the selectors to wait for, and the shots taken there. It is the only place a
 * shot's geometry lives.
 */
export function parseCaptureManifest(json: string, slug: string): CaptureManifest {
  let value: Json;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`capture.json is not JSON: ${(error as Error).message}`);
  }
  const top = object(value, 'capture.json', ['tutorial', 'project', 'steps']);
  if (top.tutorial !== slug) throw new Error(`capture.json's tutorial must be ${JSON.stringify(slug)}, the folder it sits in`);
  const project = top.project === undefined ? `C:\\tutorials\\${slug}` : text(top.project, 'project');
  if (!/^[A-Za-z]:\\/.test(project)) throw new Error(`project must be an absolute Windows path, such as C:\\tutorials\\${slug}`);
  if (/\\Users\\/i.test(project)) throw new Error(`project must be a neutral path such as C:\\tutorials\\${slug}, never under a user profile`);
  if (!Array.isArray(top.steps) || top.steps.length === 0) throw new Error('steps must list at least one step');

  const names = new Set<string>();
  const steps = top.steps.map((raw: Json, i: number): CaptureStep => {
    const at = `steps[${i}]`;
    const entry = object(raw, at, ['marker', 'actions', 'waitFor', 'timeout', 'realTime', 'shots']);
    const name = marker(entry.marker, `${at}.marker`);
    let timeout = DEFAULT_TIMEOUT_SECONDS;
    if (entry.timeout !== undefined) {
      if (typeof entry.timeout !== 'number' || !Number.isInteger(entry.timeout) || entry.timeout < 1 || entry.timeout > 3600) {
        throw new Error(`${at}.timeout must be whole seconds from 1 to 3600`);
      }
      timeout = entry.timeout;
    }
    if (entry.realTime !== undefined && typeof entry.realTime !== 'boolean') throw new Error(`${at}.realTime must be true or false`);
    const shots = entry.shots === undefined ? [shot({}, `${at}.shots[0]`, name)] : list(entry.shots, `${at}.shots`, (s, shotAt) => shot(s, shotAt, name));
    if (shots.length === 0) throw new Error(`${at}.shots must list at least one shot, or be left out for one full-window shot`);
    const clipAt = shots.findIndex((s) => s.clip);
    if (clipAt >= 0 && entry.realTime !== true) throw new Error(`${at}.shots[${clipAt}].clip plays at real speed, never sped up, so the step needs realTime: true`);
    for (const { name: shotName } of shots) {
      if (names.has(shotName)) throw new Error(`the shot ${shotName} is taken twice; give each shot its own name`);
      names.add(shotName);
    }
    return {
      marker: name,
      actions: list(entry.actions, `${at}.actions`, action),
      waitFor: list(entry.waitFor, `${at}.waitFor`, text),
      timeout,
      realTime: entry.realTime === true,
      shots,
    };
  });
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].marker.slice(0, 2) <= steps[i - 1].marker.slice(0, 2)) {
      throw new Error(`steps[${i}].marker must come after ${steps[i - 1].marker}; list the steps in order, one per number`);
    }
  }
  const clips = steps.flatMap((step) => step.shots).filter((s) => s.clip);
  if (clips.length > 1) throw new Error(`a tutorial has at most one clip, and clip is set on ${clips.map((s) => s.name).join(', ')}`);
  return { tutorial: slug, project, steps };
}

/**
 * The `.mp4` files in a tutorial's stills folder other than its manifest's clip. The capture
 * would leave each one beside a still it no longer matches, since a clip is re-recorded only
 * with its still.
 */
export function staleClips(manifest: CaptureManifest, files: string[]): string[] {
  const clip = manifest.steps.flatMap((step) => step.shots).find((s) => s.clip);
  return files.filter((file) => /\.mp4$/i.test(file) && file !== `${clip?.name}.mp4`);
}

/** A frame of the CDP screencast, saved as `file`, and when it arrived, in epoch milliseconds. */
export interface ClipFrame {
  file: string;
  at: number;
}

/**
 * Lays out a clip from `start` to `end`, epoch milliseconds, at real speed and `fps` frames a
 * second: for each of its frames, the screencast frame on screen at that moment. The screencast
 * sends a frame only when Quay paints, so a frame stays on screen until the next. The frame on
 * screen at `start` opens the clip, or the first frame after it when none came before. A clip
 * longer than `MAX_CLIP_SECONDS` is refused rather than sped up.
 */
export function clipFrames(frames: ClipFrame[], start: number, end: number, fps: number): string[] {
  const before = frames.filter((frame) => frame.at <= start).at(-1);
  const during = frames.filter((frame) => frame.at > start && frame.at < end);
  const shown = before === undefined ? during : [{ ...before, at: start }, ...during];
  if (shown.length === 0) throw new Error('the screencast sent no frames during the clip');
  const opens = shown[0].at;
  const seconds = (end - opens) / 1000;
  if (seconds > MAX_CLIP_SECONDS) {
    throw new Error(`the clip runs ${seconds.toFixed(1)} s, over ten seconds; a clip is never sped up, so give it a step with shorter motion`);
  }
  const files: string[] = [];
  let i = 0;
  for (let k = 0; k < Math.max(1, Math.round(seconds * fps)); k++) {
    const at = opens + (k * 1000) / fps;
    while (i + 1 < shown.length && shown[i + 1].at <= at) i++;
    files.push(shown[i].file);
  }
  return files;
}

export interface RecordingInfo {
  /** `<cli>-<n>`, as the replay names it in the state folder. */
  name: string;
  cli: string;
  /** When the recorded run started, in epoch milliseconds, if the recording says. */
  startedAt: number | null;
  /** When the recording's last event happened, in epoch milliseconds, when it says when it started. */
  endedAt: number | null;
  /** The real CLI's answer to `--version` when it was recorded, if the recording says. */
  cliVersion: string | null;
  /** The step markers in the recording, in order. */
  markers: string[];
  /**
   * The marker the recording opens with, before any output: the step that was already marked
   * when its terminal started. Its terminal starts during the next step, so it never shows it.
   */
  startMarker: string | null;
}

/** Reads every recording in a tutorial's recordings folder, in name order. */
export function readRecordings(dir: string): RecordingInfo[] {
  const files = readdirSync(dir).filter((file) => file.endsWith('.cast.gz')).sort();
  if (files.length === 0) throw new Error(`there are no recordings in ${dir}; record the tutorial first`);
  return files.map((file) => {
    const match = RECORDING.exec(file);
    if (match === null) throw new Error(`${file} is not named <cli>-<n>.cast.gz, as the record and replay tool names recordings`);
    const name = file.slice(0, -'.cast.gz'.length);
    const lines = gunzipSync(readFileSync(join(dir, file))).toString('utf8').split('\n').filter((line) => line.trim() !== '');
    let header: Json;
    try {
      header = JSON.parse(lines[0] ?? '');
    } catch {
      header = null;
    }
    const fields = typeof header === 'object' && header !== null ? (header as Record<string, Json>) : {};
    if (fields.version !== 2 || !Number.isInteger(fields.width) || !Number.isInteger(fields.height)) {
      throw new Error(`${name}: not an asciicast v2 header with width and height`);
    }
    const events = lines.slice(1).map((line, i) => {
      const event: Json = JSON.parse(line);
      if (!Array.isArray(event) || typeof event[1] !== 'string' || typeof event[2] !== 'string') {
        throw new Error(`${name}: line ${i + 2} is not an event [seconds, code, data]`);
      }
      return { at: typeof event[0] === 'number' ? event[0] : 0, code: event[1], data: event[2] };
    });
    const markers = events.filter((e) => e.code === 'm').map((e) => e.data);
    const first = events[0];
    const startedAt = Number.isInteger(fields.timestamp) ? (fields.timestamp as number) * 1000 : null;
    return {
      name,
      cli: match[1],
      startedAt,
      endedAt: startedAt === null ? null : startedAt + Math.max(0, ...events.map((e) => e.at)) * 1000,
      cliVersion: typeof fields.cli_version === 'string' && fields.cli_version !== '' ? fields.cli_version : null,
      markers,
      startMarker: first?.code === 'm' ? first.data : null,
    };
  });
}

export interface PlannedStep {
  step: CaptureStep;
  /** The recordings whose replays must reach the step's marker before its shots are taken. */
  waitFor: string[];
}

/**
 * Works out which replays each step waits for: every recording that reaches the step's marker,
 * except one that only opens on it. A marker no step takes a shot at is an error, since every
 * marker is a step's screenshot name.
 */
export function planCapture(manifest: CaptureManifest, recordings: RecordingInfo[]): PlannedStep[] {
  const steps = new Set(manifest.steps.map((step) => step.marker));
  for (const recording of recordings) {
    for (const name of recording.markers.filter((m) => m !== recording.startMarker && !steps.has(m))) {
      throw new Error(`${recording.name} has the step marker ${name}, which capture.json has no step for`);
    }
  }
  return manifest.steps.map((step) => ({
    step,
    waitFor: recordings.filter((r) => r.markers.includes(step.marker) && r.startMarker !== step.marker).map((r) => r.name),
  }));
}

export interface Sidecar {
  tutorial: string;
  /** The Quay version the shots were captured from. The docs build's release check reads it. */
  quayVersion: string;
  capturedOn: string;
  /** The UTC date the recorded run started. */
  recordedOn: string;
  /** Each CLI's version in the recorded run. */
  cliVersions: Record<string, string>;
}

/**
 * The sidecar manifest beside a tutorial's starter: the Quay version captured, the UTC date the
 * recordings were made and each CLI's version from that run. The docs build's release check
 * reads `quayVersion`; the quarterly sweep reads it all with `parseSidecar`.
 */
export function buildSidecar(input: { tutorial: string; quayVersion: string; capturedOn: string; recordings: RecordingInfo[] }): Sidecar {
  const quayVersion = VERSION.exec(input.quayVersion)?.[1];
  if (quayVersion === undefined) throw new Error(`Quay reported ${JSON.stringify(input.quayVersion)}, which is not a Quay version such as 0.3.0`);
  const cliVersions: Record<string, string> = {};
  let started = Number.POSITIVE_INFINITY;
  for (const recording of input.recordings) {
    if (recording.startedAt === null) throw new Error(`${recording.name} does not say when it was recorded; re-make it with the current record and replay tool`);
    if (recording.cliVersion === null) throw new Error(`${recording.name} does not say which ${recording.cli} version made it; re-make it with the current record and replay tool`);
    const known = Object.hasOwn(cliVersions, recording.cli) ? cliVersions[recording.cli] : undefined;
    if (known !== undefined && known !== recording.cliVersion) {
      throw new Error(`the ${recording.cli} recordings were made with two versions, ${known} and ${recording.cliVersion}; re-make them in one run`);
    }
    cliVersions[recording.cli] = recording.cliVersion;
    started = Math.min(started, recording.startedAt);
  }
  return { tutorial: input.tutorial, quayVersion, capturedOn: input.capturedOn, recordedOn: formatUtcDateStamp(started), cliVersions };
}

/**
 * Reads the sidecar manifest of the tutorial `slug`, as `buildSidecar` writes it. Throws, naming
 * the field, when the text is not JSON or a field is missing or malformed.
 */
export function parseSidecar(json: string, slug: string): Sidecar {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`not valid JSON: ${(error as Error).message}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not a JSON object');
  const fields = value as Record<string, unknown>;
  const text = (name: string): string => {
    const field = Object.hasOwn(fields, name) ? fields[name] : undefined;
    if (typeof field !== 'string' || field === '') throw new Error(`${name} is missing or not a string`);
    return field;
  };
  const tutorial = text('tutorial');
  if (tutorial !== slug) throw new Error(`tutorial is ${JSON.stringify(tutorial)}; the manifest beside ${slug}'s starter names ${slug}`);
  const quayVersion = text('quayVersion');
  if (VERSION.exec(quayVersion)?.[1] !== quayVersion) throw new Error(`quayVersion ${JSON.stringify(quayVersion)} is not a Quay version such as 0.3.0`);
  const dates = ['capturedOn', 'recordedOn'].map((name) => {
    const date = text(name);
    if (!isDateStamp(date)) throw new Error(`${name} ${JSON.stringify(date)} is not a date written YYYY-MM-DD`);
    return date;
  });
  const versions = Object.hasOwn(fields, 'cliVersions') ? fields.cliVersions : undefined;
  if (typeof versions !== 'object' || versions === null || Array.isArray(versions)) throw new Error('cliVersions is missing or not an object');
  const cliVersions: Record<string, string> = {};
  for (const [cli, version] of Object.entries(versions)) {
    if (typeof version !== 'string' || version === '') throw new Error(`cliVersions.${cli} is not a version string`);
    cliVersions[cli] = version;
  }
  return { tutorial, quayVersion, capturedOn: dates[0], recordedOn: dates[1], cliVersions };
}

/**
 * The fixture `workspaces.json`: one project on the neutral path, whose saved `env_vars` put the
 * fake CLIs first on its terminals' `PATH` and point them at the replay. Quay builds a
 * terminal's environment from the registry and then applies these, so this is the only way the
 * fake CLIs reach its terminals.
 */
export function fixtureWorkspaces(input: { project: string; fakeCli: string; systemRoot: string; replayDir: string; replayState: string }) {
  const name = input.project.split('\\').filter(Boolean).at(-1) ?? input.project;
  return {
    active_project: input.project,
    projects: [
      {
        path: input.project,
        name,
        env_vars: {
          PATH: [input.fakeCli, `${input.systemRoot}\\system32`, input.systemRoot].join(';'),
          QUAY_REPLAY_DIR: input.replayDir,
          QUAY_REPLAY_STATE: input.replayState,
          // The test account sets QUAY_RECORD_DIR as a user variable, which reaches every
          // terminal; blank it so the tool replays instead of refusing both modes.
          QUAY_RECORD_DIR: '',
        },
      },
    ],
  };
}

export interface MachineFacts {
  devicePixelRatio: number;
  innerWidth: number;
  /** Whether the webview has Cascadia Code, the first font in the terminal's font stack. */
  cascadiaCode: boolean;
  /** Whether the Windows app theme is dark, or null when it can't be read. */
  darkAppTheme: boolean | null;
}

/**
 * Reads the Windows app theme from `reg query` output for `AppsUseLightTheme`: true for dark,
 * false for light, null when the output has no such value. The webview's
 * `prefers-color-scheme` does not follow the app theme, so the registry is the source.
 */
export function darkAppTheme(regQuery: string): boolean | null {
  const value = /^\s*AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)\s*$/im.exec(regQuery)?.[1];
  return value === undefined ? null : Number.parseInt(value, 16) === 0;
}

/** What is not pinned on the capture machine, as the capture page reports it; empty when all is. */
export function checkCaptureMachine(facts: MachineFacts): string[] {
  const problems: string[] = [];
  if (facts.devicePixelRatio !== 2) problems.push(`set Windows display scaling to 200%; the webview reports ${facts.devicePixelRatio * 100}% (device pixel ratio ${facts.devicePixelRatio})`);
  if (facts.innerWidth !== 1280) problems.push(`Quay must open 1280 px wide; it opened ${facts.innerWidth} px wide (is the screen too small at 200%?)`);
  if (!facts.cascadiaCode) problems.push('install Cascadia Code, the terminal font, on the capture machine');
  if (facts.darkAppTheme === null) problems.push('the Windows app theme could not be read from the registry; set it to dark');
  else if (!facts.darkAppTheme) problems.push('set the Windows app theme to dark (Settings > Personalization > Colors)');
  return problems;
}
