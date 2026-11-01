// The Topos scale benchmark (#377): a pre-merge gate, not a per-push CI job. See README.md.
//   node scripts/topos-bench/drive.ts <recording.pages> [more.pages ...]
// First it runs the Rust lane-pass budget test in the release profile: at most 1 µs per row.
// Then, for each recording (from dump-pages.ts), it builds the benchmark page for production,
// serves it with Quay's release CSP, opens it in Edge (WebView2's engine), replays the recording
// into the real GraphFeed and GraphList, and checks the spec's Scale budgets:
// - first rows on screen at most 300 ms after the session opens;
// - frontend memory at most 300 B per loaded row;
// - main-thread ingest at most 8 ms per 512-row page at p95;
// - the last row reachable, by the scrollbar and by End;
// - one wheel event moving the content by exactly its deltaY;
// - p95 frame at most 16.8 ms, with at most 1% of frames over 20 ms, on steady, fling and
//   random-jump scrolling.
// It prints one JSON line per recording and a verdict table, and exits 1 when a budget is missed.

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { BenchState } from "./page/benchState.ts";
import { ROW_HEIGHT } from "../../src/slices/git/topos/graphWindow.ts";
import { MAX_SPACER_HEIGHT } from "../../src/slices/git/topos/scaledScroll.ts";

const BUDGET = {
  firstRowsMs: 300,
  heapBytesPerRow: 300,
  ingestP95Ms: 8,
  frameP95Ms: 16.8,
  slowFrameMs: 20,
  slowFrameShare: 0.01,
};
/** Seconds each scroll run lasts. */
const RUN_SECONDS = 5;
const VIEWPORT = { width: 1600, height: 1000 };

