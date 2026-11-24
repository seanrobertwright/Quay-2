// Draws the ask in the companion and answers it with real pointer and key input.
import { attach, inv, terminals, sleep, callIn, until, result, quayLog, events, Q } from "./drv.mjs";
const { browser, page, cdp } = await attach();
const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
await page.reload();
await until(() => page.evaluate(() => !!window.__a2ui711));
await sleep(2500);
const all = await terminals(page); const asker = all.find((t) => t.name === "agent-a"), other = all.find((t) => t.name === "agent-b");
for (const t of [asker, other]) { // both panes need an xterm to answer ConPTY's cursor query once
  await page.getByText(t.name, { exact: true }).first().click();
  await sleep(2500);
}
await page.getByText(asker.name, { exact: true }).first().click();
await sleep(500);
const S = "ask_" + (1 + (await inv(page, "a2ui711_list")).filter((r) => r.terminal_id === asker.id && r.id.startsWith("ask_")).length);
const file = await callIn(page, asker.id, "quay_ask", "ask", "ask-1");
await page.waitForSelector(`[data-surface=${S}]`, { timeout: 15000 });
await sleep(300);
const seen = () => page.evaluate((S) => {
  const c = document.querySelector(`[data-surface=${S}]`);
  const send = [...c.querySelectorAll("[data-ask-foot] button")][0];
  return {
    view: document.querySelector("[data-companion-view]").dataset.companionView,
    width: document.querySelector("aside[aria-label=Companion]").getBoundingClientRect().width,
    overflowX: c.scrollWidth - c.clientWidth,
    open: [...c.querySelectorAll("[data-question]")].map((q) => q.querySelector("button").getAttribute("aria-expanded")),
    inputs: [...c.querySelectorAll("input,textarea")].map((e) => [e.type, e.checked ?? null, e.type === "textarea" ? e.value : e.closest("label")?.innerText.split("\n")[0]]),
    sendDisabled: send.disabled,
    foot: c.querySelector("[data-ask-foot]").innerText.replace(/\s+/g, " "),
    hosts: [...new Set([...c.querySelectorAll("*")].map((e) => e.localName).filter((n) => n.includes("-")))],
    shadowRoots: [...c.querySelectorAll("*")].filter((e) => e.shadowRoot).length,
    labelled: [...c.querySelectorAll("input,textarea")].every((e) => e.labels?.length > 0),
    roles: [...c.querySelectorAll("[role=group]")].length,
  };
}, S);
log("1 drawn", await seen());
await page.screenshot({ path: `${Q}/out/ask-1.png`, clip: await page.locator("aside[aria-label=Companion]").boundingBox() });
// Send is held: a real click on a disabled button. engine-probe.mjs calls the engine's own action.
await page.locator(`[data-surface=${S}] [data-ask-foot] button`).click({ force: true });
await sleep(200);
log("2 actions after a click on the held Send", (await events(page)).filter((e) => e.what === "action").length);
await page.locator(`[data-surface=${S}]`).getByText("Merge master in").click();
await sleep(100);
await page.locator(`[data-surface=${S}] [data-question='0'] textarea`).fill("keep the tags");
await sleep(100);
log("3 first answered, second never opened", await seen());
await page.locator(`[data-surface=${S}]`).getByRole("button", { name: "Next" }).click();
await sleep(150);
log("4 second open", await seen());
await page.locator(`[data-surface=${S}] [data-question='1'] textarea`).fill("Say it is faster");
await sleep(100);
log("5 both answered", await seen());
await page.locator(`[data-surface=${S}] [data-question='0'] > button`).click();
await sleep(150);
log("6 first put back", await seen());
// Take the answer away again: Send must be held again.
await page.locator(`[data-surface=${S}] [data-question='1'] > button`).click();
await page.locator(`[data-surface=${S}] [data-question='1'] textarea`).fill("   ");
await sleep(100);
log("7 second emptied", (await seen()).sendDisabled);
await page.locator(`[data-surface=${S}] [data-question='1'] textarea`).fill("Say it is faster");
await sleep(100);
// The whole view goes and comes back.
await page.locator("[data-companion-view]").waitFor();
await page.getByRole("radio", { name: "Repository" }).first().click();
await sleep(200);
log("8 view away", await page.evaluate(() => [document.querySelector("[data-companion-view]").dataset.companionView, document.querySelectorAll("[data-surface]").length]));
await page.getByRole("radio", { name: "Surface" }).first().click();
await sleep(200);
log("9 view back", await seen());
// Another terminal and back.
await page.getByText(other.name, { exact: true }).first().click();
await sleep(400);
log("10 other terminal", await page.evaluate(() => [document.querySelector("[data-companion-view]").dataset.companionView, document.querySelectorAll("[data-surface]").length]));
await page.getByText(asker.name, { exact: true }).first().click();
await sleep(400);
if (!(await page.locator(`[data-surface=${S}]`).count())) await page.getByRole("radio", { name: "Surface" }).first().click();
await sleep(200);
log("11 back on the asker", await seen());
await page.screenshot({ path: `${Q}/out/ask-2.png`, clip: await page.locator("aside[aria-label=Companion]").boundingBox() });
await page.locator(`[data-surface=${S}] [data-ask-foot] button`).scrollIntoViewIfNeeded();
const box = await page.locator(`[data-surface=${S}] [data-ask-foot] button`).boundingBox();
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
log("12 call's result", await result(file));
await sleep(300);
log("13 actions", (await events(page)).filter((e) => /action|answer/.test(e.what)));
log("14 card", await page.evaluate(() => [...document.querySelectorAll("[data-settled]")].pop()?.innerText));
log("15 draft sends", (await events(page)).filter((e) => e.what.startsWith("draft")).map((e) => [e.what, e.detail]));
log("log", "\n" + quayLog().slice(-40).join("\n"));
await browser.close();
