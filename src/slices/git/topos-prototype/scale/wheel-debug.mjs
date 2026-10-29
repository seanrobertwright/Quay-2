// PROTOTYPE (#370). One-off check of the scaled-mode wheel listener.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:1431/?commits=500000&scroll=scaled&k=0.8&width=resizable&clash=derived");
await page.waitForFunction(() => /Phase\s*done/.test(document.body.innerText), null, { timeout: 200_000, polling: 1000 });
const r = await page.evaluate(() => {
  const el = document.querySelector(".topos-scroll");
  const before = el.scrollTop;
  const ev = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
  el.querySelector("[role=option]").dispatchEvent(ev);
  return { prevented: ev.defaultPrevented, before, after: el.scrollTop, dpr: devicePixelRatio, sh: el.scrollHeight };
});
console.log(JSON.stringify(r));
await page.evaluate(() => {
  const el = document.querySelector(".topos-scroll");
  window.__w = [];
  el.addEventListener("wheel", (e) => window.__w.push({ dy: e.deltaY, mode: e.deltaMode, prevented: e.defaultPrevented, cancelable: e.cancelable }));
  el.scrollTop = el.scrollHeight / 2;
});
await page.waitForTimeout(500);
const box = await page.locator(".topos-scroll").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const t0 = await page.evaluate(() => document.querySelector(".topos-scroll").scrollTop);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(800);
const t1 = await page.evaluate(() => ({ top: document.querySelector(".topos-scroll").scrollTop, events: window.__w }));
console.log(JSON.stringify({ t0, ...t1 }));
await browser.close();
