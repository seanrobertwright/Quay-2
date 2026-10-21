// Captures a tutorial's screenshots: launches a built Quay against a fixture that replays the
// tutorial's recordings, attaches over WebView2's debugging port, and takes each step's shots
// when every replay has reached its marker. README.md beside this file says how.
//
//   pnpm docs:capture <slug> --exe <Quay exe> [--tool <quay-record-replay.exe>] [--port <n>] [--fast <n>] [--by-hand]
//
// Exits 0 when every shot, the tutorial's section of the changed-shot report and the sidecar
// manifest are written, 1 when the capture fails, and 2 on a bad argument.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { formatDateStamp } from '../../src/lib/dates.ts';
import {
  buildSidecar,
  capturePaths,
  checkCaptureMachine,
  darkAppTheme,
  fixtureWorkspaces,
  parseCaptureArgs,
  parseCaptureManifest,
  planCapture,
  readRecordings,
  type Action,
  type CaptureArgs,
  type MachineFacts,
  type PlannedStep,
  type Shot,
} from './capture.ts';
import { reportShots, shotReportDir, type CapturedShot } from './shot-report.ts';

const root = join(import.meta.dirname, '..', '..');
/** WebP at quality 90 kept a 200% shot near 100 KB in the screenshot research. */
const WEBP_QUALITY = 90;
/** The rail header's bridge-port badge, which changes every launch and is always masked. */
const PORT_BADGE = /^:\d+$/;
/** The badge's own background, so the mask reads as an empty badge. */
const MASK_COLOR = '#21262d';
/** How long the terminals must stay unchanged before a shot, as xterm draws a frame at a time. */
const QUIET_MS = 500;
const CDP_TIMEOUT_MS = 30_000;

/** The files the script shares with every replay in the capture, in the replay state folder. */
const STATE = { speed: 'speed', runTo: 'run-to' } as const;

let args: CaptureArgs;
try {
  args = parseCaptureArgs(process.argv.slice(2), root);
} catch (error) {
  console.error(`docs:capture: ${(error as Error).message}`);
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fails when another program already listens on the debugging port, so the script can't attach to it by mistake. */
function checkPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`port ${port} is in use; close what holds it or pass another --port`)));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}

