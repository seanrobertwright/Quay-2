// Throwaway driver for ticket #48 (Quay-2): spike the fake-CLI replay path against a built Quay.
// Not part of the app. Launches a built Quay with a stub `claude.exe` (and `codex.exe`) first on
// PATH, opens terminals through the real UI, types commands into the stubs, and checks over CDP
// that the rail badge, status strip and Mission Control react to the replayed bridge traffic.
//
// Usage: node spike.cjs --exe <tauri-app.exe> --work <empty folder> --port <1024-65535> --stub <quay-fake-cli.exe> --pw <folder with node_modules/playwright-core>

const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createRequire } = require("node:module");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith("--") || value === undefined || value === "") {
      throw new Error(`Bad argument near "${key ?? ""}"`);
    }
    out[key.slice(2)] = value;
  }
  for (const r of ["exe", "work", "port", "stub", "pw"]) {
    if (!Object.hasOwn(out, r)) throw new Error(`Missing --${r}`);
  }
  if (!/^\d+$/.test(out.port)) throw new Error("--port must be an integer");
  const port = Number.parseInt(out.port, 10);
  if (port < 1024 || port > 65535) throw new Error("--port out of range");
  for (const f of ["exe", "stub"]) if (!fs.existsSync(out[f])) throw new Error(`--${f} not found: ${out[f]}`);
  if (!fs.existsSync(path.join(out.pw, "node_modules", "playwright-core"))) throw new Error("--pw has no playwright-core");
  return { exe: path.resolve(out.exe), work: path.resolve(out.work), port, stub: path.resolve(out.stub), pw: path.resolve(out.pw) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      await sleep(250);
    }
  }
  throw new Error(`CDP on ${port} did not come up`);
}

