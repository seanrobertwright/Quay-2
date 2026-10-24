import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { compareShot, parseCatFileBatch, placeSavedShots, readSavedShot, releaseBase, renderShotReport, reportShots, shotReportDir, type TutorialShots } from './shot-report.ts';

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
    base: 'HEAD',
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

  await reportShots({ dir, tutorial: 'first-swarm', quayVersion: '0.3.0', capturedOn: '2026-10-21', base: 'HEAD', shots: [{ name: '01-get-the-starter', committed: old, captured: old }] });
  let html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /hello-a2a/);
  assert.match(html, /first-swarm/);

  await reportShots({ dir, tutorial: 'hello-a2a', quayVersion: '0.3.0', capturedOn: '2026-10-22', base: 'HEAD', shots: [{ name: '02-two-agents', committed: old, captured: old }] });
  assert.ok(!existsSync(join(dir, 'hello-a2a', '02-two-agents.new.webp')), "the recapture's section replaces the last one's images");
  html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /03-reply/);
  assert.match(html, /first-swarm/);
});

test('a report file that is not one this script wrote is an error, not skipped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shot-report-'));
  const report = (tutorial: string) => reportShots({ dir, tutorial, quayVersion: '0.3.0', capturedOn: '2026-10-21', base: 'HEAD', shots: [] });
  writeFileSync(join(dir, 'first-swarm.json'), '{"tutorial": 3}');
  await assert.rejects(report('hello-a2a'), /first-swarm\.json/);
  const section = { tutorial: 'first-swarm', quayVersion: '0.3.0', capturedOn: '2026-10-21', base: 'HEAD' };
  writeFileSync(join(dir, 'first-swarm.json'), JSON.stringify({ ...section, shots: [{}] }));
  await assert.rejects(report('hello-a2a'), /first-swarm\.json/, 'a shot entry is checked too');
  assert.ok(!existsSync(join(dir, 'hello-a2a.json')), 'nothing is written beside a bad section');
});

test("a shot that can't be read leaves the tutorial's last section and its images as they were", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shot-report-'));
  const old = await webp();
  const moved = await webp((rgba) => rgba.set([240, 136, 62, 255], pixel(1, 1)));
  const input = { dir, tutorial: 'hello-a2a', quayVersion: '0.3.0', capturedOn: '2026-10-21', base: 'HEAD' };
  await reportShots({ ...input, shots: [{ name: '02-two-agents', committed: old, captured: moved }] });
  const before = readFileSync(join(dir, 'hello-a2a.json'), 'utf8');
  await assert.rejects(reportShots({ ...input, shots: [{ name: '02-two-agents', committed: old, captured: Buffer.from('half written') }] }), /02-two-agents/);
  assert.equal(readFileSync(join(dir, 'hello-a2a.json'), 'utf8'), before);
  assert.ok(existsSync(join(dir, 'hello-a2a', '02-two-agents.new.webp')));
});

test('a capture waits for another one writing the same report, so neither loses its section', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shot-report-'));
  mkdirSync(join(dir, '.lock'));
  let done = false;
  const writing = reportShots({ dir, tutorial: 'hello-a2a', quayVersion: '0.3.0', capturedOn: '2026-10-21', base: 'HEAD', shots: [] }).then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(done, false, 'it waits while the folder is locked');
  assert.ok(!existsSync(join(dir, 'hello-a2a.json')));
  rmSync(join(dir, '.lock'), { recursive: true });
  await writing;
  assert.ok(existsSync(join(dir, 'hello-a2a.json')));
  assert.ok(!existsSync(join(dir, '.lock')), 'it lets go of the lock');
});

