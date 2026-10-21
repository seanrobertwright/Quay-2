// Records a tutorial's clip from a page over CDP and encodes it with ffmpeg: the parts of a clip
// that need a browser page but not Quay itself. clipFrames in capture.ts lays out its frames, and
// README.md beside this file says what a clip covers.

import { execFileSync } from 'node:child_process';
import { copyFileSync, linkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { clipFrames, type ClipFrame } from './capture.ts';

/** How often masks are matched again while a clip records, for elements that appear during it. */
const MASK_MS = 100;
/** How long after a paint its screencast frame can arrive. */
const FRAME_LAG_MS = 50;
/**
 * How long to wait for the screencast's first frame, which can come a few hundred milliseconds
 * after it starts, before the step goes on without it.
 */
const FIRST_FRAME_MS = 1000;
/** The frame rate a clip is encoded at; each screencast frame shows for as long as it was on screen. */
const FPS = 30;

/**
 * In the page: covers each element with a box of `colour` that follows it on every frame until
 * `uncoverInPage` runs, so a mask stays on an element that moves during a clip. An element
 * already covered is skipped, so it can be called again for elements that have appeared since.
 * Returns how many elements it newly covered.
 */
function coverInPage(elements: Element[], colour: string): number {
  const host = window as unknown as { quayCaptureCovers?: Map<Element, HTMLElement> };
  const place = (element: Element, cover: HTMLElement) => {
    const box = element.getBoundingClientRect();
    Object.assign(cover.style, {
      display: element.isConnected && box.width > 0 && box.height > 0 ? 'block' : 'none',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  };
  let covers = host.quayCaptureCovers;
  if (covers === undefined) {
    const own = new Map<Element, HTMLElement>();
    covers = own;
    host.quayCaptureCovers = own;
    const follow = () => {
      if (host.quayCaptureCovers !== own) return;
      for (const [element, cover] of own) place(element, cover);
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }
  let added = 0;
  for (const element of elements) {
    if (covers.has(element)) continue;
    const cover = document.createElement('div');
    cover.dataset.quayCapture = '';
    Object.assign(cover.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483646', background: colour });
    document.body.append(cover);
    covers.set(element, cover);
    place(element, cover);
    added++;
  }
  return added;
}

/** In the page: removes the covers `coverInPage` drew and stops them following their elements. */
function uncoverInPage() {
  const host = window as unknown as { quayCaptureCovers?: Map<Element, HTMLElement> };
  host.quayCaptureCovers?.forEach((cover) => cover.remove());
  delete host.quayCaptureCovers;
}

export interface ClipRecording {
  /** Stops the screencast and removes the masks, once however often it is called; resolves to when the clip started and its frames. */
  stop(): Promise<{ start: number; frames: ClipFrame[] }>;
}

/**
 * Starts recording a clip from the CDP screencast. Each frame the page paints is saved in `dir`
 * as a PNG, with the time it arrived. Each of `masks` is covered in `colour` for the whole clip,
 * and matched again as the clip runs, for elements that appear in it. Frames that may show such
 * an element before it was covered are left out, so the frame before them stays on screen.
 */
export async function startClip(page: Page, masks: Locator[], colour: string, dir: string): Promise<ClipRecording> {
  mkdirSync(dir, { recursive: true });
  // Spans of arrival times whose frames may show an element before its cover: from the start of
  // the pass before the one that covered it to just after that pass.
  const uncovered: [number, number][] = [];
  let lastPass = Date.now();
  let passing = false;
  const cover = async () => {
    if (passing) return;
    passing = true;
    try {
      const pass = Date.now();
      const added = await Promise.all(masks.map((mask) => mask.evaluateAll(coverInPage, colour)));
      if (added.some((n) => n > 0)) uncovered.push([lastPass, Date.now() + FRAME_LAG_MS]);
      lastPass = pass;
    } finally {
      passing = false;
    }
  };
  await cover();
  // The first pass covers everything before the screencast starts, so it leaves no frame out.
  uncovered.length = 0;
  const timer = setInterval(() => void cover().catch(() => {}), MASK_MS);
  try {
    const cdp = await page.context().newCDPSession(page);
    const frames: ClipFrame[] = [];
    let firstFrame = () => {};
    const sawFirstFrame = new Promise<void>((resolve) => (firstFrame = resolve));
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      const at = Date.now();
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      const file = `${String(frames.length).padStart(5, '0')}.png`;
      writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
      frames.push({ file, at });
      firstFrame();
    });
    const size = await page.evaluate(() => ({ width: Math.round(window.innerWidth * window.devicePixelRatio), height: Math.round(window.innerHeight * window.devicePixelRatio) }));
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
    // The step starts once the clip can see it; a page that paints nothing sends no frame yet.
    await Promise.race([sawFirstFrame, new Promise((resolve) => setTimeout(resolve, FIRST_FRAME_MS))]);
    const start = Date.now();
    let stopped: Promise<{ start: number; frames: ClipFrame[] }> | undefined;
    return {
      stop: () =>
        (stopped ??= (async () => {
          clearInterval(timer);
          try {
            await cdp.send('Page.stopScreencast');
            await cdp.detach();
          } finally {
            await page.evaluate(uncoverInPage);
          }
          return { start, frames: frames.filter(({ at }) => !uncovered.some(([from, to]) => at > from && at <= to)) };
        })()),
    };
  } catch (error) {
    clearInterval(timer);
    await page.evaluate(uncoverInPage).catch(() => {});
    throw error;
  }
}

/** Fails unless `ffmpeg` runs and can encode H.264, which a clip's MP4 needs. */
export function checkFfmpeg(ffmpeg: string) {
  let encoders: string;
  try {
    encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error(`capture.json has a clip, which needs ffmpeg, and ${ffmpeg} did not run; install ffmpeg or pass --ffmpeg`);
  }
  if (!/\blibx264\b/.test(encoders)) throw new Error(`${ffmpeg} has no libx264 encoder, which a clip's H.264 MP4 needs`);
}

/**
 * Encodes the frames a clip recorded in `dir`, from `start` to `end`, at real speed as a silent
 * H.264 MP4 at `file`, tagged BT.709 so a browser shows its colours as the still beside it, its
 * poster, has them.
 */
export function encodeClip(ffmpeg: string, dir: string, frames: ClipFrame[], start: number, end: number, file: string) {
  // One file per frame of the clip, so ffmpeg reads them at a constant rate; a frame on screen
  // for longer is linked again, not copied.
  clipFrames(frames, start, end, FPS).forEach((frame, k) => {
    const link = join(dir, `clip-${String(k).padStart(5, '0')}.png`);
    try {
      linkSync(join(dir, frame), link);
    } catch {
      copyFileSync(join(dir, frame), link);
    }
  });
  const encoded = join(dir, 'clip.mp4');
  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(FPS), '-i', join(dir, 'clip-%05d.png'),
    '-an', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', encoded,
  ];
  try {
    execFileSync(ffmpeg, ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`ffmpeg could not encode the clip${stderr ? `:\n${stderr}` : ''}`);
  }
  copyFileSync(encoded, file);
}