const recordings = process.argv.slice(2);
if (recordings.length === 0 || recordings.some((r) => r.startsWith("-"))) {
  console.error("usage: node scripts/topos-bench/drive.ts <recording.pages> [more.pages ...]");
  process.exit(2);
}
for (const r of recordings) {
  if (!existsSync(r) || !statSync(r).isFile()) {
    console.error(`${r}: no such recording; make one with dump-pages.ts`);
    process.exit(2);
  }
  if (!existsSync(`${r}.json`)) {
    console.error(`${r}.json: no first-page time; record ${r} again with dump-pages.ts`);
    process.exit(2);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outDir = join(tmpdir(), "quay-topos-bench", "dist");

/** Runs one ignored Rust budget test in the release profile; true when it passes. */
function rustBudget(test: string): boolean {
  const run = spawnSync("cargo", ["test", "--release", "--lib", "--", "--ignored", "--nocapture", "--exact", test], {
    cwd: join(repoRoot, "src-tauri"),
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  process.stdout.write(run.stdout ?? "");
  return run.status === 0;
}

// The lane pass runs in Rust before the recording is made, so its budget has its own test. So does
// a refresh (#379), which happens in the Rust session against a live repo, not a recording.
const lanePassOk = rustBudget("slices::git::graph::lanes::tests::lane_pass_costs_at_most_a_microsecond_per_row");
const refreshOk = rustBudget(
  "slices::git::graph::refresh_tests::a_refresh_with_20k_loaded_rows_takes_at_most_250_ms"
);

// A production build: dev-mode React costs several times more per render and would skew frames.
await build({
  root: join(here, "page"),
  configFile: false,
  base: "./",
  plugins: [react(), tailwindcss()],
  logLevel: "warn",
  build: { outDir, emptyOutDir: true },
});

// Quay's release CSP, plus connect-src 'self' so the page can fetch its recording; the app gets
// rows over IPC instead.
const conf = JSON.parse(readFileSync(join(repoRoot, "src-tauri/tauri.conf.json"), "utf8"));
const directives: Record<string, string[]> = { ...conf.app.security.csp };
directives["connect-src"] = [...(directives["connect-src"] ?? []), "'self'"];
const csp = Object.entries(directives)
  .map(([name, sources]) => [name, ...sources].join(" "))
  .join("; ");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
let current = recordings[0];
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const headers = { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
  if (path === "/pages") {
    res.writeHead(200, { ...headers, "Content-Type": "application/octet-stream" });
    createReadStream(current).pipe(res);
    return;
  }
  const file = resolve(outDir, `.${path === "/" ? "/index.html" : path}`);
  if (!file.startsWith(outDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, headers).end();
    return;
  }
  res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("the server has no port");
const origin = `http://127.0.0.1:${address.port}`;

// The heap is weighed after a full GC, so it needs unrounded performance.memory.
const browser = await chromium.launch({
  channel: "msedge",
  headless: false,
  args: ["--enable-precise-memory-info"],
});
// Each recording gets its own context, so the last recording's store can't sit in the heap the
// next one weighs.
let page = await browser.newPage({ viewport: VIEWPORT });
const LIST = '[role="listbox"][aria-label="Commits"]';

const frames = (n: number) =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        let i = 0;
        const tick = () => (++i >= n ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n
  );

/**
 * The page's JS heap in bytes once garbage is gone, ArrayBuffer backing stores included. The GC
 * is DevTools' own, run between the page's tasks: a gc() called from inside the page's own tasks
 * leaves garbage behind, a different amount each run, so its readings sit above what a heap
 * snapshot holds. V8 can free backing stores a little after the GC that finds them dead, so this
 * collects and reads until the heap stops shrinking.
 */
async function settledHeap(): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  let least = Infinity;
  for (let quiet = 0; quiet < 3; ) {
    await cdp.send("HeapProfiler.collectGarbage");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const used = await page.evaluate(
      () => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize
    );
    quiet = used < least ? 0 : quiet + 1;
    least = Math.min(least, used);
  }
  await cdp.detach();
  return least;
}

/** The last row is on screen, inside the list's box. */
const lastRowShown = (rows: number) =>
  page.evaluate(
    ({ list, rows }) => {
      const el = document.querySelector(list) as HTMLElement;
      const row = el.querySelector(`[role="option"][aria-posinset="${rows}"]`);
      if (!row) return false;
      const box = el.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
    },
    { list: LIST, rows }
  );

/** The content offset on screen, in px: how far the list's top edge is below row 0's top. */
const contentOffset = () =>
  page.evaluate(
    ({ list, rowPx }) => {
      const el = document.querySelector(list) as HTMLElement;
      const row = el.querySelector('[role="option"]') as HTMLElement;
      const index = Number(row.getAttribute("aria-posinset")) - 1;
      return index * rowPx + el.getBoundingClientRect().top - row.getBoundingClientRect().top;
    },
    { list: LIST, rowPx: ROW_HEIGHT }
  );

/**
 * Across `act`: how far the content moved, in px, and the deltaY, in px, of the wheel events the
 * list received. Edge reports a 100 px wheel from Playwright as deltaY 300 (#370 saw the same).
 */
async function wheelMoves(act: () => Promise<void>): Promise<{ moved: number; deltaY: number }> {
  await page.evaluate((list) => {
    const w = window as unknown as { __deltaY: number; __counting?: boolean };
    w.__deltaY = 0;
    if (w.__counting) return;
    w.__counting = true;
    (document.querySelector(list) as HTMLElement).addEventListener(
      "wheel",
      (e) => {
        if (e.deltaMode !== 0) throw new Error(`a wheel in deltaMode ${e.deltaMode}; the check counts pixels`);
        w.__deltaY += e.deltaY;
      },
      { capture: true, passive: true }
    );
  }, LIST);
  const before = await contentOffset();
  await act();
  // Natively the browser animates a wheel; scaled the content moves at once.
  await frames(30);
  const moved = (await contentOffset()) - before;
  const deltaY = await page.evaluate(() => (window as unknown as { __deltaY: number }).__deltaY);
  return { moved, deltaY };
}

interface FrameStats {
  frames: number;
  fps: number;
  p95: number;
  max: number;
  slow: number;
  pass: boolean;
}

/**
 * Float noise left by subtracting two timestamps, such as 16.800000000000182 for a 16.8 ms frame.
 * The budget allows only this much over its limit: a nanosecond, not the 0.05 ms that rounding
 * to the budget's 0.1 ms would.
 */
const FLOAT_NOISE_MS = 1e-6;

function frameStats(deltas: number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b);
  const sum = deltas.reduce((a, b) => a + b, 0);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const slow = deltas.filter((d) => d > BUDGET.slowFrameMs).length;
  return {
    frames: deltas.length,
    fps: Math.round((deltas.length * 1000) / Math.max(1, sum)),
    p95: Math.round(p95 * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] ?? 0),
    slow,
    pass:
      deltas.length > 0 &&
      p95 <= BUDGET.frameP95Ms + FLOAT_NOISE_MS &&
      slow <= deltas.length * BUDGET.slowFrameShare,
  };
}

/** Records frame intervals in the page while `drive` runs. */
async function measureFrames(drive: () => Promise<void>): Promise<FrameStats> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__frames = [];
    w.__recording = true;
    let prev = 0;
    const tick = (now: number) => {
      if (prev !== 0) w.__frames.push(now - prev);
      prev = now;
      if (w.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await drive();
  const deltas = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__recording = false;
    return w.__frames;
  });
  return frameStats(deltas);
}

/** Real wheel input through the browser, at `pxPerSecond` of deltaY, for RUN_SECONDS. */
async function wheelAt(pxPerSecond: number): Promise<void> {
  const start = performance.now();
  let prev = start;
  while (performance.now() - start < RUN_SECONDS * 1000) {
    const now = performance.now();
    await page.mouse.wheel(0, (pxPerSecond * (now - prev)) / 1000);
    prev = now;
  }
}

/** A scrollbar jump to a random place every frame, for RUN_SECONDS. */
async function randomJumps(): Promise<void> {
  await page.evaluate(
    ({ list, ms }) =>
      new Promise<void>((done) => {
        const el = document.querySelector(list) as HTMLElement;
        const end = performance.now() + ms;
        const tick = (now: number) => {
          el.scrollTop = Math.random() * (el.scrollHeight - el.clientHeight);
          if (now < end) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      }),
    { list: LIST, ms: RUN_SECONDS * 1000 }
  );
}

const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * q)] ?? 0;
const results = [];
let allPass = true;

