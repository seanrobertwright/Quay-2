// Reloads, agent updates while the operator types, caret and IME.
import { attach, inv, terminals, sleep, callIn, until, result, quayLog, events, typeKeys, Q } from "./drv.mjs";
const { browser, page, cdp } = await attach();
const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
const agent = (await terminals(page)).find((t) => t.name === "agent-a");
const other = (await terminals(page)).find((t) => t.name === "agent-b");
const mine = async () => (await inv(page, "a2ui711_list")).filter((r) => r.terminal_id === agent.id);
const only = (sel) => page.evaluate((s) => { for (const e of document.querySelectorAll("[data-surface]")) e.style.display = e.matches(s) ? "" : "none"; }, sel);
const select = async (t) => { await page.locator("div.group").getByText(t.name, { exact: true }).first().click().catch(() => page.getByText(t.name, { exact: true }).first().click()); await sleep(400); };
const surfaceView = async () => { const r = page.getByRole("radio", { name: "Surface" }); if ((await r.getAttribute("aria-checked")) !== "true") await r.click(); await sleep(300); };
const reload = async (how) => {
  if (how === "location.reload()") await page.evaluate(() => void location.reload()).catch(() => {});
  else await page.reload();
  await sleep(1200);
  await until(() => page.evaluate(() => !!window.__a2ui711 && window.__a2ui711.probe.events.some((e) => e.what === "rebuilt")).catch(() => false));
  await until(() => page.evaluate(() => !!document.querySelector("aside[aria-label=Companion] [data-companion-view]")).catch(() => false));
  await sleep(1500);
  const a = (await terminals(page)).find((t) => t.name === "agent-a");
  await inv(page, "write_pty", { terminalId: a.id, data: String.fromCharCode(13) });
  await sleep(700);
};
const nav = () => page.evaluate(() => [performance.getEntriesByType("navigation")[0].type, Math.round(performance.timeOrigin)]);
const askState = (id) => page.evaluate((id) => {
  const c = document.querySelector(`[data-surface="${id}"]`);
  return { open: [...c.querySelectorAll("[data-question]")].map((q) => q.querySelector("button").getAttribute("aria-expanded")), inputs: [...c.querySelectorAll("input,textarea")].map((e) => (e.type === "textarea" ? e.value : e.checked)), rows: [...c.querySelectorAll("[data-question] > button")].map((b) => b.innerText.replace(/\s+/g, " ")), send: c.querySelector("[data-ask-foot] button").disabled ? "held" : "free" };
}, id);
const rawState = (id) => page.evaluate((id) => {
  const c = document.querySelector(`[data-surface="${id}"]`);
  return { inputs: [...c.querySelectorAll("input,textarea")].map((e) => [e.labels[0]?.innerText.split("\n")[0], e.type === "checkbox" || e.type === "radio" ? e.checked : e.value]), text: c.innerText.replace(/\s+/g, " ").slice(0, 120) };
}, id);
await select(agent);
const warm = async () => { await inv(page, "write_pty", { terminalId: agent.id, data: String.fromCharCode(13) }); await inv(page, "write_pty", { terminalId: other.id, data: String.fromCharCode(13) }); await sleep(600); };
await warm();

// --- A. typed surface over a reload
const n = (await mine()).filter((r) => r.id.startsWith("ask_")).length;
const id = `ask_${n + 1}`;
const file = await callIn(page, agent.id, "quay_ask", "ask", `t4-${id}`);
const S = `[data-surface=${id}]`;
await page.waitForSelector(S);
await page.locator(S).getByText("Merge master in").click();
await page.locator(`${S} [data-question='0'] textarea`).fill("first note");
await page.locator(S).getByRole("button", { name: "Next" }).click();
await page.locator(`${S} [data-question='1'] textarea`).fill("second note");
await sleep(900);
log("A0 before", await nav(), await askState(id));
log("A0 held by Rust", (await mine()).find((r) => r.id === id).draft);
for (const how of ["Page.reload", "location.reload()"]) {
  await reload(how);
  const view = await page.evaluate(() => document.querySelector("[data-companion-view]").dataset.companionView);
  await surfaceView();
  log(`A1 after ${how}: companion opened on "${view}"`, await nav(), await askState(id));
}
// Typed, then reloaded inside the 400 ms pause
for (const how of ["Page.reload", "location.reload()"]) {
  const t = page.locator(`${S} [data-question='1'] textarea`);
  await t.click();
  const text = `typed then ${how}`.toLowerCase().replace(/[^a-z ]/g, "");
  await t.fill("");
  await typeKeys(cdp, text, 15);
  await reload(how);
  await surfaceView();
  log(`A2 reload by ${how} inside the pause`, (await askState(id)).inputs, "wanted", text);
}
// A renderer that dies in the middle of continuous typing: what Rust has is what was sent before
{
  const t = page.locator(`${S} [data-question='1'] textarea`);
  await t.fill("settled text");
  await sleep(800);
  await t.press("End");
  await typeKeys(cdp, " plus more without any pause", 40);
  log("A3 Rust during unbroken typing", (await mine()).find((r) => r.id === id).draft["/answers/1/text"]);
  await sleep(700);
  log("A3 Rust after the pause", (await mine()).find((r) => r.id === id).draft["/answers/1/text"]);
}
await page.locator(`${S} [data-ask-foot] button`).scrollIntoViewIfNeeded();
await page.locator(`${S} [data-ask-foot] button`).focus();
await page.keyboard.press("Enter");
log("A4 sent by Enter after four reloads", await result(file), (await events(page)).filter((e) => e.what === "action").length, "action");
await sleep(300);
log("A4 draft in Rust after the answer", (await mine()).find((r) => r.id === id).draft);

