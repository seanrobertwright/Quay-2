// CSP in the built webview, and every request made while surfaces are drawn.
import { attach, inv, terminals, sleep, callIn, until, quayLog, events, Q } from "./drv.mjs";
import { writeFileSync } from "node:fs";
const { browser, page, cdp } = await attach();
const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));
writeFileSync(`${Q}/args/sink.json`, JSON.stringify({ place: "companion", title: "Kitchen sink", messages: [{ version: "1.0", createSurface: { surfaceId: "sink", components: [
  { id: "root", component: "Column", children: ["h", "md", "row", "tabs", "img", "div", "slider", "date", "prog", "steps", "file", "go"] },
  { id: "h", component: "Text", text: { "@call": "formatString", args: { value: "Hello ${/name}, ${formatDate(value: /when, format: 'yyyy-MM-dd')}" } } },
  { id: "md", component: "Text", text: "A [web link](https://example.invalid/x), `code`, **bold**\n\n![i](https://example.invalid/i.png)\n\n<img src=x onerror=alert(1)><script>alert(2)</script>" },
  { id: "row", component: "Row", children: ["c1", "c2"] }, { id: "c1", component: "Card", child: "st" }, { id: "st", component: "Stat", label: "Tests", value: "12" }, { id: "c2", component: "Card", child: "cap" }, { id: "cap", component: "Text", variant: "caption", text: "caption" },
  { id: "tabs", component: "Tabs", tabs: [{ title: "One", child: "t1" }, { title: "Two", child: "t2" }] }, { id: "t1", component: "TextField", label: "Email", value: { "@path": "/email" }, "@checks": [{ condition: { "@call": "regex", args: { value: { "@path": "/email" }, pattern: "^[a-z]+@[a-z]+$" } }, message: "Not an address" }] }, { id: "t2", component: "CheckBox", label: "Yes", value: { "@path": "/yes" } },
  { id: "img", component: "Image", url: "https://example.invalid/p.png", description: "remote" }, { id: "div", component: "Divider" },
  { id: "slider", component: "Slider", label: "Level", min: 0, max: 10, value: { "@path": "/level" } }, { id: "date", component: "DateTimeInput", value: { "@path": "/when" }, enableDate: true },
  { id: "prog", component: "Progress", done: 3, total: 7 }, { id: "steps", component: "Steps", steps: [{ label: "a", state: "done" }, { label: "b", state: "active" }] }, { id: "file", component: "FileLink", path: "a.txt" },
  { id: "go", component: "Button", child: "gol", action: { event: { name: "go", context: {} } } }, { id: "gol", component: "Text", text: "Go" },
], dataModel: { name: "Quay", when: "2026-11-24", email: "bad", yes: false, level: 4 } } }] }));
await cdp.send("Network.enable");
await cdp.send("Log.enable");
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");
const reqs = [], logs = [], docs = [];
cdp.on("Network.requestWillBeSent", (e) => reqs.push(`${e.type} ${e.request.method} ${e.request.url.slice(0, 110)}`));
cdp.on("Network.responseReceived", (e) => e.type === "Document" && docs.push(e.response.headers));
cdp.on("Log.entryAdded", (e) => logs.push(`${e.entry.source}/${e.entry.level}: ${e.entry.text.slice(0, 200)}`));
cdp.on("Runtime.consoleAPICalled", (e) => logs.push(`console.${e.type}: ${e.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200)}`));
cdp.on("Runtime.exceptionThrown", (e) => logs.push(`exception: ${e.exceptionDetails.exception?.description?.slice(0, 200)}`));
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__csp = []; addEventListener("securitypolicyviolation", (e) => window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, file: (e.sourceFile || "").slice(-40), sample: e.sample }), true);` });
await page.reload();
await sleep(3000);
log("policy header", docs[0]?.["content-security-policy"] ?? docs[0]?.["Content-Security-Policy"]);
log("at load: violations", await page.evaluate(() => window.__csp), "page", await page.evaluate(() => [location.href, document.adoptedStyleSheets.length, document.querySelectorAll("style").length, document.scripts.length]));
const agent = (await terminals(page)).find((t) => t.name === "agent-a");
await page.getByText(agent.name, { exact: true }).first().click();
await sleep(1500);
reqs.length = 0;
for (const [tool, name, id] of [["quay_ask", "ask"], ["quay_surface", "sink", "sink"], ["quay_surface", "big", "big"], ["quay_surface", "upd-status"], ["quay_surface", "bad"]]) {
  await callIn(page, agent.id, tool, name);
  await sleep(1500);
}
await page.getByRole("radio", { name: "Surface" }).click();
await sleep(800);
log("drawn", await page.evaluate(() => [...document.querySelectorAll("[data-surface]")].map((e) => e.dataset.surface)));
log("sink text", await page.evaluate(() => document.querySelector("[data-surface=sink]")?.innerText.replace(/\s+/g, " ").slice(0, 400)));
log("sink html", await page.evaluate(() => [document.querySelectorAll("[data-surface=sink] script, [data-surface=sink] img").length, document.querySelector("[data-surface=sink] [aria-invalid]")?.localName, document.querySelector("[data-surface=sink] [aria-describedby]")?.getAttribute("aria-describedby")]));
// Use them: type, choose, switch tabs, slide, send
const sink = page.locator("[data-surface=sink]");
await sink.getByLabel("Email").fill("a@b");
await sink.getByRole("button", { name: "Two" }).click();
await sink.getByRole("button", { name: "Go" }).click();
await sleep(1000);
await (await page.locator("[data-surface=sink]").boundingBox()) && page.screenshot({ path: `${Q}/out/sink.png` });
const shown = await page.evaluate(() => window.__csp);
log("after ask, sink, 500 components, update, rejection and an answer: violations", shown);
log("requests by host while drawn", Object.entries(reqs.map((r) => r.replace(/^(\S+ \S+ [a-z]+:\/\/[^/]+\/?[^/]*).*/, "$1").replace(/%[0-9A-F]{2}/g, "")).reduce((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {})));
log("console and log entries", logs);
log("sheets", await page.evaluate(() => [document.adoptedStyleSheets.length, document.querySelectorAll("style").length, customElements.get("a2ui-react-column") !== undefined]));
// Control: the same listeners do see violations, made by the page's own timers
logs.length = 0;
await page.evaluate(() => {
  setTimeout(() => { try { new Function("return 1")(); } catch (e) { console.log("control eval refused: " + e.name); } }, 0);
  setTimeout(() => { const s = document.createElement("script"); s.textContent = "window.__ran = 1"; document.body.append(s); }, 0);
  setTimeout(() => { const i = new Image(); i.src = "https://example.invalid/control.png"; document.body.append(i); }, 0);
  setTimeout(() => { fetch("https://example.invalid/").catch(() => {}); }, 0);
});
await sleep(1200);
log("control: violations", (await page.evaluate(() => [window.__csp, window.__ran ?? null])));
log("control: log", logs);
await browser.close();
