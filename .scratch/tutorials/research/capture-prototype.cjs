// Throwaway prototype for ticket #8 (screenshot research). Not part of the app.
//
// What it checks, without changing app code or config:
//   1. A built Quay exe started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
//      exposes CDP, and Playwright connectOverCDP can screenshot it.
//   2. Pointing LOCALAPPDATA at a fixture folder makes Quay load a scripted workspace and
//      "dormant" terminals whose scrollback comes from recorded .log files, so no live agent runs.
//   3. Two captures in a row are pixel-identical, a CSS callout can be injected before capture,
//      and CDP Page.startScreencast yields frames that ffmpeg can turn into a GIF or MP4.
//
// Usage (all arguments required):
//   node capture-prototype.cjs --exe <path to tauri-app.exe> --work <empty scratch dir> --port <1024-65535> \
//     --pw <folder whose node_modules holds playwright-core>

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith("--") || value === undefined || value === "") {
      throw new Error(`Bad argument near "${key ?? ""}". Expected --exe, --work, --port and --pw, each with a value.`);
    }
    out[key.slice(2)] = value;
  }
  for (const required of ["exe", "work", "port", "pw"]) {
    if (!Object.hasOwn(out, required)) throw new Error(`Missing --${required}`);
  }
  if (!/^\d+$/.test(out.port)) throw new Error(`--port must be an integer, got "${out.port}"`);
  const port = Number.parseInt(out.port, 10);
  if (port < 1024 || port > 65535) throw new Error(`--port must be 1024-65535, got ${port}`);
  if (!fs.existsSync(out.exe)) throw new Error(`--exe not found: ${out.exe}`);
  if (!fs.existsSync(path.join(out.pw, "node_modules", "playwright-core"))) {
    throw new Error(`--pw has no node_modules/playwright-core: ${out.pw}`);
  }
  return { exe: path.resolve(out.exe), work: path.resolve(out.work), port, pw: path.resolve(out.pw) };
}

// Recorded terminal output: plain ANSI, written the way Quay's PTY reader appends it to <id>.log.
function fixtureLog(title) {
  const e = "\x1b[";
  return [
    `${e}38;5;208m*${e}0m Welcome to ${e}1m${title}${e}0m (fixture replay, no live agent)\r\n`,
    `\r\n`,
    `${e}90m>${e}0m Add a /health route that returns {"ok": true}\r\n`,
    `\r\n`,
    `${e}32m●${e}0m Read ${e}1msrc/server.ts${e}0m ${e}90m(42 lines)${e}0m\r\n`,
    `${e}32m●${e}0m Update ${e}1msrc/server.ts${e}0m\r\n`,
    `  ${e}90m│${e}0m ${e}32m+ app.get("/health", (_req, res) => res.json({ ok: true }));${e}0m\r\n`,
    `${e}32m●${e}0m Bash ${e}1mpnpm test${e}0m\r\n`,
    `  ${e}90m│${e}0m ${e}32m✓${e}0m 12 passed\r\n`,
    `\r\n`,
    `${e}36mDone.${e}0m The route is in place and the tests pass.\r\n`,
  ].join("");
}

function writeFixture(work) {
  const localAppData = path.join(work, "LocalAppData");
  const quayDir = path.join(localAppData, "Quay2");
  const sessionsDir = path.join(quayDir, "sessions");
  const projectPath = path.join(work, "demo-project");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });

  fs.writeFileSync(
    path.join(quayDir, "workspaces.json"),
    JSON.stringify({ active_project: projectPath, projects: [{ path: projectPath, name: "demo-project" }] }, null, 2),
  );

  const terminals = [
    { id: "fixture-architect", name: "Architect" },
    { id: "fixture-builder", name: "Builder" },
  ];
  const sessions = terminals.map((t) => ({
    id: t.id,
    name: t.name,
    project_path: projectPath,
    run_kind: "claude",
    permission_mode: "normal",
    custom_name: true,
    last_updated: 0,
  }));
  fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify(sessions, null, 2));
  for (const t of terminals) fs.writeFileSync(path.join(sessionsDir, `${t.id}.log`), fixtureLog(t.name));
  const claudeConfig = path.join(work, "claude-config"); // empty, so the spend figure reads $0.00
  fs.mkdirSync(claudeConfig, { recursive: true });
  return { localAppData, claudeConfig, webviewData: path.join(work, "WebView2Data") };
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function waitForCdp(port, deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      return await getJson(`http://127.0.0.1:${port}/json/version`);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`CDP endpoint on port ${port} did not come up within ${deadlineMs} ms`);
}

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