function cdpUp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get({ host: '127.0.0.1', port, path: '/json/version', timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForCdp(port: number, quay: ChildProcess): Promise<void> {
  const deadline = Date.now() + CDP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (quay.exitCode !== null) throw new Error(`Quay exited with code ${quay.exitCode} before its debugging port opened`);
    if (await cdpUp(port)) return;
    await sleep(250);
  }
  throw new Error(
    `WebView2's debugging port ${port} did not open within ${CDP_TIMEOUT_MS / 1000} s. ` +
      'If CDP attach is broken, capture by hand with --by-hand, or use tauri-driver with msedgedriver (see README.md).',
  );
}

/**
 * Kills Quay and everything it started, the replays in its terminals included, then any
 * process still running from the fixture folder: WebView2's processes can outlive the kill.
 */
function killTree(quay: ChildProcess | undefined, work: string) {
  if (quay?.pid !== undefined && quay.exitCode === null) {
    try {
      execFileSync('taskkill', ['/PID', String(quay.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      quay.kill();
    }
  }
  const script =
    'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:QUAY_CAPTURE_WORK) } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', env: { ...process.env, QUAY_CAPTURE_WORK: work } });
  } catch {
    // Removing the fixture below reports what is left.
  }
}

/**
 * Empties the neutral project folder and copies the tutorial's starter into it. A folder the
 * script did not make is never removed. The script marks a folder it made with a
 * `<folder>.quay-capture` file beside it, so nothing shows in the project Quay opens.
 */
function prepareProject(project: string, starter: string) {
  const made = `${project}.quay-capture`;
  if (existsSync(project) && !existsSync(made) && readdirSync(project).length > 0) {
    throw new Error(`${project} exists and was not made by a capture; move it away, or set another project in capture.json`);
  }
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  if (existsSync(starter)) cpSync(starter, project, { recursive: true });
  writeFileSync(made, `Made by pnpm docs:capture. The next capture empties ${project}.\n`);
}

/**
 * Replaces a file the replays read, all at once: a replay never reads it half written. A
 * replay holding the old file open can make the rename fail for a moment, so it is retried.
 */
function replaceFile(file: string, value: string) {
  const next = `${file}.next`;
  writeFileSync(next, value);
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(next, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/** What a replay has written to the state folder: the markers it reached, and calls the bridge refused. */
function replayState(stateDir: string, recording: string) {
  const read = (file: string) => {
    try {
      return readFileSync(join(stateDir, file), 'utf8');
    } catch {
      return null;
    }
  };
  const reached = read(`${recording}.markers`);
  return {
    started: existsSync(join(stateDir, `${recording}.claim`)),
    reached: reached === null ? [] : reached.split('\n').map((line) => line.trim()),
    errors: read(`${recording}.errors`),
  };
}

/** Waits until each replay in `waitFor` has reached `marker`. */
async function waitForMarker(stateDir: string, planned: PlannedStep, deadline: number) {
  const { marker } = planned.step;
  for (;;) {
    const states = planned.waitFor.map((name) => ({ name, ...replayState(stateDir, name) }));
    const behind = states.filter((s) => !s.reached.includes(marker));
    if (behind.length === 0) return;
    if (Date.now() > deadline) {
      const why = behind.map((s) =>
        s.started
          ? `${s.name} has not reached it; is it waiting for an Enter that step ${marker.slice(0, 2)}'s actions should press?`
          : `no terminal has played ${s.name} yet; do step ${marker.slice(0, 2)}'s actions open it?`,
      );
      const refused = states.filter((s) => s.errors !== null).map((s) => `${s.name} reported:\n${s.errors}`);
      throw new Error([`the replays did not reach ${marker} in time:`, ...why, ...refused].join('\n  '));
    }
    await sleep(100);
  }
}

function describe(action: Action): string {
  switch (action.kind) {
    case 'click':
      return `click ${action.selector}`;
    case 'press':
      return `press ${action.key} in ${action.selector}`;
    case 'fill':
      return `fill ${action.selector} with ${JSON.stringify(action.text)}`;
    case 'type':
      return `type ${JSON.stringify(action.text)} in ${action.selector}`;
  }
}

async function perform(page: Page, action: Action, timeout: number) {
  const target = page.locator(action.selector).first();
  switch (action.kind) {
    case 'click':
      return target.click({ timeout });
    case 'press':
      return target.press(action.key, { timeout });
    case 'fill':
      return target.fill(action.text, { timeout });
    case 'type':
      return target.pressSequentially(action.text, { timeout });
  }
}

/** A file as committed at HEAD, or null when HEAD has nothing at its path. */
function committedFile(file: string): Buffer | null {
  const path = relative(root, file).replaceAll('\\', '/');
  const blob = execFileSync('git', ['-C', root, 'ls-tree', '--object-only', 'HEAD', '--', path], { encoding: 'utf8' }).trim();
  if (blob === '') return null;
  return execFileSync('git', ['-C', root, 'cat-file', 'blob', blob], { maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Whether a shot was saved since `since`. The committed stills sit where new ones are saved, so
 * a file that merely exists may be one nobody retook.
 */
function savedSince(file: string, since: number): boolean {
  try {
    return statSync(file).mtimeMs >= since;
  } catch {
    return false;
  }
}

/** Each shot in the plan, as saved in the stills folder during this capture and as committed at HEAD. */
function capturedShots(plan: PlannedStep[], stills: string, since: number): CapturedShot[] {
  return plan.flatMap(({ step }) =>
    step.shots.map((shot) => {
      const file = join(stills, `${shot.name}.webp`);
      if (!savedSince(file, since)) throw new Error(`${relative(root, file)} was not saved during this capture`);
      return { name: shot.name, committed: committedFile(file), captured: readFileSync(file) };
    }),
  );
}

/** The version Tauri wrote into the exe's version resource, from `tauri.conf.json`. */
function exeVersion(exe: string): string {
  const script = '(Get-Item -LiteralPath $env:QUAY_CAPTURE_EXE).VersionInfo.ProductVersion';
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, QUAY_CAPTURE_EXE: exe },
  }).trim();
}

/** The Windows app theme, read from the registry; null when it can't be. */
function windowsDarkAppTheme(): boolean | null {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
  try {
    return darkAppTheme(execFileSync('reg', ['query', key, '/v', 'AppsUseLightTheme'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

/** The machine facts the capture is pinned to: the display and font as the webview sees them, and the app theme. */
async function machineFacts(page: Page): Promise<MachineFacts> {
  const seen = await page.evaluate(() => {
    // A font is installed when text set in it measures differently from each generic fallback.
    const context = document.createElement('canvas').getContext('2d');
    const sample = 'mmmmmmmmmmlli1|WW@#';
    const width = (font: string) => {
      if (context === null) return 0;
      context.font = `32px ${font}`;
      return context.measureText(sample).width;
    };
    const cascadiaCode = ['serif', 'sans-serif'].some((generic) => width(`"Cascadia Code", ${generic}`) !== width(generic));
    return { devicePixelRatio: window.devicePixelRatio, innerWidth: window.innerWidth, cascadiaCode };
  });
  return { ...seen, darkAppTheme: windowsDarkAppTheme() };
}

function quayVersion(page: Page): Promise<string> {
  return page.evaluate(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<string> } }).__TAURI_INTERNALS__;
    if (internals === undefined) throw new Error('the page has no Tauri IPC; is this Quay?');
    return internals.invoke('plugin:app|version');
  });
}

/** Waits until every terminal's rows have stayed the same for `QUIET_MS`. */
async function waitForQuietTerminals(page: Page, deadline: number) {
  let last = '';
  let since = Date.now();
  for (;;) {
    const now = await page.evaluate(() => [...document.querySelectorAll('.xterm-rows')].map((rows) => rows.textContent).join('\u0000'));
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= QUIET_MS) {
      return;
    }
    if (Date.now() > deadline) throw new Error('the terminals kept changing; a replay is not holding at the marker');
    await sleep(100);
  }
}

/** Removes every overlay the script drew. Safe to call when none is drawn. */
function removeOverlays(page: Page): Promise<void> {
  return page.evaluate(() => document.querySelectorAll('[data-quay-capture]').forEach((node) => node.remove()));
}

/**
 * Draws a shot's pins and annotations as overlays above Quay's UI; nothing Quay renders is
 * changed. A pin covers each element it matches with the pinned text in the element's own font,
 * colour and background. A pin over a terminal is refused, since agent output is never edited.
 */
async function drawOverlays(page: Page, shot: Shot) {
  for (const pin of shot.pins) {
    const drawn = await page.locator(pin.selector).evaluateAll((elements, text) => {
      if (elements.length === 0) return 'none';
      if (elements.some((element) => element.closest('.xterm') !== null)) return 'agent-output';
      const opaque = (colour: string) => colour !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(colour);
      for (const element of elements) {
        let background = '#0d1117';
        for (let node: Element | null = element; node !== null; node = node.parentElement) {
          const colour = getComputedStyle(node).backgroundColor;
          if (opaque(colour)) {
            background = colour;
            break;
          }
        }
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const cover = document.createElement('div');
        cover.dataset.quayCapture = '';
        cover.textContent = text;
        Object.assign(cover.style, {
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: '2147483646',
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: style.textAlign === 'right' || style.textAlign === 'end' ? 'flex-end' : style.textAlign === 'center' ? 'center' : 'flex-start',
          boxSizing: 'border-box',
          padding: style.padding,
          font: style.font,
          letterSpacing: style.letterSpacing,
          color: style.color,
          background,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        });
        document.body.append(cover);
      }
      return 'drawn';
    }, pin.text);
    if (drawn === 'none') throw new Error(`${shot.name}: the pin ${pin.selector} matches nothing`);
    if (drawn === 'agent-output') throw new Error(`${shot.name}: the pin ${pin.selector} is agent output, which a shot never edits`);
  }
  for (const note of shot.annotations) {
    const box = await page.locator(note.target).first().boundingBox();
    if (box === null) throw new Error(`${shot.name}: the annotation target ${note.target} is not on screen`);
    await page.evaluate(
      ({ box, label }) => {
        const outline = document.createElement('div');
        outline.dataset.quayCapture = '';
        Object.assign(outline.style, {
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: '2147483647',
          left: `${box.x - 4}px`,
          top: `${box.y - 4}px`,
          width: `${box.width + 8}px`,
          height: `${box.height + 8}px`,
          border: '3px solid #f0883e',
          borderRadius: '8px',
        });
        document.body.append(outline);
        if (label === undefined) return;
        const tag = document.createElement('div');
        tag.dataset.quayCapture = '';
        tag.textContent = label;
        Object.assign(tag.style, {
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: '2147483647',
          left: `${box.x + 8}px`,
          top: `${box.y + 8}px`,
          background: '#f0883e',
          color: '#0d1117',
          font: '600 14px/1.2 system-ui, sans-serif',
          padding: '4px 8px',
          borderRadius: '6px',
        });
        document.body.append(tag);
      },
      { box, label: note.label },
    );
  }
}

async function takeShot(page: Page, shot: Shot, file: string, timeout: number) {
  try {
    await drawOverlays(page, shot);
    const mask: Locator[] = [page.getByText(PORT_BADGE), ...shot.mask.map((selector) => page.locator(selector))];
    const options = { path: file, type: 'webp', quality: WEBP_QUALITY, scale: 'device', animations: 'disabled', caret: 'hide', mask, maskColor: MASK_COLOR, timeout } as const;
    if (shot.pane === null) await page.screenshot(options);
    else await page.locator(shot.pane).first().screenshot(options);
  } finally {
    await removeOverlays(page);
  }
}

async function appPage(browser: Browser): Promise<Page> {
  const context = browser.contexts()[0];
  if (context === undefined) throw new Error('the webview has no browser context to attach to');
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  // The first page can still read about:blank at attach time.
  await page.getByText(PORT_BADGE).first().waitFor({ state: 'visible', timeout: CDP_TIMEOUT_MS });
  return page;
}

async function main() {
  const paths = capturePaths(root, args.tutorial);
  const slug = args.tutorial.slug;
  if (!existsSync(paths.manifest)) throw new Error(`${relative(root, paths.manifest)} does not exist; write the tutorial's capture manifest first`);
  const manifest = parseCaptureManifest(readFileSync(paths.manifest, 'utf8'), slug);
  const recordings = readRecordings(paths.recordings);
  const plan = planCapture(manifest, recordings);
  for (const [what, file] of [['--exe', args.exe], ['--tool', args.tool]]) {
    if (!existsSync(file)) throw new Error(`${what} ${file} does not exist`);
  }
  if (!args.byHand) await checkPortFree(args.port);

  // The fixture: Quay's own state, the webview's, the replays' and the fake CLIs, all fresh.
  const work = mkdtempSync(join(tmpdir(), `quay-capture-${slug}-`));
  let quay: ChildProcess | undefined;
  let failed = true;
  try {
    const localAppData = join(work, 'LocalAppData');
    const replayState = join(work, 'replay-state');
    const fakeCli = join(work, 'fake-cli');
    const claudeConfig = join(work, 'claude-config');
    for (const dir of [join(localAppData, 'Quay2'), replayState, fakeCli]) mkdirSync(dir, { recursive: true });
    for (const cli of new Set(recordings.map((r) => r.cli))) copyFileSync(args.tool, join(fakeCli, `${cli}.exe`));
    if (existsSync(paths.claudeConfig)) cpSync(paths.claudeConfig, claudeConfig, { recursive: true });
    else mkdirSync(claudeConfig);
    prepareProject(manifest.project, paths.starter);
    const workspaces = fixtureWorkspaces({
      project: manifest.project,
      fakeCli,
      systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
      replayDir: paths.recordings,
      replayState,
    });
    writeFileSync(join(localAppData, 'Quay2', 'workspaces.json'), JSON.stringify(workspaces, null, 2));
    const setState = (file: string, value: string | null) => {
      if (value === null) rmSync(join(replayState, file), { force: true });
      else replaceFile(join(replayState, file), value);
    };
    setState(STATE.speed, String(args.fast));
    setState(STATE.runTo, plan[0].step.marker);

    // Only this process's child gets the debugging port; nothing is set in config or builds.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LOCALAPPDATA: localAppData,
      CLAUDE_CONFIG_DIR: claudeConfig,
      WEBVIEW2_USER_DATA_FOLDER: join(work, 'WebView2'),
    };
    if (!args.byHand) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${args.port}`;
    quay = spawn(args.exe, [], { env, stdio: 'ignore' });
    // A whole second back, since some file systems keep coarser modification times than the clock.
    const startedAt = Date.now() - 1000;
    const capturedOn = formatDateStamp(Date.now());
    let version: string;
    if (args.byHand) version = await captureByHand(plan, replayState, setState, paths.stills, startedAt);
    else version = await captureOverCdp(plan, replayState, setState, paths.stills, quay);
    const sidecar = buildSidecar({ tutorial: slug, quayVersion: version, capturedOn, recordings });
    const reportDir = shotReportDir(root, sidecar.quayVersion);
    const report = await reportShots({ dir: reportDir, tutorial: slug, quayVersion: sidecar.quayVersion, capturedOn, shots: capturedShots(plan, paths.stills, startedAt) });
    const differ = report.shots.filter((shot) => shot.status !== 'unchanged');
    for (const shot of differ) console.log(`  ${shot.status}: ${shot.name}.webp`);
    console.log(
      `${differ.length} of ${report.shots.length} shots changed or new; review them in ${relative(root, join(reportDir, 'index.html')).replaceAll('\\', '/')}.`,
    );
    mkdirSync(join(paths.sidecar, '..'), { recursive: true });
    writeFileSync(paths.sidecar, `${JSON.stringify(sidecar, null, 2)}\n`);
    console.log(`Wrote ${relative(root, paths.sidecar).replaceAll('\\', '/')} for Quay ${sidecar.quayVersion}.`);
    failed = false;
  } finally {
    killTree(quay, work);
    if (failed) {
      console.error(`The fixture is kept for a look at ${work}`);
    } else {
      // WebView2 lets go of its folder a moment after Quay is killed.
      try {
        rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch (error) {
        console.warn(`Could not remove the fixture at ${work}: ${(error as Error).message}`);
      }
    }
  }
}

type SetState = (file: string, value: string | null) => void;

async function captureOverCdp(plan: PlannedStep[], stateDir: string, setState: SetState, stills: string, quay: ChildProcess): Promise<string> {
  await waitForCdp(args.port, quay);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`);
  try {
    const page = await appPage(browser);
    await page.evaluate(() => document.fonts.ready);
    const problems = checkCaptureMachine(await machineFacts(page));
    if (problems.length > 0) throw new Error(['the capture machine is not pinned:', ...problems].join('\n  '));
    const version = await quayVersion(page);
    mkdirSync(stills, { recursive: true });
    for (const planned of plan) {
      const { step } = planned;
      const deadline = Date.now() + step.timeout * 1000;
      const timeout = step.timeout * 1000;
      if (step.realTime) setState(STATE.speed, '1');
      setState(STATE.runTo, step.marker);
      for (const action of step.actions) await perform(page, action, timeout);
      await waitForMarker(stateDir, planned, deadline);
      if (step.realTime) setState(STATE.speed, String(args.fast));
      for (const selector of step.waitFor) await page.locator(selector).first().waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) });
      await page.evaluate(() => document.fonts.ready);
      await waitForQuietTerminals(page, deadline);
      for (const shot of step.shots) {
        const file = join(stills, `${shot.name}.webp`);
        await takeShot(page, shot, file, timeout);
        console.log(`${shot.name}.webp`);
      }
    }
    setState(STATE.runTo, null);
    return version;
  } finally {
    // Over CDP this only disconnects; Quay is killed after.
    await browser.close();
  }
}

