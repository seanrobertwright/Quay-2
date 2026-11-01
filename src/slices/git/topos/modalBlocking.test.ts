/// <reference types="node" />
// Topos's modal layer in a real browser (#421): while a confirm is open, a click or a Tab outside it
// does nothing, and Escape or Cancel gives focus back to the control that opened it. It builds
// fixtures/modalPage, which mounts the real `ToposModalScope` and `ConfirmDialog`, serves it, and
// drives it in Edge (WebView2's engine), or Chrome where Edge isn't installed.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { ModalPageState } from "./fixtures/modalPage/main.tsx";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "quay-topos-modal-"));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

let server: Server;
let browser: Browser;
let page: Page;

async function launch(): Promise<Browser> {
  const failures: string[] = [];
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      failures.push(`${channel}: ${String(e).split("\n")[0]}`);
    }
  }
  throw new Error(`no browser to drive the modal page: ${failures.join("; ")}`);
}

before(async () => {
  await build({
    root: join(here, "fixtures/modalPage"),
    configFile: false,
    base: "./",
    plugins: [react(), tailwindcss()],
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const file = resolve(outDir, `.${path === "/" ? "/index.html" : path}`);
    const headers = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
    if (!file.startsWith(outDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the server has no port");
  browser = await launch();
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
});

after(async () => {
  await browser?.close();
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  rmSync(outDir, { recursive: true, force: true });
});

// Each test starts on a fresh page, so one that fails with its confirm open can't break the next.
beforeEach(async () => {
  await page.reload();
});

const pageState = () => page.evaluate(() => (window as unknown as { __modalPage: ModalPageState }).__modalPage);
const focusedName = () => page.evaluate(() => document.activeElement?.textContent ?? null);
const focusInDialog = () => page.evaluate(() => document.activeElement?.closest('[role="alertdialog"]') != null);
const dialog = () => page.getByRole("alertdialog");

/** A real pointer press at the middle of the button named `name`, wherever it is drawn. */
async function clickAt(name: string) {
  const box = await page.getByRole("button", { name, exact: true, includeHidden: true }).boundingBox();
  assert.ok(box, `${name} is on screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function openConfirm() {
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await dialog().waitFor();
  assert.equal(await focusedName(), "Cancel");
}

test("while a confirm is open, a click on the graph or the diff view does nothing", async () => {
  await openConfirm();
  const before = await pageState();
  await clickAt("Graph row");
  await clickAt("Back");
  assert.deepEqual((await pageState()).clicks, before.clicks);
  assert.equal(await focusInDialog(), true);
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "detached" });
  // With the confirm closed the same press reaches the graph, so the one above was really blocked.
  await clickAt("Graph row");
  assert.equal((await pageState()).clicks.graph, before.clicks.graph + 1);
});

test("while a confirm is open, nothing outside it takes focus, by Tab or otherwise", async () => {
  await openConfirm();
  // The rest of Topos is out of reach by any route, not only Tab: it can't take focus at all.
  await page.getByRole("button", { name: "Graph row", includeHidden: true }).evaluate((el) => (el as HTMLElement).focus());
  assert.equal(await focusInDialog(), true);
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    assert.equal(await focusInDialog(), true, `focus is in the confirm after ${key}`);
  }
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "detached" });
});

test("Escape returns focus to the control that opened the confirm", async () => {
  await openConfirm();
  await page.keyboard.press("Escape");
  await dialog().waitFor({ state: "detached" });
  assert.equal(await focusedName(), "Discard");
});

test("Cancel returns focus to the control that opened the confirm, and confirms nothing", async () => {
  await openConfirm();
  await page.getByRole("button", { name: "Cancel" }).click();
  await dialog().waitFor({ state: "detached" });
  assert.equal(await focusedName(), "Discard");
  assert.equal((await pageState()).confirmed, 0);
});
