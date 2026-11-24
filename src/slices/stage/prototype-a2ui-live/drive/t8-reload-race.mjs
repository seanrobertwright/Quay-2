// A call that lands while the webview reloads, at chosen moments; then how long 500 components take to draw.
import { attach, inv, terminals, sleep, until, result, quayLog, Q } from "./drv.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const { browser, page } = await attach();
const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
const big = JSON.parse(readFileSync(`${Q}/args/big-ask.json`, "utf8"));
const run = `${Math.floor(Date.now() / 1000) % 100000}`;
const go = async (agent, id, args, tool = "quay_surface") => {
  const a = `${Q}/args/${id}.json`, out = `${Q}/out/${id}.json`;
  writeFileSync(a, JSON.stringify(args));
  await inv(page, "write_pty", { terminalId: agent.id, data: `Start-Process -NoNewWindow node -ArgumentList "${Q}/gocall.mjs","${tool}","${a}","${out}"` + String.fromCharCode(13) });
  await until(() => existsSync(`${out}.ready`), 8000);
  return out;
};
const withId = (id, title = id) => { const c = structuredClone(big); c.title = title; c.messages[0].createSurface.surfaceId = id; return c; };
const agent = (await terminals(page)).find((t) => t.name === "agent-a");
const raw = JSON.parse(readFileSync(`${Q}/args/flat.json`, "utf8"));
if (process.argv[2] !== "draw")
  for (const offset of [0, 10, 20, 40, 60, 80, 100, 130, 160, 200, 250, 300, 400]) {
    const id = `rl${run}_${offset}`;
    const c = structuredClone(raw);
    c.messages[0].createSurface.surfaceId = id;
    const out = await go(agent, id, c);
    const from = quayLog().length;
    const loaded = page.reload({ waitUntil: "commit" }).catch(() => {});
    await sleep(offset);
    writeFileSync(`${out}.go`, "1");
    await loaded;
    const r = await result(out, 9000).catch(() => ({ ms: -1 }));
    const lines = quayLog().slice(from);
    const at = (re) => lines.find((l) => re.test(l))?.slice(6, 12);
    log(`offset ${offset} ms: HTTP ${r.ms} ms, ${r.answer?.result?.isError ? "REFUSED: " + r.answer.result.content[0].text.slice(0, 60) : "shown"}; check at ${at(/CHECK/)}, list at ${at(/LIST/)}`, lines.filter((l) => /VERDICT/.test(l)).map((l) => l.slice(13, 70)));
    await sleep(2500);
  }
else {
  await page.getByText(agent.name, { exact: true }).first().click();
  await sleep(1500);
  for (let i = 0; i < 5; i++) {
    const id = `dr${run}_${i}`;
    const out = await go(agent, id, withId(id));
    await page.evaluate((id) => {
      window.__d = null;
      const ev0 = window.__a2ui711.probe.events.length;
      const longs = [];
      const po = new PerformanceObserver((l) => longs.push(...l.getEntries().map((e) => Math.round(e.duration))));
      po.observe({ type: "long-animation-frame" });
      const f = () => {
        const ev = window.__a2ui711.probe.events.slice(ev0);
        const s = ev.find((e) => e.what === "shown"), c = ev.find((e) => e.what === "check");
        const el = document.querySelector(`[data-surface="${id}"]`);
        if (s && el?.querySelectorAll("*").length > 500) setTimeout(() => { po.disconnect(); window.__d = { checkMs: c.detail.ms, arrivedToShown: Math.round(s.at - c.at + c.detail.ms), shownToOnScreen: Math.round(window.__t - s.at), nodes: el.querySelectorAll("*").length, longFrames: longs }; }, 600), (window.__t = performance.now());
        else requestAnimationFrame(f);
      };
      f();
    }, id);
    writeFileSync(`${out}.go`, "1");
    log("draw", await until(() => page.evaluate(() => window.__d), 8000));
    await sleep(500);
  }
}
await browser.close();