async function main() {
  const { exe, work, port, pw } = parseArgs(process.argv.slice(2));
  const { chromium } = createRequire(path.join(pw, "package.json"))("playwright-core");
  fs.mkdirSync(work, { recursive: true });
  const outDir = path.join(work, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const { localAppData, claudeConfig, webviewData } = writeFixture(work);

  const child = spawn(exe, [], {
    env: {
      ...process.env,
      LOCALAPPDATA: localAppData, // Quay's own state: workspaces.json, sessions/, machina/
      CLAUDE_CONFIG_DIR: claudeConfig, // token-spend scan reads transcripts from here
      WEBVIEW2_USER_DATA_FOLDER: webviewData, // own browser process, so the switch below is applied
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
  });
  const report = { pid: child.pid };
  try {
    report.cdpVersion = await waitForCdp(port, 30000);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent("page"));
    report.url = page.url();

    await page.waitForSelector(".xterm-rows", { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500); // let fit/resize settle
    report.dom = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      xtermCount: document.querySelectorAll(".xterm").length,
      xtermCanvasCount: document.querySelectorAll(".xterm canvas").length,
      xtermDomRows: document.querySelectorAll(".xterm-rows > div").length,
      firstRowText: document.querySelector(".xterm-rows > div")?.textContent ?? null,
      prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
    }));

    const shotOpts = { animations: "disabled", caret: "hide", scale: "css" };
    const a = await page.screenshot({ ...shotOpts, path: path.join(outDir, "full-a.png") });
    const b = await page.screenshot({ ...shotOpts, path: path.join(outDir, "full-b.png") });
    report.fullShot = { bytes: a.length, shaA: sha(a), shaB: sha(b), identical: a.equals(b) };

    const raw1 = await page.screenshot({ path: path.join(outDir, "full-devicepx.png") });
    report.devicePixelShotBytes = raw1.length;

    // Repeatability: several captures spaced across cursor-blink periods, with the random
    // bridge-port badge masked.
    const portBadge = page.getByText(/^:\d+$/).first();
    const hashes = [];
    const deviceHashes = [];
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(370);
      hashes.push(sha(await page.screenshot({ ...shotOpts, mask: [portBadge], maskColor: "#161b22" })));
      const dev = await page.screenshot({ animations: "disabled", caret: "hide", mask: [portBadge], maskColor: "#161b22" });
      fs.writeFileSync(path.join(outDir, `repeat-device-${i}.png`), dev);
      deviceHashes.push(sha(dev));
    }
    report.repeatHashes = hashes;
    report.repeatIdentical = hashes.every((h) => h === hashes[0]);
    report.repeatDeviceHashes = deviceHashes;
    report.repeatDeviceIdentical = deviceHashes.every((h) => h === deviceHashes[0]);

    // Same capture size on any monitor: override viewport and device scale factor through CDP.
    const emu = await context.newCDPSession(page);
    await emu.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await page.waitForTimeout(1000);
    const e1 = await page.screenshot({ animations: "disabled", caret: "hide", mask: [portBadge], maskColor: "#161b22", path: path.join(outDir, "emulated-1440x900@2x.png") });
    report.emulated = {
      bytes: e1.length,
      dom: await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })),
    };
    await emu.send("Emulation.clearDeviceMetricsOverride");
    await page.waitForTimeout(500);

    const term = page.locator(".xterm").first();
    const t = await term.screenshot({ ...shotOpts, path: path.join(outDir, "terminal.png") });
    report.terminalShotBytes = t.length;

    // Annotation: inject a callout around the first terminal, capture, then remove it.
    await page.addStyleTag({
      content: `.qcap-callout{position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #f0883e;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.35)}
.qcap-label{position:fixed;z-index:2147483647;background:#f0883e;color:#0d1117;font:600 14px/1.2 system-ui;padding:4px 8px;border-radius:6px}`,
    });
    const box = await term.boundingBox();
    await page.evaluate((r) => {
      const c = document.createElement("div");
      c.className = "qcap-callout";
      Object.assign(c.style, { left: `${r.x - 4}px`, top: `${r.y - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
      const l = document.createElement("div");
      l.className = "qcap-label";
      l.textContent = "1  Replayed agent output";
      Object.assign(l.style, { left: `${r.x + 8}px`, top: `${r.y + 8}px` });
      document.body.append(c, l);
    }, box);
    await page.screenshot({ ...shotOpts, path: path.join(outDir, "annotated.png") });
    await page.evaluate(() => document.querySelectorAll(".qcap-callout,.qcap-label").forEach((n) => n.remove()));

    // Short clip: CDP screencast frames while the second terminal is selected.
    const cdp = await context.newCDPSession(page);
    const framesDir = path.join(outDir, "frames");
    fs.mkdirSync(framesDir, { recursive: true });
    let n = 0;
    cdp.on("Page.screencastFrame", async (f) => {
      fs.writeFileSync(path.join(framesDir, `f${String(n++).padStart(4, "0")}.png`), Buffer.from(f.data, "base64"));
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await page.waitForTimeout(800);
    await page.getByText("Builder", { exact: true }).first().click().catch((err) => (report.clickError = String(err)));
    await page.waitForTimeout(2000);
    await cdp.send("Page.stopScreencast");
    report.screencastFrames = n;

    await browser.close(); // over CDP this disconnects; the app keeps running until killed below
  } finally {
    try {
      process.kill(child.pid);
    } catch (err) {
      report.killError = String(err);
    }
  }
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
