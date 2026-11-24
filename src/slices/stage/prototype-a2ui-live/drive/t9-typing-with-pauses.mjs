// Typing: 600 characters at 340 px, per key, against a plain textarea in the same place.
import { attach, inv, terminals, sleep, callIn, until, quayLog, events, typeKeys, Q } from "./drv.mjs";
import { writeFileSync } from "node:fs";
const { browser, page, cdp } = await attach();
await page.reload();
await until(() => page.evaluate(() => !!window.__a2ui711));
await sleep(2500);
const all = await terminals(page);
const agent = all.find((t) => t.name === "agent-a");
const noisy = all.find((t) => t.name === "agent-b");
await page.getByText(agent.name, { exact: true }).first().click();
await sleep(400);
const TEXT = "the quick brown fox jumps over the lazy dog and then ".repeat(20).slice(0, 600);
console.log("display", JSON.stringify(await page.evaluate(() => new Promise((r) => { const t = []; const f = (x) => { t.push(x); t.length < 120 ? requestAnimationFrame(f) : r({ hz: Math.round(1000 / ((t[119] - t[0]) / 119)), dpr: devicePixelRatio, vis: document.visibilityState, width: document.querySelector("aside[aria-label=Companion]").getBoundingClientRect().width }); }; requestAnimationFrame(f); }))));
await page.evaluate(() => {
  const m = (window.__m = { on: false, keys: [], long: [], ev: [] });
  addEventListener("keydown", (e) => {
    if (!m.on) return;
    const k = { t0: performance.now(), ts: e.timeStamp };
    m.keys.push(k);
    const ch = new MessageChannel();
    ch.port1.onmessage = () => (k.sync = performance.now() - k.t0);
    ch.port2.postMessage(0);
    requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => (k.frame = performance.now() - k.t0); c.port2.postMessage(0); });
  }, true);
  addEventListener("input", () => {
    const k = m.keys.at(-1);
    if (m.on && k && k.work === undefined) setTimeout(() => {}, 0), queueMicrotask(() => queueMicrotask(() => (k.work = performance.now() - k.t0)));
  });
  new PerformanceObserver((l) => { if (m.on) for (const e of l.getEntries()) m.long.push({ d: Math.round(e.duration), at: e.startTime }); }).observe({ type: "long-animation-frame" });
  new PerformanceObserver((l) => { if (m.on) for (const e of l.getEntries()) if (e.name === "keydown" || e.name === "input") m.ev.push({ n: e.name, d: e.duration, p: e.processingEnd - e.processingStart }); }).observe({ type: "event", durationThreshold: 16 });
});
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(10 * s[Math.min(s.length - 1, Math.floor(s.length * p))]) / 10; };
const rows = [];
async function run(label, selector, gap, text = TEXT) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.evaluate((s) => { document.querySelector(s); }, selector).catch(() => {});
  await sleep(300);
  const before = (await events(page)).length;
  const draws0 = await page.evaluate(() => ({ ...window.__a2ui711.draws }));
  await page.evaluate(() => Object.assign(window.__m, { on: true, keys: [], long: [], ev: [] }));
  const started = performance.now();
  for (let i = 0; i < text.length; i += 20) { await typeKeys(cdp, text.slice(i, i + 20), gap); await sleep(500); }
  const took = performance.now() - started;
  await sleep(1200);
  const m = await page.evaluate(() => { window.__m.on = false; return window.__m; });
  const draws1 = await page.evaluate(() => ({ ...window.__a2ui711.draws }));
  const value = await el.inputValue();
  const ev = (await events(page)).slice(before).filter((e) => e.what.startsWith("draft"));
  const work = m.keys.map((k) => k.work ?? 0), frame = m.keys.map((k) => k.frame), queued = m.keys.map((k) => k.t0 - k.ts);
  const row = {
    label, keys: m.keys.length, exact: value.endsWith(text), cps: Math.round(10 * text.length / (took / 1000)) / 10,
    "work p50": pct(work, 0.5), "work p95": pct(work, 0.95), "work max": pct(work, 1),
    "frame p50": pct(frame, 0.5), "frame p95": pct(frame, 0.95), "frame max": pct(frame, 1), "queue max": pct(queued, 1),
    "event>=16ms p95": m.ev.length ? pct(m.ev.map((e) => e.d), 0.95) : 0, "event max": m.ev.length ? Math.max(...m.ev.map((e) => e.d)) : 0,
    loaf: m.long.length, "loaf max": Math.max(0, ...m.long.map((l) => l.d)),
    drafts: ev.filter((e) => e.what === "draft-send").length, "diff ms": ev.filter((e) => e.detail?.diffMs !== undefined).map((e) => Math.round(e.detail.diffMs * 10) / 10).join(), "ack ms": ev.filter((e) => e.what === "draft-ack").map((e) => Math.round(e.detail.ms * 10) / 10).join(),
    draws: Object.fromEntries(Object.keys(draws1).map((k) => [k, draws1[k] - (draws0[k] ?? 0)])),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const newest = async (tool, name, idOf) => {
  const n = (await inv(page, "a2ui711_list")).length;
  await callIn(page, agent.id, tool, name);
  await until(async () => (await inv(page, "a2ui711_list")).length > n);
  const r = (await inv(page, "a2ui711_list")).at(-1);
  await page.waitForSelector(`[data-surface="${r.id}"]`, { timeout: 5000 }).catch(() => page.getByRole("radio", { name: "Surface" }).click());
  return `[data-surface="${r.id}"]`;
};
// Only one surface on screen at a time, so nothing else is measured: hide the rest.
const only = (sel) => page.evaluate((s) => { for (const e of document.querySelectorAll("[data-surface]")) e.style.display = e.matches(s) ? "" : "none"; }, sel);
const which = process.argv[2] ?? "all";
const ask = await newest("quay_ask", "ask");
await only(ask);
const PAUSED = TEXT;
globalThis.__paused = true;
await run("ask, 12.5/s with a 500 ms pause every 20 keys", `${ask} textarea`, 80);
writeFileSync(`${Q}/out/typing-paused.json`, JSON.stringify(rows, null, 1));
await browser.close();
