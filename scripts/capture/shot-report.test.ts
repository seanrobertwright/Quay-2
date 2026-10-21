import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { compareShot, renderShotReport, reportShots, shotReportDir, type TutorialShots } from './shot-report.ts';

const WIDTH = 64;
const HEIGHT = 40;

/** A lossless WebP of a dark window, with `paint` changing pixels of the raw RGBA first. */
async function webp(paint: (rgba: Uint8Array) => void = () => {}, width = WIDTH, height = HEIGHT): Promise<Buffer> {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([13, 17, 23, 255], i);
  paint(rgba);
  return sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
}

const pixel = (x: number, y: number) => (y * WIDTH + x) * 4;

test('a shot the same as the committed one is unchanged', async () => {
  const shot = await webp();
  const result = await compareShot('03-reply', shot, shot);
  assert.equal(result.status, 'unchanged');
  assert.equal(result.changedPixels, 0);
  assert.equal(result.diff, null);
});

test('a luminance step of 1 in 255 on a few dozen pixels, as repeated captures differ, is unchanged', async () => {
  const before = await webp();
  const after = await webp((rgba) => {
    for (let x = 10; x < 50; x++) {
      const at = pixel(x, 20);
      rgba[at] += 1;
      rgba[at + 1] += 1;
      rgba[at + 2] += 1;
    }
  });
  assert.notDeepEqual(before, after, 'the files differ byte for byte');
  const result = await compareShot('03-reply', before, after);
  assert.equal(result.status, 'unchanged');
  assert.equal(result.changedPixels, 0);
});

test('a shot that shows something new is changed, with the pixels past the tolerance counted and a diff image', async () => {
  const before = await webp();
  const after = await webp((rgba) => {
    for (let y = 5; y < 15; y++) for (let x = 20; x < 40; x++) rgba.set([240, 136, 62, 255], pixel(x, y));
  });
  const result = await compareShot('03-reply', before, after);
  assert.equal(result.status, 'changed');
  assert.ok(result.changedPixels >= 10 * 20 - 2 * (10 + 20) && result.changedPixels <= 10 * 20, `${result.changedPixels} pixels`);
  assert.deepEqual([result.oldSize, result.newSize], [{ width: WIDTH, height: HEIGHT }, { width: WIDTH, height: HEIGHT }]);
  assert.ok(result.diff !== null);
  const diff = await sharp(result.diff).metadata();
  assert.deepEqual([diff.format, diff.width, diff.height], ['png', WIDTH, HEIGHT]);
});

test('a shot of another size is changed in every pixel, with no diff image', async () => {
  const result = await compareShot('03-reply', await webp(), await webp(() => {}, WIDTH, HEIGHT + 2));
  assert.equal(result.status, 'changed');
  assert.equal(result.changedPixels, WIDTH * (HEIGHT + 2));
  assert.deepEqual(result.oldSize, { width: WIDTH, height: HEIGHT });
  assert.equal(result.diff, null);
});

test('a shot with nothing committed is new', async () => {
  const result = await compareShot('03-reply', null, await webp());
  assert.equal(result.status, 'new');
  assert.equal(result.oldSize, null);
  assert.deepEqual(result.newSize, { width: WIDTH, height: HEIGHT });
});

test('a shot that is not an image fails with its name', async () => {
  await assert.rejects(compareShot('03-reply', Buffer.from('not an image'), await webp()), /03-reply/);
});

test("a release's report folder is named after the Quay version captured", () => {
  assert.equal(shotReportDir(join('E:', 'repo'), '0.3.0'), join('E:', 'repo', 'capture-reports', '0.3.0'));
});