const tutorial = (slug: string, statuses: TutorialShots['shots'][number]['status'][]): TutorialShots => ({
  tutorial: slug,
  quayVersion: '0.3.0',
  capturedOn: '2026-10-21',
  base: 'HEAD',
  shots: statuses.map((status, i) => ({
    name: `0${i + 1}-shot`,
    status,
    changedPixels: status === 'changed' ? 1200 : 0,
    oldSize: status === 'new' ? null : { width: 2560, height: 1600 },
    newSize: { width: 2560, height: 1600 },
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

test('the baseline is HEAD until the capture for this release is committed', () => {
  assert.equal(releaseBase([], '0.3.0'), 'HEAD');
  assert.equal(releaseBase([{ commit: 'c2', parent: 'c1', quayVersion: '0.2.0' }], '0.3.0'), 'HEAD');
});

test("once the release's capture is committed, the baseline is the commit before its sidecar first named the release", () => {
  const history = [
    { commit: 'c4', parent: 'c3', quayVersion: '0.3.0' },
    { commit: 'c3', parent: 'c2', quayVersion: '0.3.0' },
    { commit: 'c2', parent: 'c1', quayVersion: '0.2.0' },
  ];
  assert.equal(releaseBase(history, '0.3.0'), 'c2');
  assert.equal(releaseBase([{ commit: 'c1', parent: null, quayVersion: '0.3.0' }], '0.3.0'), null, 'a first capture has nothing before it');
});

test("git cat-file --batch output is split into each file's bytes, or null for one that is missing", () => {
  const out = Buffer.concat([
    Buffer.from('1f2e blob 3\n'),
    Buffer.from([0x0a, 0x00, 0xff]),
    Buffer.from('\nHEAD:docs/02.webp missing\n'),
    Buffer.from('3c4d blob 0\n\n'),
  ]);
  assert.deepEqual(parseCatFileBatch(out, 3), [Buffer.from([0x0a, 0x00, 0xff]), null, Buffer.alloc(0)]);
  assert.throws(() => parseCatFileBatch(Buffer.from('HEAD:x ambiguous\n'), 1), /ambiguous/);
  assert.throws(() => parseCatFileBatch(Buffer.from('1f2e blob 3\nab'), 1), /git cat-file/);
});

test('a shot saved by hand is read as WebP, or converted from PNG, which Snipping Tool saves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'by-hand-'));
  assert.equal(await readSavedShot(dir, '02-two-agents', 90), null);
  const shot = await webp();
  writeFileSync(join(dir, '02-two-agents.webp'), shot);
  assert.deepEqual(await readSavedShot(dir, '02-two-agents', 90), shot);
  writeFileSync(join(dir, '03-reply.png'), await sharp(shot).png().toBuffer());
  const converted = await readSavedShot(dir, '03-reply', 90);
  assert.ok(converted !== null);
  assert.deepEqual([(await sharp(converted).metadata()).format, (await sharp(converted).metadata()).width], ['webp', WIDTH]);
});

test('shots saved by hand replace the stills of the same name beside the page, and name the ones left without a shot', async () => {
  const stills = mkdtempSync(join(tmpdir(), 'stills-'));
  const saved = mkdtempSync(join(tmpdir(), 'saved-'));
  const placeholder = await webp();
  for (const name of ['01-starter', '02-two-agents', '03-reply']) writeFileSync(join(stills, `${name}.webp`), placeholder);
  writeFileSync(join(stills, 'index.md'), '# Page\n');
  const shot = await webp((rgba) => rgba.set([255, 0, 0, 255], pixel(1, 1)));
  writeFileSync(join(saved, '01-starter.webp'), shot);
  writeFileSync(join(saved, '03-reply.png'), await sharp(shot).png().toBuffer());

  const result = await placeSavedShots(stills, saved, 90);

  assert.deepEqual(result, { placed: ['01-starter', '03-reply'], missing: ['02-two-agents'] });
  assert.deepEqual(readFileSync(join(stills, '01-starter.webp')), shot);
  assert.notDeepEqual(readFileSync(join(stills, '03-reply.webp')), placeholder);
  assert.deepEqual(readFileSync(join(stills, '02-two-agents.webp')), placeholder, 'a still with no shot is left as it was');
  rmSync(stills, { recursive: true });
  rmSync(saved, { recursive: true });
});

test('a shot saved by hand under a name no still has fails before any still is replaced', async () => {
  const stills = mkdtempSync(join(tmpdir(), 'stills-'));
  const saved = mkdtempSync(join(tmpdir(), 'saved-'));
  const placeholder = await webp();
  writeFileSync(join(stills, '01-starter.webp'), placeholder);
  writeFileSync(join(saved, '01-starter.webp'), await webp((rgba) => rgba.set([255, 0, 0, 255], pixel(1, 1))));
  writeFileSync(join(saved, '01-starer.png'), await sharp(placeholder).png().toBuffer());

  await assert.rejects(placeSavedShots(stills, saved, 90), /01-starer\.png is named after no still beside the page; the stills are 01-starter/);
  assert.deepEqual(readFileSync(join(stills, '01-starter.webp')), placeholder);
  rmSync(stills, { recursive: true });
  rmSync(saved, { recursive: true });
});
