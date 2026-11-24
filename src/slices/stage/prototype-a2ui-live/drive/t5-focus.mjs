// Who takes the focus away from a surface's input?
import { attach, inv, terminals, sleep, callIn, until, quayLog, events, typeKeys } from "./drv.mjs";
const { browser, page, cdp } = await attach();
const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
await page.reload();
await sleep(2500);
const agent = (await terminals(page)).find((t) => t.name === "agent-a");
await page.getByText(agent.name, { exact: true }).first().click();
await sleep(800);
if (!(await inv(page, "a2ui711_list")).some((r) => r.terminal_id === agent.id && r.id === "form")) {
  await callIn(page, agent.id, "quay_surface", "raw");
  await page.waitForSelector("[data-surface=form]");
} else await page.getByRole("radio", { name: "Surface" }).click();
await sleep(500);
await page.reload();
await sleep(2500);
await page.getByRole("radio", { name: "Surface" }).click();
await sleep(500);
await page.evaluate(() => {
  window.__f = [];
  const real = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...a) { window.__f.push({ at: Math.round(performance.now()), call: "focus()", el: this.className.slice(0, 40), stack: new Error().stack.split("\n").slice(2, 7).join(" < ") }); return real.apply(this, a); };
  addEventListener("focusin", (e) => window.__f.push({ at: Math.round(performance.now()), focusin: e.target.localName + "." + e.target.className.slice(0, 30) }), true);
  addEventListener("focusout", (e) => window.__f.push({ at: Math.round(performance.now()), focusout: e.target.localName }), true);
  addEventListener("blur", (e) => e.target === window && window.__f.push({ at: Math.round(performance.now()), windowblur: 1 }), true);
});
const note = page.locator("[data-surface=form] textarea");
for (const what of (process.argv[2] ?? "upd-status").split(",")) {
  await note.click();
  await page.evaluate(() => (window.__f.length = 0));
  const t0 = await page.evaluate(() => performance.now());
  const typing = typeKeys(cdp, "abcdefghij klmnopqrst ", 70);
  await sleep(500);
  if (what === "echo") await inv(page, "write_pty", { terminalId: agent.id, data: "echo hello\r" });
  else if (what !== "nothing") await callIn(page, agent.id, "quay_surface", what);
  await typing;
  await sleep(1500);
  log(what, "typed at", t0 | 0, "value", await note.inputValue(), "events", (await events(page)).slice(-3).map((e) => [e.what, e.at | 0]));
  for (const f of await page.evaluate(() => window.__f)) log("   ", f);
}
await browser.close();
