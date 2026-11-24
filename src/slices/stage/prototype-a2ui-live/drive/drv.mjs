import { createRequire } from "node:module";
import { readFileSync, existsSync, rmSync } from "node:fs";
const require = createRequire("C:/scratch/quay-worktree/package.json");
const { chromium } = require("playwright-core");
export const Q = "C:/scratch/q711";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function attach(port = 19711) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find((p) => p.url().includes("tauri.localhost"));
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp };
}
export const inv = (page, cmd, args = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
export const terminals = (page) => inv(page, "list_terminals");
/** Types a call of the fake CLI into a Quay terminal. */
export async function callIn(page, terminalId, tool, name, out = `${name}-${Math.floor(performance.now())}`) {
  const file = `${Q}/out/${out}.json`;
  if (existsSync(file)) rmSync(file);
  await inv(page, "write_pty", { terminalId, data: `Start-Process -NoNewWindow node -ArgumentList "${Q}/call.mjs","${tool}","${Q}/args/${name}.json","${file}"\r` });
  return file;
}
export async function until(f, ms = 15000, every = 50) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${f}`);
    await sleep(every);
  }
}
export const result = (file, ms = 20000) => until(() => existsSync(file) && readFileSync(file, "utf8").trim() && JSON.parse(readFileSync(file, "utf8")), ms);
export const quayLog = () => readFileSync(`${Q}/out/quay.log`, "utf8").split(/\r?\n/).filter(Boolean);
export const events = (page) => page.evaluate(() => window.__a2ui711.probe.events);
/** Sends lone key presses through CDP, with no wait for the page between them. */
export async function typeKeys(cdp, text, gapMs) {
  let at = performance.now();
  for (const ch of text) {
    const key = { key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: ch === " " ? 32 : ch.toUpperCase().charCodeAt(0), code: ch === " " ? "Space" : `Key${ch.toUpperCase()}` };
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key, text: undefined });
    at += gapMs;
    const wait = at - performance.now();
    if (wait > 0) await sleep(wait);
  }
}