/** The fallback: the same fixture and holds, with a person taking each shot with ShareX or Snipping Tool. */
async function captureByHand(plan: PlannedStep[], stateDir: string, setState: SetState, stills: string, since: number): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Quay is open on the capture fixture with no debugging port. Capture its client area only, at 200% scaling.');
    console.log(`Save each shot as WebP in ${stills}.`);
    mkdirSync(stills, { recursive: true });
    for (const planned of plan) {
      const { step } = planned;
      if (step.realTime) setState(STATE.speed, '1');
      setState(STATE.runTo, step.marker);
      console.log(`\nStep ${step.marker}:`);
      for (const action of step.actions) console.log(`  ${describe(action)}`);
      if (planned.waitFor.length > 0) console.log(`  then wait for ${planned.waitFor.join(', ')} to reach ${step.marker} ...`);
      await waitForMarker(stateDir, planned, Number.POSITIVE_INFINITY);
      if (step.realTime) setState(STATE.speed, String(args.fast));
      for (const shot of step.shots) {
        const what = shot.pane === null ? 'the full window' : `the pane ${shot.pane}`;
        console.log(`  Take ${shot.name}.webp of ${what}, blurring the port badge${shot.mask.length > 0 ? ` and ${shot.mask.join(', ')}` : ''}.`);
      }
      // Each shot is compared with the committed one after the capture; a missing one is asked for now.
      for (;;) {
        await prompt.question('  Press Enter when the shots are saved. ');
        const missing = step.shots.filter((shot) => !savedSince(join(stills, `${shot.name}.webp`), since)).map((shot) => `${shot.name}.webp`);
        if (missing.length === 0) break;
        console.log(`  Not saved yet: ${missing.join(', ')}.`);
      }
    }
    setState(STATE.runTo, null);
    return exeVersion(args.exe);
  } finally {
    prompt.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`docs:capture: ${(error as Error).message}`);
  process.exit(1);
}