// --- B. raw surface
const rawFile = await callIn(page, agent.id, "quay_surface", "raw", "t4-raw");
const R = "[data-surface=form]";
await page.waitForSelector(R);
await only(R);
const note = page.locator(`${R} textarea`);
await note.click();
await typeKeys(cdp, "raw note ", 20);
await page.locator(`${R} input[type=checkbox]`).check();
await page.locator(R).getByText("There", { exact: true }).click();
await sleep(800);
log("B0 held by Rust", (await mine()).find((r) => r.id === "form").draft);
await reload("Page.reload");
await surfaceView();
await only(R);
log("B1 after the reload", await rawState("form"));
// --- C. updates while typing
const caret = () => page.evaluate(() => [document.activeElement.localName, document.activeElement.selectionStart, document.activeElement.value?.length]);
await note.click();
await page.keyboard.press("End");
const typing = typeKeys(cdp, "abcdefghij klmnopqrst uvwxyz abcdefghij klmnopqrst uvwxyz abcdefghij klmnopqrst uvwxyz ", 70);
await sleep(600);
await callIn(page, agent.id, "quay_surface", "upd-status");
await sleep(1500);
await callIn(page, agent.id, "quay_surface", "upd-label");
await sleep(1500);
await callIn(page, agent.id, "quay_surface", "upd-owner");
await typing;
await sleep(700);
log("C1 typed through three updates", await caret(), await rawState("form"));
log("C1 Rust", (await mine()).find((r) => r.id === "form").draft, "revision", (await mine()).find((r) => r.id === "form").revision);
// The operator types in Owner; the agent sets a sibling, then that path, then its parent
const owner = page.locator(`${R} input:not([type])`);
await owner.fill("operator");
await sleep(100);
const step = async (name) => { const f = await callIn(page, agent.id, "quay_surface", name, `t4-${name}-${Date.now()}`); await until(() => quayLog().slice(-3).some((l) => / COMMIT form /.test(l)), 8000); await sleep(500); return f; };
await step("upd-status");
log("C2 sibling path set inside the pause", (await rawState("form")).inputs);
await step("upd-owner");
log("C3 its own path set", (await rawState("form")).inputs, (await mine()).find((r) => r.id === "form").draft);
await owner.fill("operator again");
await sleep(700);
await step("upd-meta");
log("C4 its parent set", (await rawState("form")).inputs, (await mine()).find((r) => r.id === "form").draft);
// Update while the surface is off the screen, with a typed but unsent answer
await owner.fill("typed before leaving");
await select(other);
await step("upd-label");
await step("upd-status");
await select(agent);
await surfaceView();
await only(R);
log("C5 updated while off screen", (await rawState("form")).inputs);
// Update committed, then a reload before anything else: rebuilt from Rust alone
await note.click();
await page.keyboard.press("End");
await typeKeys(cdp, "end", 20);
await sleep(700);
await step("upd-owner");
await reload("Page.reload");
await surfaceView();
await only(R);
log("C6 updated, then reloaded", (await rawState("form")).inputs);
// An answer to an older revision
log("C7 stale answer", await inv(page, "a2ui711_answer", { terminalId: agent.id, id: "form", revision: 1, result: {} }).catch((e) => String(e)));
// A draft read before an update and arriving after it
const rev = (await mine()).find((r) => r.id === "form").revision;
await inv(page, "a2ui711_draft", { terminalId: agent.id, id: "form", revision: rev - 1, draft: { "/meta/owner": "late", "/note": "kept" }, why: "late" });
log("C8 late draft, owner was set since", (await mine()).find((r) => r.id === "form").draft);
await reload("Page.reload");
await surfaceView();
await only(R);
// --- D. caret and IME
await note.fill("start end");
await note.click();
await page.keyboard.press("Home");
for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
await typeKeys(cdp, " middle", 30);
log("D1 typed in the middle", await note.inputValue(), await caret());
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
log("D2 after Ctrl+Z twice", await note.inputValue());
await note.fill("");
await note.click();
for (const s of ["に", "にほ", "にほん", "日本"]) await cdp.send("Input.imeSetComposition", { text: s, selectionStart: s.length, selectionEnd: s.length });
await callIn(page, agent.id, "quay_surface", "upd-status");
await sleep(1200);
await cdp.send("Input.imeSetComposition", { text: "日本語", selectionStart: 3, selectionEnd: 3 });
await cdp.send("Input.insertText", { text: "日本語" });
await sleep(700);
log("D3 IME with an update in the middle of the composition", await note.inputValue(), (await mine()).find((r) => r.id === "form").draft["/note"]);
// A whole-model update
await note.fill("about to be replaced");
await sleep(600);
await step("upd-root");
log("E1 updateDataModel with no path", (await rawState("form")).inputs, (await mine()).find((r) => r.id === "form").draft);
await page.locator(R).getByRole("button", { name: "Go" }).click();
await sleep(500);
log("E2 actions", (await events(page)).filter((e) => /action|answer/.test(e.what)));
log("bad", (await result(await callIn(page, agent.id, "quay_surface", "bad"))).answer);
log("log\n" + quayLog().slice(-70).join("\n"));
await browser.close();
