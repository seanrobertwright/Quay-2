// The verdict round trip for a 500-component surface.
import { attach, inv, terminals, sleep, callIn, until, result, quayLog, events, typeKeys, Q } from "./drv.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const { browser, page, cdp } = await attach();
const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
const agent = async () => (await terminals(page)).find((t) => t.name === "agent-a");
const parse = (from) => quayLog().slice(from).filter((l) => /call \d+ (VERDICT|NO VERDICT)/.test(l)).map((l) => { const m = /VERDICT (?:after )?([\d.]+)ms(?: \(webview ([\d.]+)ms\) components=(\S+) errors=(.*?) bytes=(\d+))?/.exec(l); return m ? { ms: +m[1], webview: +m[2], components: m[3], bytes: +m[5], no: /NO VERDICT/.test(l) } : l; });
const stat = (a) => { const s = a.map(Number).sort((x, y) => x - y); return `${s[0]} / ${s[Math.floor(s.length / 2)]} / ${s.at(-1)}`; };
async function series(label, name, count, tool = "quay_surface") {
  const from = quayLog().length;
  const a = await agent();
  const http = [];
  for (let i = 0; i < count; i++) {
    const r = await result(await callIn(page, a.id, tool, name, `t7-${name}-${i}`), 20000).catch((e) => ({ ms: -1 }));
    http.push(r.ms);
    await sleep(150);
  }
  const v = parse(from);
  log(label.padEnd(44), `n=${v.length} components=${v[0]?.components} verdict ms min/med/max ${stat(v.map((x) => x.ms))}; webview ${stat(v.map((x) => x.webview))}; whole HTTP call ${stat(http)}; verdict bytes ${v[0]?.bytes}`, v.filter((x) => x.no).length ? "NO VERDICT " + v.filter((x) => x.no).length : "");
}
const mode = process.argv[2] ?? "warm";
if (mode === "warm") {
  const a = await agent();
  await page.reload();
  await sleep(3000);
  await page.getByText(a.name, { exact: true }).first().click();
  await sleep(1500);
  await series("first call after a reload", "big", 1);
  await series("500 mixed components", "big", 15);
  await series("500 flat Texts", "flat", 10);
  await series("500 components, 2,000-character texts", "big-text", 10);
  await series("500 components, 250 kB data model", "heavy", 10);
  await series("501 components (refused)", "big-over", 5);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await series("500 mixed, webview CPU slowed 6x", "big", 8);
  await series("250 kB data model, CPU slowed 6x", "heavy", 5);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // While the operator types in the 500-component surface, which stays on screen
  await page.getByRole("radio", { name: "Surface" }).click();
  await sleep(600);
  await page.locator("[data-surface=heavyform] textarea, [data-surface=big] input:not([type=checkbox])").first().click();
  const typing = typeKeys(cdp, "abcdefghij ".repeat(25), 40);
  await series("500 mixed, operator typing", "flat", 5);
  await typing;
  // While another terminal prints without pause
  const other = (await terminals(page)).find((t) => t.name === "agent-b");
  await inv(page, "write_pty", { terminalId: other.id, data: "1..200000 | % { \"line $_ \" + ('x' * 80) }" + String.fromCharCode(13) });
  await sleep(500);
  await series("500 mixed, another terminal printing", "big", 8);
  await inv(page, "write_pty", { terminalId: other.id, data: String.fromCharCode(3) });
}
if (mode === "draw") {
  // From the check's arrival in the webview to the surface on screen
  const a = await agent();
  await page.getByText(a.name, { exact: true }).first().click();
  await sleep(500);
  if (await page.getByRole("radio", { name: "Surface" }).count()) await page.getByRole("radio", { name: "Surface" }).click();
  for (const [name, id] of [["bigask", "bigask"]]) {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.__d = null; const n0 = window.__a2ui711.probe.events.length; const f = () => { const ev = window.__a2ui711.probe.events.slice(n0); const s = ev.find((e) => e.what === "shown"); const c = ev.find((e) => e.what === "check"); if (s) { requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => (window.__d = { checkMs: c?.detail.ms, checkToShown: s.at - (c.at - c.detail.ms), shownToFrame: performance.now() - s.at, nodes: document.querySelectorAll("[data-surface=bigask] *").length }); ch.port2.postMessage(0); }); } else requestAnimationFrame(f); }; f(); });
      await callIn(page, a.id, "quay_surface", "big-ask");
      const d = await until(() => page.evaluate(() => window.__d));
      log("draw", d);
      await sleep(400);
    }
  }
}
if (mode === "hidden") {
  log("state", await page.evaluate(() => [document.visibilityState, document.hasFocus()]));
  await series(process.argv[3] ?? "as it is", "big", Number(process.argv[4] ?? 6));
}
if (mode === "reload") {
  // The call arrives while the webview is loading
  for (const how of [1, 2, 3, 4, 5]) {
    const a = await agent();
    const from = quayLog().length;
    const f = await callIn(page, a.id, "quay_surface", "big", `t7-reload-${how}`);
    await sleep(60 * how); // node needs about 250 ms to start, so the call lands in the reload
    await page.reload();
    const r = await result(f, 20000).catch(() => ({ ms: -1 }));
    log(`call started ${60 * how} ms before a reload:`, r.ms, JSON.stringify(r.answer)?.slice(0, 160), quayLog().slice(from).filter((l) => /CHECK|VERDICT|rebuilt|LIST/.test(l)).map((l) => l.slice(6, 80)));
    await sleep(1500);
  }
}
await browser.close();