test("the report for a release gathers every tutorial captured for it, and a recapture replaces that tutorial's section", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'shot-report-')), '0.3.0');
  const old = await webp();
  const moved = await webp((rgba) => rgba.set([240, 136, 62, 255], pixel(1, 1)));

  const first = await reportShots({
    dir,
    tutorial: 'hello-a2a',
    quayVersion: '0.3.0',
    capturedOn: '2026-10-21',
    shots: [
      { name: '01-get-the-starter', committed: old, captured: old },
      { name: '02-two-agents', committed: old, captured: moved },
      { name: '03-reply', committed: null, captured: old },
    ],
  });
  assert.deepEqual(first.shots.map((s) => [s.name, s.status]), [['01-get-the-starter', 'unchanged'], ['02-two-agents', 'changed'], ['03-reply', 'new']]);
  for (const file of ['02-two-agents.old.webp', '02-two-agents.new.webp', '02-two-agents.diff.png', '03-reply.new.webp']) {
    assert.ok(existsSync(join(dir, 'hello-a2a', file)), file);
  }
  assert.ok(!existsSync(join(dir, 'hello-a2a', '01-get-the-starter.new.webp')), 'an unchanged shot keeps no copy');
  assert.deepEqual(readFileSync(join(dir, 'hello-a2a', '02-two-agents.old.webp')), old);

  await reportShots({ dir, tutorial: 'first-swarm', quayVersion: '0.3.0', capturedOn: '2026-10-21', shots: [{ name: '01-get-the-starter', committed: old, captured: old }] });
  let html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /hello-a2a/);
  assert.match(html, /first-swarm/);

  await reportShots({ dir, tutorial: 'hello-a2a', quayVersion: '0.3.0', capturedOn: '2026-10-22', shots: [{ name: '02-two-agents', committed: old, captured: old }] });
  assert.ok(!existsSync(join(dir, 'hello-a2a', '02-two-agents.new.webp')), "the recapture's section replaces the last one's images");
  html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /03-reply/);
  assert.match(html, /first-swarm/);
});

test('a tutorial from another release is refused, so one report covers one release', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shot-report-'));
  await reportShots({ dir, tutorial: 'first-swarm', quayVersion: '0.3.0', capturedOn: '2026-10-21', shots: [] });
  await assert.rejects(reportShots({ dir, tutorial: 'hello-a2a', quayVersion: '0.3.1', capturedOn: '2026-10-21', shots: [] }), /0\.3\.0[\s\S]*0\.3\.1/);
  assert.ok(!existsSync(join(dir, 'hello-a2a.json')), 'nothing is written for the refused capture');
});

test('a report file that is not one this script wrote is an error, not skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shot-report-'));
  writeFileSync(join(dir, 'first-swarm.json'), '{"tutorial": 3}');
  await assert.rejects(reportShots({ dir, tutorial: 'hello-a2a', quayVersion: '0.3.0', capturedOn: '2026-10-21', shots: [] }), /first-swarm\.json/);
});

const tutorial = (slug: string, statuses: TutorialShots['shots'][number]['status'][]): TutorialShots => ({
  tutorial: slug,
  quayVersion: '0.3.0',
  capturedOn: '2026-10-21',
  shots: statuses.map((status, i) => ({
    name: `0${i + 1}-shot`,
    status,
    changedPixels: status === 'changed' ? 1200 : 0,
    oldSize: status === 'new' ? null : { width: 2560, height: 1600 },
    newSize: { width: 2560, height: 1600 },
    diffImage: status === 'changed',
  })),
});

test('the report lists the tutorials with changed or new shots for the release re-run, in the order the docs list them', () => {
  const html = renderShotReport('0.3.0', [tutorial('hello-a2a', ['changed']), tutorial('first-swarm', ['unchanged']), tutorial('tdd-swarm-kata', ['new'])]);
  const rerun = /<ul class="rerun">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  assert.doesNotMatch(rerun, /first-swarm/);
  const order = ['first-swarm', 'tdd-swarm-kata', 'hello-a2a'].map((slug) => html.indexOf(`id="${slug}"`));
  assert.ok(order.every((at) => at > 0), 'each tutorial has a section');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections follow the docs order');
  assert.match(rerun, /tdd-swarm-kata[\s\S]*hello-a2a/);
});

test('a changed shot shows the committed one beside the new one and the diff, linked relative to the report', () => {
  const html = renderShotReport('0.3.0', [tutorial('hello-a2a', ['changed', 'new', 'unchanged'])]);
  assert.match(html, /src="hello-a2a\/01-shot\.old\.webp"[\s\S]*src="hello-a2a\/01-shot\.new\.webp"[\s\S]*src="hello-a2a\/01-shot\.diff\.png"/);
  assert.match(html, /src="hello-a2a\/02-shot\.new\.webp"/);
  assert.doesNotMatch(html, /02-shot\.old\.webp/);
  assert.doesNotMatch(html, /03-shot\.(old|new)\.webp/);
  assert.match(html, /1,200 pixels/);
});

test('a release with nothing changed says so, and the report escapes what it shows', () => {
  const html = renderShotReport('0.3.0', [{ ...tutorial('hello-a2a', ['unchanged']), capturedOn: '<b>2026</b>' }]);
  assert.match(html, /No tutorial needs a release re-run/);
  assert.doesNotMatch(html, /<b>2026/);
  assert.match(html, /&lt;b&gt;2026/);
});