for (const [i, recording] of recordings.entries()) {
  current = recording;
  if (i > 0) {
    await page.context().close();
    page = await browser.newPage({ viewport: VIEWPORT });
  }
  await page.goto(`${origin}/?pages=/pages`);
  await page.waitForFunction(() => window.__toposBench?.phase === "ready");
  const heapBeforeBytes = await settledHeap();
  await page.evaluate(() => window.__toposBenchStart());
  await page.waitForFunction(
    () => window.__toposBench.phase === "done" || window.__toposBench.phase === "failed",
    null,
    { timeout: 900_000, polling: 1000 }
  );
  const heapAfterBytes = await settledHeap();
  const state: BenchState = await page.evaluate(() => window.__toposBench);
  if (state.phase === "failed") throw new Error(`${recording}: ${state.error}`);
  if (state.firstRowsMs === null) throw new Error(`${recording}: no rows reached the screen`);
  await frames(10);
  // The session's ms to its first Rows page, plus the page's ms from that page to the screen.
  // Only the Tauri IPC hop between the two is left out.
  const { firstPageMs } = JSON.parse(readFileSync(`${recording}.json`, "utf8")) as { firstPageMs: number };
  const firstRowsMs = firstPageMs + state.firstRowsMs;
  const heapBytesPerRow = (heapAfterBytes - heapBeforeBytes) / state.rows;
  const ingestP95 = quantile(state.ingestMs, 0.95);
  const list = page.locator(LIST);
  const box = await list.boundingBox();
  if (!box) throw new Error("the commit list is not on screen");
  const scrollHeight = await list.evaluate((el) => el.scrollHeight);
  const scaled = state.rows * ROW_HEIGHT > MAX_SPACER_HEIGHT;

  // Reachability: the scrollbar dragged to the very bottom, then Home and End from the keyboard.
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await frames(6);
  const lastByScrollbar = await lastRowShown(state.rows);
  await list.focus();
  await page.keyboard.press("Home");
  await frames(6);
  await page.keyboard.press("End");
  // Natively the browser animates End.
  await frames(60);
  const lastByEnd = await lastRowShown(state.rows);

  // Wheel fidelity from the middle: one 100 px event, then ten.
  await list.evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  });
  await frames(6);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const oneWheel = await wheelMoves(() => page.mouse.wheel(0, 100));
  const tenWheels = await wheelMoves(async () => {
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 100);
  });

  await page.keyboard.press("Home");
  await frames(6);
  const steady = await measureFrames(() => wheelAt(3_000));
  await page.keyboard.press("Home");
  await frames(6);
  const fling = await measureFrames(() => wheelAt(15_000));
  const jumps = await measureFrames(randomJumps);

  const checks = {
    firstRows: firstRowsMs <= BUDGET.firstRowsMs,
    memory: heapBytesPerRow <= BUDGET.heapBytesPerRow,
    ingest: ingestP95 <= BUDGET.ingestP95Ms,
    lastRow: lastByScrollbar && lastByEnd,
    // Natively the browser owns the wheel, and for Playwright's wheel it scrolls 100 px while
    // reporting deltaY 300, so the check is for scaled lists, where Topos moves the content.
    wheel: !scaled || [oneWheel, tenWheels].every((w) => w.deltaY > 0 && Math.abs(w.moved - w.deltaY) < 0.5),
    steady: steady.pass,
    fling: fling.pass,
    jumps: jumps.pass,
  };
  const pass = Object.values(checks).every(Boolean);
  allPass &&= pass;
  const result = {
    recording,
    rows: state.rows,
    pages: state.ingestMs.length,
    loadMs: Math.round(state.loadMs),
    firstPageMs,
    firstRowsMs: Math.round(firstRowsMs),
    heapBytesPerRow: Math.round(heapBytesPerRow),
    ingestP95Ms: Math.round(ingestP95 * 100) / 100,
    ingestMaxMs: Math.round(Math.max(0, ...state.ingestMs) * 100) / 100,
    scrollHeight,
    scaled,
    lastByScrollbar,
    lastByEnd,
    oneWheel,
    tenWheels,
    steady,
    fling,
    jumps,
    checks,
    pass,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

await browser.close();
server.close();

const mark = (ok: boolean) => (ok ? "pass" : "MISS");
const wheelCell = (w: { moved: number; deltaY: number }) => `${w.moved.toFixed(1)} of ${w.deltaY.toFixed(1)} px`;
const frameCell = (f: FrameStats) => `${f.p95} ms, ${f.slow}/${f.frames} > 20 ms (${mark(f.pass)})`;
allPass &&= lanePassOk && refreshOk;
console.log(`\nLane pass, at most 1 µs per row: ${mark(lanePassOk)}`);
console.log(`Refresh with 20k loaded rows, at most 250 ms: ${mark(refreshOk)}`);
console.log(
  "\n| Recording | Rows | First rows | Memory per row | Ingest p95 (max) | Last row | Wheel: moved of deltaY, 1 and 10 events | Steady | Fling | Jumps |"
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of results) {
  console.log(
    `| ${r.recording.split(/[\\/]/).pop()} | ${r.rows.toLocaleString("en-US")} | ${r.firstRowsMs} ms (${mark(r.checks.firstRows)}) | ${r.heapBytesPerRow} B (${mark(r.checks.memory)}) | ${r.ingestP95Ms} (${r.ingestMaxMs}) ms (${mark(r.checks.ingest)}) | ${mark(r.checks.lastRow)} | ${r.scaled ? `${wheelCell(r.oneWheel)}, ${wheelCell(r.tenWheels)} (${mark(r.checks.wheel)})` : "native"} | ${frameCell(r.steady)} | ${frameCell(r.fling)} | ${frameCell(r.jumps)} |`
  );
}
console.log(allPass ? "\nEvery budget met." : "\nA budget was missed.");
process.exit(allPass ? 0 : 1);
