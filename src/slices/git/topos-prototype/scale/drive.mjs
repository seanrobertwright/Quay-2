// PROTOTYPE (#370). Drives the production build (pnpm proto:topos:prod, port 1431) in Edge,
// which shares WebView2's engine, and reports per size and scroll mode: load timings and
// JS heap, whether the last row can be reached, how many rows one wheel notch moves, and
// the page's own Steady / Fling / Jumps frame-rate benchmarks.
//   node scale/drive.mjs [commits,...] [native,scaled]
import { chromium } from "playwright-core";

const sizes = (process.argv[2] ?? "1000000,1500000,2000000").split(",").map(Number);
const modes = (process.argv[3] ?? "native,scaled").split(",");
const PRESET_C = "k=0.8&width=resizable&clash=derived";

const browser = await chromium.launch({ channel: "msedge", headless: false, args: ["--enable-precise-memory-info"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const hud = () => page.evaluate(() => {
  const out = {};
  for (const tr of document.querySelectorAll("tr, .topos-hud-row, dl > div")) {
    const cells = [...tr.children].map((c) => c.textContent.trim());
    if (cells.length >= 2) out[cells[0]] = cells[1];
  }
  return out;
});

const visibleRows = () => page.evaluate(() => {
  const list = document.querySelector(".topos-scroll");
  const box = list.getBoundingClientRect();
  const ids = [...list.querySelectorAll("[role=option]")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > box.top + 1 && r.top < box.bottom - 1; })
    .map((el) => Number(/-row-(\d+)$/.exec(el.id)[1]));
  return { min: Math.min(...ids), max: Math.max(...ids), scrollHeight: list.scrollHeight };
});

const frames = (n = 4) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

for (const n of sizes) {
  for (const mode of modes) {
    await page.goto(`http://localhost:1431/?commits=${n}&scroll=${mode}&${PRESET_C}`);
    await page.waitForFunction(() => /Phase\s*done/.test(document.body.innerText), null, { timeout: 300_000, polling: 500 });
    await frames(10);
    const h = await page.evaluate(() => document.body.innerText);
    const pick = (label) => (new RegExp(`${label}\\s*\\n?\\s*([^\\n]+)`).exec(h) ?? [])[1];
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const rows = Number((pick("Rows / edges") ?? "0").split("/")[0].replace(/[^\d]/g, ""));

    // Reachability: put the scrollbar at the very bottom, as a drag to the end would.
    await page.evaluate(() => { const el = document.querySelector(".topos-scroll"); el.scrollTop = el.scrollHeight; });
    await frames(6);
    const bottom = await visibleRows();

    // Wheel fidelity, from the middle: one notch (100 px) and ten notches.
    await page.evaluate(() => { const el = document.querySelector(".topos-scroll"); el.scrollTop = el.scrollHeight / 2; });
    await frames(6);
    const box = await page.locator(".topos-scroll").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await visibleRows();
    await page.mouse.wheel(0, 100);
    await frames(6);
    const one = await visibleRows();
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 100); await frames(2); }
    await frames(6);
    const ten = await visibleRows();

    const bench = {};
    for (const name of ["Steady", "Fling", "Jumps"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForFunction((name) => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent === name);
        return b && !b.disabled;
      }, name, { timeout: 60_000 });
      const row = await page.evaluate(() => [...document.querySelector(".topos-table tbody tr").children].map((c) => c.textContent));
      bench[name] = `${row[1]} fps, p95 ${row[2]} ms, ${row[4]} > 20 ms`;
    }

    console.log(JSON.stringify({
      commits: n, mode, rows,
      firstPage: pick("First page on screen"), allPages: pick("All pages"), lanePass: pick("Worker lane pass"),
      ingest: pick("Main-thread ingest"), heapMB: Math.round(heap / 1e6),
      scrollHeight: bottom.scrollHeight, lastRowReached: bottom.max, lastRow: rows - 1,
      wheel1RowsMoved: one.min - before.min, wheel10RowsMoved: ten.min - one.min, bench,
    }));
  }
}
await browser.close();