async function waitFor(fn, deadlineMs, label) {
  const until = Date.now() + deadlineMs;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function readStubLog(dir, tag) {
  const p = path.join(dir, `${tag}.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { kind: "unparseable", raw: l };
      }
    });
}

function setup(work, stub) {
  const bin = path.join(work, "bin");
  const localAppData = path.join(work, "LocalAppData");
  const quayDir = path.join(localAppData, "Quay2");
  const project = path.join(work, "tutorials", "demo-project");
  const claudeConfig = path.join(work, "claude-config");
  const stubLog = path.join(work, "stublog");
  const out = path.join(work, "out");
  for (const d of [bin, path.join(quayDir, "sessions"), project, claudeConfig, stubLog, out]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(stub, path.join(bin, "claude.exe"));
  fs.copyFileSync(stub, path.join(bin, "codex.exe"));
  fs.writeFileSync(path.join(project, "README.md"), "# demo-project\n");
  fs.writeFileSync(
    path.join(quayDir, "workspaces.json"),
    // portable-pty 0.9.0 rebuilds the child's environment from the registry on Windows, so the
    // capture process's PATH never reaches the CLI. Quay merges a project's saved env_vars into
    // every spawn in that project (spawn_terminal in src-tauri/src/slices/pty/commands.rs), and
    // CommandBuilder resolves a bare program name against the builder's own PATH, so the
    // fixture workspace carries the override.
    JSON.stringify(
      {
        active_project: project,
        projects: [
          {
            path: project,
            name: "demo-project",
            env_vars: { PATH: `${bin};${process.env[Object.keys(process.env).find((k) => k.toUpperCase() === "PATH")] || ""}` },
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(quayDir, "sessions", "sessions.json"), "[]");
  return { bin, localAppData, project, claudeConfig, stubLog, out, webviewData: path.join(work, "WebView2Data") };
}

async function main() {
  const { exe, work, port, stub, pw } = parseArgs(process.argv.slice(2));
  const { chromium } = createRequire(path.join(pw, "package.json"))("playwright-core");
  fs.mkdirSync(work, { recursive: true });
  const fx = setup(work, stub);
  const report = { steps: [], facts: {} };
  const note = (step, data) => {
    report.steps.push({ step, ...data });
    console.log(`[${step}]`, JSON.stringify(data));
  };

  // Windows stores the variable as "Path"; setting "PATH" beside it leaves two keys and the
  // original wins. Override the key that actually exists.
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  const childEnv = { ...process.env };
  for (const k of Object.keys(childEnv)) if (k.toUpperCase() === "PATH") delete childEnv[k];
  childEnv[pathKey] = `${fx.bin};${process.env[pathKey] || ""}`;
  report.facts.pathKey = pathKey;
  const child = spawn(exe, [], {
    env: {
      ...childEnv,
      LOCALAPPDATA: fx.localAppData,
      CLAUDE_CONFIG_DIR: fx.claudeConfig,
      QUAY_STUB_LOG: fx.stubLog,
      WEBVIEW2_USER_DATA_FOLDER: fx.webviewData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
  });
  report.pid = child.pid;
  let browser;
  try {
    report.cdpVersion = await waitForCdp(port, 30000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = await waitFor(async () => context.pages().find((p) => p.url().includes("tauri.localhost")), 15000, "app page");
    await page.waitForSelector('[aria-label="Quay tools"]', { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(1000);

    const hasInternals = await page.evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === "function");
    report.facts.tauriInternalsInvoke = hasInternals;
    const invoke = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args ?? {}]);
    const listTerminals = () => invoke("list_terminals");
    const shot = (name) => page.screenshot({ path: path.join(fx.out, `${name}.png`), animations: "disabled", caret: "hide", scale: "css" });

    // --- Open terminals through the real UI ------------------------------------------------
    const KIND_INDEX = { claude: 0, antigravity: 1, codex: 2, pi: 3, gemini: 4, grok: 5, aider: 6, kiro: 7, copilot: 8, opencode: 9 };
    async function newTerminal(kind, name) {
      await page.click('button[title="New Terminal in active project (^b n)"]');
      await page.waitForSelector('input[placeholder^="e.g. "]', { timeout: 10000 });
      await page.locator(".grid.grid-cols-5 > button").nth(KIND_INDEX[kind]).click();
      const input = page.locator('input[placeholder^="e.g. "]:not([placeholder^="e.g. --"])');
      await input.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(name, { delay: 10 });
      const typed = await input.inputValue();
      if (typed !== name) throw new Error(`Name field holds "${typed}", wanted "${name}"`);
      await page.click('button:has-text("Start Terminal")');
      await sleep(1500);
      // Fail fast if the real CLI launched instead of the stub.
      const logs = fs.readdirSync(fx.stubLog);
      if (logs.length === 0) {
        await page.screenshot({ path: path.join(fx.out, `98-no-stub-${name}.png`) });
        throw new Error(`No stub log after spawning ${kind} "${name}": the stub on PATH was not picked up`);
      }
    }
    await newTerminal("claude", "Alpha");
    await newTerminal("claude", "Beta");
    await newTerminal("codex", "Gamma");
    await sleep(1500);

    let terms = await listTerminals();
    const byName = Object.fromEntries(terms.map((t) => [t.name, t]));
    note("spawned", terms.map((t) => ({ id: t.id, name: t.name, run_kind: t.run_kind, status: t.claude_status })));
    const alpha = byName.Alpha;
    const beta = byName.Beta;
    const gamma = byName.Gamma;
    if (!alpha || !beta || !gamma) throw new Error("Not all three terminals spawned");

    // --- 1. PATH pickup --------------------------------------------------------------------
    const launchOf = (tag) => readStubLog(fx.stubLog, tag).find((r) => r.kind === "launch");
    const alphaLaunch = await waitFor(() => launchOf(alpha.id), 10000, "Alpha stub launch record");
    const betaLaunch = await waitFor(() => launchOf(beta.id), 10000, "Beta stub launch record");
    const untagged = fs.readdirSync(fx.stubLog).filter((f) => f.startsWith("untagged-"));
    const gammaLaunch = untagged.length ? readStubLog(fx.stubLog, untagged[0].replace(/\.jsonl$/, "")).find((r) => r.kind === "launch") : null;
    note("path-pickup", {
      alpha: { exe: alphaLaunch.exe, cwd: alphaLaunch.cwd, argv: alphaLaunch.argv.slice(1), env: alphaLaunch.env, mcp_config_path: alphaLaunch.mcp_config_path, mcp_config: alphaLaunch.mcp_config, token_len: alphaLaunch.token_len },
      beta: { exe: betaLaunch.exe, argv: betaLaunch.argv.slice(1), tag: betaLaunch.env.CLAUDE_EVENTS_TAG },
      gammaCodex: gammaLaunch ? { exe: gammaLaunch.exe, cwd: gammaLaunch.cwd, argv: gammaLaunch.argv.slice(1), env: gammaLaunch.env, mcp_config_path: gammaLaunch.mcp_config_path } : "no untagged stub log found",
    });
    // session.started from the stub should have moved Alpha/Beta from starting to idle
    terms = await listTerminals();
    note("after-session-started", terms.map((t) => ({ name: t.name, status: t.claude_status })));
    await shot("01-three-terminals");

    // --- 2a. Replayed status events ---------------------------------------------------------
    async function focusTerminal(name) {
      await page.getByText(name, { exact: true }).first().click();
      await sleep(400);
      await page.locator(".xterm-helper-textarea:visible, .xterm:visible").first().click();
      await sleep(200);
    }
    async function typeLine(text) {
      await page.keyboard.type(text, { delay: 10 });
      await page.keyboard.press("Enter");
    }
    async function statusOf(name) {
      const t = (await listTerminals()).find((x) => x.name === name);
      return t ? { status: t.claude_status, tool: t.current_tool, task: t.task_title } : null;
    }
    async function stripText() {
      return page.evaluate(() => {
        const nodes = [...document.querySelectorAll("span")].filter((s) => /Working|Ready —|Waiting for decision|Starting session|Exited with code/.test(s.textContent || ""));
        return nodes.map((n) => n.textContent.trim()).slice(0, 4);
      });
    }

    await focusTerminal("Alpha");
    await typeLine("run Add a health route");
    const transitions = [];
    const t0 = Date.now();
    let lastKey = "";
    while (Date.now() - t0 < 12000) {
      const s = await statusOf("Alpha");
      const key = JSON.stringify(s);
      if (key !== lastKey) {
        transitions.push({ atMs: Date.now() - t0, ...s, strip: await stripText() });
        lastKey = key;
        if (s.status === "working" && s.tool === "Read") await shot("02-alpha-working-read");
      }
      if (s.status === "idle" && s.task) break;
      await sleep(150);
    }
    await sleep(500);
    await shot("03-alpha-idle-after-turn");
    const railAlphaTitle = await page.evaluate(() => [...document.querySelectorAll('[title^="Alpha"]')].map((n) => n.getAttribute("title")));
    note("status-events", { transitions, railAlphaTitle, alphaEvents: readStubLog(fx.stubLog, alpha.id).filter((r) => r.kind === "http" && r.path === "/v1/events").map((r) => ({ type: JSON.parse(r.request).events[0].type, status: r.status })) });

    // --- 2b. MCP tool call: quay_list_agents ------------------------------------------------
    await focusTerminal("Alpha");
    await typeLine("list");
    const listCalls = await waitFor(() => {
      const calls = readStubLog(fx.stubLog, alpha.id).filter((r) => r.kind === "http" && r.path === "/mcp");
      return calls.length >= 3 ? calls : null;
    }, 10000, "three MCP calls");
    note("mcp-list", listCalls.map((c) => ({ method: JSON.parse(c.request).method, status: c.status, response: c.response.slice(0, 600) })));

    // --- 2c. MCP quay_send_message with wait_for_reply, answered by the Beta stub ---------
    await focusTerminal("Alpha");
    await typeLine("send Beta please review the health route");
    await sleep(1500);
    await shot("04-alpha-waiting-on-beta");
    const sendCall = await waitFor(() => {
      const c = readStubLog(fx.stubLog, alpha.id).find((r) => r.kind === "http" && r.path === "/mcp" && r.request.includes("quay_send_message"));
      return c && c.status ? c : null;
    }, 75000, "quay_send_message response");
    const betaStdin = readStubLog(fx.stubLog, beta.id).filter((r) => r.kind === "stdin").map((r) => r.line);
    const betaEvents = readStubLog(fx.stubLog, beta.id).filter((r) => r.kind === "http" && r.path === "/v1/events").map((r) => JSON.parse(r.request).events[0].type);
    note("mcp-send", { status: sendCall.status, response: sendCall.response.slice(0, 600), betaStdin, betaEvents, alphaNow: await statusOf("Alpha"), betaNow: await statusOf("Beta") });

    // --- Codex stub: no bridge, confirm what it got ----------------------------------------
    await focusTerminal("Gamma");
    await sleep(300);
    await shot("06-gamma-codex-stub");
    await focusTerminal("Alpha");

    // Mission Control
    await page.click('button[aria-label="A2A Orchestration Bus"]');
    await page.waitForSelector("text=Alpha → Beta", { timeout: 10000 });
    await sleep(800);
    await shot("05-mission-control");
    const trail = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && /Alpha → Beta/.test(n.textContent || ""));
      let root = el;
      for (let i = 0; i < 6 && root && root.parentElement; i++) root = root.parentElement;
      return (root || el).innerText.slice(0, 1200);
    });
    note("mission-control", { trail });
    report.facts.gammaStatusAtEnd = await statusOf("Gamma");

    report.facts.releaseExe = exe;
    report.facts.bridgePort = alphaLaunch.env.CLAUDE_EVENTS_URL;
    report.ok = true;
  } catch (err) {
    report.ok = false;
    report.error = String(err && err.stack ? err.stack : err);
    console.error(report.error);
    try {
      const context = browser && browser.contexts()[0];
      const page = context && context.pages().find((p) => p.url().includes("tauri.localhost"));
      if (page) await page.screenshot({ path: path.join(fx.out, "99-failure.png") });
    } catch {}
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
    fs.writeFileSync(path.join(fx.out, "report.json"), JSON.stringify(report, null, 2));
    console.log(`report: ${path.join(fx.out, "report.json")}`);
  }
}

main();
