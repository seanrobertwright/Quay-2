# Research: How do we capture consistent screenshots of Quay?

Ticket #8 in this repo's issue tracker, a research ticket on the "Swarm and A2A
tutorials" wayfinder map (#2). Researched 2026-10-18.

## Answer in brief

- **Recommended:** a capture script launches a built Quay with environment variables
  only, then drives it with Playwright `connectOverCDP`. The variables:
  - `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` opens CDP.
  - `WEBVIEW2_USER_DATA_FOLDER=<fresh folder>` gives the run its own browser process.
  - `LOCALAPPDATA=<fixture folder>` and `CLAUDE_CONFIG_DIR=<fixture folder>` give it
    scripted state.

  This was prototyped and works against the release build. No app code, `tauri.conf.json`
  or `Cargo.toml` change is needed, and nothing ships in the product.
- **Repeatable terminal content:** Quay already restores terminals from
  `%LOCALAPPDATA%\Quay2\sessions\sessions.json` and `<id>.log`. A fixture folder with
  recorded logs therefore renders known output with no live agent. This was prototyped.
  Those terminals show a "Session Inactive" banner, so shots of *running* agents need one
  of the replay options in the [terminal content](#4-making-terminal-content-repeatable)
  section. That choice is for a decision ticket.
- **Fallback:** manual capture with ShareX or Snipping Tool against the same fixture
  state, at a fixed display scaling. `tauri-driver` with WebDriver is an automation
  fallback. Tauri supports it officially, but it needs a version-matched `msedgedriver`
  and has fewer capture controls.
- **GIF and video:** cheap with the recommended approach. CDP `Page.startScreencast`
  frames go through `ffmpeg`. A measured 3-second clip came to tens of KB as MP4 and
  about 115 KB as GIF. The terminal content only animates if the replay option
  supplies timing.

## Versions in play

| Component | Version | Source |
| --- | --- | --- |
| Tauri (crate) | 2.12.3 | `src-tauri/Cargo.lock` |
| wry / webview2-com | 0.57.0 / 0.39.1 | `src-tauri/Cargo.lock` |
| WebView2 runtime seen by the prototype | Edg/155.0.4283.62 | CDP `/json/version` in the prototype run |
| `@xterm/xterm` | 6.0.0 (with `addon-fit` 0.11.0, `addon-search` 0.16.0) | `pnpm-lock.yaml` |
| VitePress | 1.6.4 | `pnpm-lock.yaml` |
| Playwright (prototype only, not added to the repo) | `playwright-core` 1.64.1 | npm |

## What a capture tool sees in Quay (repo facts)

- **Window.** `src-tauri/tauri.conf.json` opens one window labelled `main` at 1280x800,
  with a minimum of 900x600. The prototype measured `window.innerWidth/innerHeight` as
  1280/800, so these are the webview's CSS-pixel size. Physical pixels depend on
  Windows display scaling. The test machine ran at `devicePixelRatio` 2.5.
- **Devtools and CSP.** `tauri.conf.json` sets `"security": { "csp": null }` and has no
  `devtools` or `additionalBrowserArgs` window settings. `src-tauri/Cargo.toml` enables
  no `devtools` feature on the `tauri` crate. Per
  [Tauri's debug guide](https://v2.tauri.app/develop/debug/), the inspector is then on
  only in dev and debug builds. `csp: null` is outside this ticket, but it conflicts
  with the global security rule "Never `csp: null`". Flag it for whoever owns security.
- **Theme.** The app is dark-only. `src/index.css` sets `color-scheme: dark` and a
  `#0d1117` body background. `src/App.css` has a `prefers-color-scheme` block, but
  nothing imports `App.css`; `src/main.tsx` imports only `index.css`. In the prototype,
  `prefers-color-scheme: dark` evaluated to false (WebView2 follows the Windows app
  theme), yet the captured UI was dark. The Windows theme therefore does not change
  in-app captures.
- **Terminal.** `src/slices/terminal/useTerminal.ts` `useTerminal` builds an xterm
  `Terminal` and loads only `FitAddon` and `SearchAddon`. It loads no WebGL addon, so
  xterm uses its default DOM renderer (see the [xterm.js](#3-do-xtermjs-panes-capture-cleanly)
  section). Other settings that matter for capture:
  - `cursorBlink: true`.
  - Font stack `'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace`.
  - `allowTransparency: true`.
- **Where state lives.** All of these follow environment variables, which is what makes
  a fixture folder work:
  - `src-tauri/src/slices/workspace/manager.rs` `get_storage_path` reads
    `%LOCALAPPDATA%\Quay2\workspaces.json`.
  - `src-tauri/src/slices/pty/manager.rs` `get_sessions_dir` and
    `PtyManager::load_persisted_sessions` read `%LOCALAPPDATA%\Quay2\sessions\sessions.json`
    and each `<id>.log`. Each `.log` holds a terminal's raw PTY output; the `PtySession`
    reader thread in `src-tauri/src/slices/pty/session.rs` appends to it.
  - Machina state sits under `%LOCALAPPDATA%\Quay2\machina`
    (`src-tauri/src/slices/machina/vault.rs` `machina_data_dir`).
  - The token-spend scan reads `CLAUDE_CONFIG_DIR`, else `~/.claude`
    (`src-tauri/src/slices/sessions/commands.rs` `get_claude_dir`).
- **Docs.** `docs/.vitepress/config.mts` sets `base: "/Quay-2/"` and `cleanUrls: true`.
  `docs/public/` holds only `logo.svg`. No docs page has images yet, and there is no
  custom theme folder (`docs/.vitepress/theme/`).

## 1. Manual capture

- **Fixed size.** Quay always opens at the configured 1280x800 logical size, so keep the
  window unresized. Pixel size then depends only on display scaling. Use one fixed
  setting (100% or 200%) on the capture machine; 250% would give 3200x2000 captures.
- **Native window capture includes Windows chrome.** That means the title bar
  ("Quay — Claude Code Workspace & Orchestrator"), its theme, and the window shadow.
  The title bar follows the Windows theme, because Tauri's window `theme`
  ["Defaults to the system theme"](https://v2.tauri.app/reference/config/). Pin the
  Windows theme too, or crop to the client area.
- **Tools.** [ShareX](https://getsharex.com/) is free and open source. It offers window
  and custom-region capture, GIF and screen recording, and an editor with arrows, text,
  numbered steps, highlight and blur. Windows' Snipping Tool is an alternative; it was
  not evaluated here. A manual shot is only as repeatable as the state behind it, so reuse the fixture
  folder from the [terminal content](#4-making-terminal-content-repeatable) section.

## 2. Automated capture

### 2a. Playwright `connectOverCDP` against WebView2 (prototyped: works)

How it works:

- WebView2 reads `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` when it creates its
  environment. Microsoft documents that the value
  ["is appended to the corresponding values in `CreateCoreWebView2EnvironmentWithOptions` parameters"](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#createcorewebview2environmentwithoptions),
  so wry's own arguments survive.
- [Playwright's WebView2 guide](https://playwright.dev/docs/webview2) describes this
  exact route: set `--remote-debugging-port`, then
  `chromium.connectOverCDP('http://localhost:<port>')`, then
  `browser.contexts()[0].pages()[0]`.

What the prototype established, using
[`capture-prototype.cjs`](capture-prototype.cjs) against
`src-tauri/target/release/tauri-app.exe`:

- **CDP comes up on a release build.** That build has the inspector disabled, since
  `Cargo.toml` enables no `devtools` feature. So no capture-only build is needed.
  WebView2's `AreDevToolsEnabled` setting covers
  ["the context menu or keyboard shortcuts to open the DevTools window"](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings.aredevtoolsenabled),
  not the remote-debugging port.
- **Playwright finds the app page in the default context.** The URL was
  `http://tauri.localhost/`. In one run the first page object still read
  `about:blank` at attach time, so wait for an app selector before capturing.
- **Screenshot controls work through CDP:**
  - `page.screenshot` with `animations: "disabled"`, `caret: "hide"`, `scale: "css"` and
    `mask`.
  - `locator.screenshot` on a single `.xterm` pane.
  - `Emulation.setDeviceMetricsOverride` changed the layout viewport to 1440x900, and
    the UI reflowed. The `deviceScaleFactor` part of that override did **not** take
    effect: `devicePixelRatio` stayed 2.5.

How to enable it only for dev or capture runs:

- Set the variables in the capture script's child-process environment. They work the
  same for `pnpm tauri dev`, `tauri build --debug`, or a release exe, because each
  inherits the environment. Only the release exe was tested.
- Do **not** use the `additionalBrowserArgs` window setting for this. Tauri warns that
  setting it overrides wry's defaults
  (["By default wry passes `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`"](https://v2.tauri.app/reference/config/)),
  and it would bake the port into a build.
- Always set `WEBVIEW2_USER_DATA_FOLDER` to a fresh folder:
  - Microsoft notes that because a browser process can be shared, extra switches are
    applied only by the WebView that starts it
    ([AdditionalBrowserArguments remarks](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2environmentoptions.additionalbrowserarguments)).
    If a normal Quay is already running on the default folder, a second instance's port
    could be ignored. This was not tested; the prototype always used its own folder,
    alongside a running Quay.
  - The fresh folder also resets `localStorage`, which holds rail width, chime settings
    and custom Swarm presets (`src/slices/rail/Rail.tsx`,
    `src/slices/metrics/audioChime.ts`, `src/slices/orchestrator/SwarmModal.tsx`).

Caveats:

- Playwright calls CDP
  ["significantly lower fidelity than the Playwright protocol connection"](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).
  Screenshots, locators, clicks and CDP sessions all worked in the prototype.
- **Security.** Anything on the machine that can reach the port controls the webview,
  including Tauri IPC such as `spawn_terminal`, which runs commands. Enable it only in
  capture runs, on a loopback address, and kill the process afterwards. The prototype
  connected on `127.0.0.1` and did not test which interface Chromium binds by default.
  Microsoft warns that combining this variable with `WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER`
  can expose WebView content to third-party apps
  ([WebView2 IDL](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#createcorewebview2environmentwithoptions)).

### 2b. `tauri-driver` with WebDriver

- Tauri supports this route on Windows and Linux. `cargo install tauri-driver --locked`
  installs it, and it needs `msedgedriver.exe` on `PATH`. You
  ["may experience your WebDriver testing suite hanging"](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)
  if the driver and Edge versions differ.
- The [WebdriverIO example](https://v2.tauri.app/develop/tests/webdriver/example/webdriverio/)
  builds with `tauri build --debug --no-bundle` and passes
  `tauri:options.application` on port 4444.
- Tauri now recommends `@wdio/tauri-service`
  ([Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)). Its default
  embedded provider requires adding `tauri-plugin-wdio-webdriver` to the app, which is
  a code change. The `external` provider uses `tauri-driver` without one.
- WebDriver offers only plain Take Screenshot and Take Element Screenshot
  ([W3C WebDriver](https://www.w3.org/TR/webdriver2/)). There is no built-in mask,
  animation freeze, CSS-scale or screencast; those would need injected scripts or a
  separate screen recorder.
- **Verdict:** a worse fit than 2a for screenshots. It adds a driver to keep in sync
  with the WebView2 runtime and gives fewer capture controls. It is the better fit only
  if the project later wants a WebDriver end-to-end suite anyway.

### 2c. Native window capture

- **Options:** ShareX window capture, Snipping Tool, or a Windows capture API from a
  script.
- **Pros:** works with any build and needs no port.
- **Cons:**
  - It includes Windows chrome.
  - It cannot mask or freeze UI elements.
  - Its pixel size follows display scaling.
  - Automating clicks would need UI Automation.
- **Best use:** the manual fallback.

### Comparison

| | Playwright over CDP | tauri-driver / WebDriver | Native capture |
| --- | --- | --- | --- |
| App change needed | None (environment variables only) | None (`external` provider) or a plugin (`embedded`) | None |
| Extra tooling | `playwright-core` (no browser download) | `tauri-driver` + matching `msedgedriver` | ShareX or Snipping Tool |
| Freeze animations, hide caret, mask | Built in | Manual script injection | No |
| DPI-independent output | `scale: "css"` | Not established | No |
| Video or GIF | CDP screencast + ffmpeg | External recorder | ShareX recorder (manual) |
| Prototyped here | Yes | No | No |

## 3. Do xterm.js panes capture cleanly?

**Yes.** The reasons:

- **Renderer.** Quay uses the DOM renderer. xterm.js 6.0.0 removed the canvas renderer
  addon ([6.0.0 release notes](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0)).
  `CoreBrowserTerminal._createRenderer` creates a `DomRenderer` unless an addon
  replaces it
  ([`CoreBrowserTerminal.ts`](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts)).
  The prototype found `.xterm-rows` DOM rows and no `<canvas>` inside `.xterm`.
  Terminal text is ordinary DOM, so CDP screenshots capture it like the rest of the UI.
- **Cursor blink.** The DOM renderer blinks the cursor with a CSS animation
  (`1s step-end infinite` in
  [`DomRenderer.ts`](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/renderer/dom/DomRenderer.ts)).
  Playwright's `animations: "disabled"` cancels infinite animations
  ["to initial state"](https://playwright.dev/docs/api/class-page#page-screenshot-option-animations)
  for the capture.
- **Measured repeatability:**
  - Whole-window captures repeated across cursor-blink periods alternated between two
    images. They differed by a luminance step of at most 1 (of 255) on a few dozen
    pixels around small icons in the rail footer and status strip.
  - The terminal pane itself, cursor included, did not change.
  - So byte hashes are not a reliable "screenshot changed" signal. A pixel diff with a
    tolerance is: Playwright's `toHaveScreenshot` defaults to `threshold: 0.2`
    ([visual comparisons](https://playwright.dev/docs/test-snapshots)).
- **Fonts.** The terminal font is the first installed font in the stack in
  `useTerminal`. Install Cascadia Code on the capture machine, or shots will vary by
  machine. Whether Windows 11 ships Cascadia Code by default is not established.

## 4. Making terminal content repeatable

Recorded terminal output only replays correctly at the size it was recorded at. Agent
TUIs such as Claude Code position the cursor using the terminal's column and row
counts. The asciinema format makes `width` (columns) and `height` (rows) required header
fields for this reason ([asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/)).
Quay's `FitAddon` sizes each pane from its container, so window size, layout (single or
split panes) and font must match the recording.

The options are below. They are described, not built, except Option A.

- **Option A: dormant-session fixture.** Prototyped: works, with caveats. Write
  `sessions.json`, `<id>.log` and `workspaces.json` into a fixture `LOCALAPPDATA`. On
  startup `PtyManager::load_persisted_sessions` loads the logs (the last 256 KiB, via
  `read_saved_scrollback`) as dormant buffers. `useTerminal` then writes them into
  xterm through `get_terminal_output`.
  - Cost: zero app changes.
  - Caveat: terminals show as `exited`, and `TerminalView` overlays a "Session
    Inactive — Scrollback restored from disk" ribbon with "Relaunch Agent" across the
    top terminal row.
  - Caveat: content is static. A log has no timing, so it is no good for animated
    output.
  - Good for "here is what you should see after step N" shots.
- **Option B: fake agent CLI on `PATH`.** Not built. `PtySession` spawns
  `CommandBuilder::new("claude.exe")` for Claude terminals (`session.rs`). portable-pty
  resolves a bare program name through the `PATH` in the builder's environment
  (`CommandBuilder::search_path` in
  [`cmdbuilder.rs`](https://docs.rs/portable-pty/0.9.0/src/portable_pty/cmdbuilder.rs.html)).
  So, untested, a capture-only `claude.exe` placed first on the capture process's
  `PATH` could replay an asciicast with timing. It would receive the same
  `CLAUDE_EVENTS_URL`, `CLAUDE_EVENTS_TOKEN` and `CLAUDE_EVENTS_TAG` variables, and so
  could also post recorded status events, if the bridge accepts them. Not verified.
  - Cost: no app change; a small replayer binary to build.
  - Gain: live-looking Claude terminals, animated output for GIFs, and the real icon
    and statuses.
- **Option C: capture fixture mode in the app.** Not built. An opt-in switch makes
  `PtyManager` feed recorded casts into sessions instead of spawning agents, keeping
  `run_kind` and statuses.
  - Cost: app code.
  - Gain: most control. It could also fix the ordering and port issues below.
- **Option D: live agents with a scripted prompt.** Realistic, but not repeatable;
  model output differs each run. Usable only for one-off manual shots.

### Other run-to-run variance found by the prototype

- **Terminal order is random per launch.** `PtyManager::list` returns
  `terminals_info.lock().values()` from a `HashMap`, and `Rail` renders that order
  unsorted. Two runs on the same fixture listed "Architect, Builder" and then
  "Builder, Architect", and the first-selected terminal changed with it. This is a code
  gap for multi-terminal shots such as Swarm.
- **The bridge port badge changes every launch.** The rail header shows `:<port>`, and
  `BridgeServer::start` binds `127.0.0.1:0`. Mask it (Playwright `mask`) or restyle it
  during capture.
- **The token-spend figure reads real transcripts.** Without `CLAUDE_CONFIG_DIR` set to
  a fixture folder, the first prototype capture showed the author's real spend once the
  async scan finished. This is a privacy and consistency issue; set the variable.
- **The project path shows in the status strip.** Use a neutral fixture project path,
  such as a folder under a generic `C:\tutorials\` folder, never a user-profile path.
- **The status strip wraps at 1280 and 1440 widths.** "Exited with code 0" and "Action
  Log" break onto two lines. This is cosmetic, but it shows in every full-window shot.

## 5. Annotation

- **Capture-time CSS:**
  - Playwright's `style` screenshot option applies a stylesheet only
    ["while making the screenshot"](https://playwright.dev/docs/api/class-page#page-screenshot-option-style),
    and is meant to help "creating repeatable screenshots".
  - For callouts that need geometry, inject positioned overlay elements from a
    locator's `boundingBox()`, capture, then remove them.
  - The prototype drew an outline and a numbered label around a terminal pane this
    way; see `annotated.png` in its output.
  - Annotations then live in the capture script next to the selectors, so they move
    with the UI.
- **Post-processing:** composite an SVG or arrows onto the PNG, for example with sharp
  or ImageMagick, from a per-shot spec. This keeps raw captures clean, but coordinates
  drift when layout changes. Not prototyped.
- **Manual:** the ShareX editor (arrow, text, step, highlight, blur). Fine for a
  fallback, but not reproducible.

## 6. VitePress image conventions

Checked against the 1.6.4 docs, which match the installed version.

- **Colocated images (preferred).** Reference images with relative paths next to the
  page, such as `./img/step-1.png`. VitePress says you
  ["can, and should, reference any assets using relative URLs"](https://github.com/vuejs/vitepress/blob/v1.6.4/docs/en/guide/asset-handling.md).
  Referenced assets get hashed file names, and images under 4 KB are inlined as
  base64. The same relative path works from the GitHub README, where
  ["GitHub will automatically transform your relative link"](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax).
- **`docs/public/`.** Files are copied as-is and referenced as `/path.png`. VitePress
  says you "do not need to update it when you change the `base` config value", and
  `withBase` is needed only for paths built at runtime
  ([asset handling](https://github.com/vuejs/vitepress/blob/v1.6.4/docs/en/guide/asset-handling.md)).
  With `base: "/Quay-2/"`, the base is
  ["automatically prepended to all the URLs that start with /"](https://github.com/vuejs/vitepress/blob/v1.6.4/docs/en/reference/site-config.md).
- **Light and dark.** VitePress enables dark mode by default, by adding a `.dark` class
  to `<html>` ([site config `appearance`](https://github.com/vuejs/vitepress/blob/v1.6.4/docs/en/reference/site-config.md)).
  - Light and dark image variants are built in only for the logo (`ThemeableImage`,
    [default theme config](https://github.com/vuejs/vitepress/blob/v1.6.4/docs/en/reference/default-theme-config.md)).
    Content images would need a custom theme CSS rule keyed on `.dark`.
  - Quay itself is dark-only, so each shot needs one variant. Give screenshots a thin
    border or shadow in a custom theme so dark images sit well on the light theme.
  - For the README, GitHub supports `<picture>` with `prefers-color-scheme`
    ([GitHub changelog](https://github.blog/changelog/2022-08-15-specify-theme-context-for-images-in-markdown-ga)).
- **Format and size.**
  - PNG for UI and terminal text. Measured: a 1280x800 CSS-scale PNG was about 74 KB;
    a 2.5x device-scale PNG (3200x2000) about 225 KB; one terminal pane about 34 KB.
  - Resizing 2.5x down to an exact 2x (2560x1600) made the PNG larger, about 367 KB,
    probably because resampling adds anti-aliasing noise. Capture at an integer
    scaling (100% or 200%) rather than resizing.
  - WebP quality 90 of the same 2x image was about 105 KB. Playwright 1.64 can write
    `type: "webp"` directly
    ([`page.screenshot` `type`](https://playwright.dev/docs/api/class-page#page-screenshot-option-type)).
  - These sizes come from a sparse fixture UI; busy terminals will be larger.
  - Limits: GitHub warns at 50 MiB per file and blocks over 100 MiB
    ([large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)).
    A Pages site may be at most 1 GB
    ([Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).

## 7. Cost of GIF or short video

- **Playwright over CDP: cheap.**
  - `Page.startScreencast` sends `screencastFrame` events, each acknowledged with
    `screencastFrameAck`. All three are marked experimental in the
    [protocol definition](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json)
    ([Page domain docs](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast)).
  - Measured clip: about 3 seconds while clicking from one terminal to another, frames
    saved as PNG at device scale, encoded with `ffmpeg` at 1280 wide.
  - Results: GIF (12 fps, palette) about 115 KB; H.264 MP4 about 54 KB; VP9 WebM about
    121 KB.
  - Raw device-scale PNG frames took about 31 MB on disk before encoding. Use
    `maxWidth`, `maxHeight` or `format: "jpeg"` to shrink them.
  - Playwright's own `recordVideo` is a `browser.newContext` option
    ([videos](https://playwright.dev/docs/videos)). Quay's page lives in the existing
    default context, so it does not apply. This is an inference; it was not tested.
- **tauri-driver: costly.** Video needs a separate screen recorder.
- **Native: cheap per clip but manual.** ShareX records GIF and screen video.
- **Terminal motion depends on replay.** Option A gives static scrollback, so a GIF can
  show UI navigation but not output streaming in. Animated agent output needs Option B
  or Option C.

## Recommendation

1. **Automate with Playwright `connectOverCDP`.** Launch a built Quay from a capture
   script with these environment variables only:
   - `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`
   - `WEBVIEW2_USER_DATA_FOLDER=<fresh>`
   - `LOCALAPPDATA=<fixture>`
   - `CLAUDE_CONFIG_DIR=<fixture>`

   Use `playwright-core` (no browser download). Capture with
   `animations: "disabled"`, `caret: "hide"` and a mask on the port badge, after
   waiting for app selectors and `document.fonts.ready`. Kill the process by PID
   afterwards.
2. **Fixture state per tutorial step.** Use Option A now for "what you should see"
   shots. Decide between Option B and Option C for live-looking, animated agent
   terminals. Record fixtures at the capture window's size and layout.
3. **Annotations in the capture script.** Use the `style` option or injected overlays,
   so they move with selectors.
4. **Detect changes by pixel diff with tolerance,** not byte equality.
5. **Short MP4 or GIF from the CDP screencast plus `ffmpeg`,** only where motion
   teaches something.

**Fallback:** manual ShareX or Snipping Tool capture at a fixed display scaling and
Windows theme, against the same fixture folder, annotated in the ShareX editor. If CDP
attach ever breaks, use `tauri-driver` with the `external` provider for automated
stills.

### Constraints the decision ticket should know

- Captures need Windows and a built Quay; there is no browser mode.
- The CDP port is full remote control, IPC included. Enable it only through the capture
  script's environment, never in config or builds.
- Code gaps that hurt repeatability:
  - random terminal order (`PtyManager::list` over a `HashMap`);
  - the "Session Inactive" ribbon on fixture terminals;
  - the random bridge-port badge;
  - status-strip wrapping.
- Display scaling and the installed terminal font change output, so pin both on the
  capture machine.

## Not established

- Whether `--remote-debugging-port` takes effect when another Quay is already running
  on the *default* WebView2 user data folder. The prototype always used a separate
  folder.
- Which network interface the WebView2 remote-debugging port binds by default.
- Why the CDP `deviceScaleFactor` override did not change `devicePixelRatio`.
  Viewport width and height did change.
- Whether a fake `claude.exe` on `PATH` is picked up in practice, and whether the
  bridge accepts status events from it (Option B).
- Whether Playwright `recordVideo` or `toHaveScreenshot` work with a CDP-attached
  WebView2 page.
- How VitePress 1.6.4 handles a relative `<video src>` in Markdown, and whether a
  missing relative image fails `docs:build`.
- Whether Cascadia Code is present on a stock Windows 11 install.
- `pnpm tauri dev` and `tauri build --debug` were not tested; only the release exe was.

## Prototype

[`capture-prototype.cjs`](capture-prototype.cjs) is a throwaway script, not wired into
the repo. It:

- writes a fixture `LOCALAPPDATA`, `CLAUDE_CONFIG_DIR` and WebView2 folder under a work
  folder you pass in;
- starts the exe with the variables above and attaches over CDP;
- records the DOM facts quoted here, full and pane screenshots, repeat-capture hashes,
  a 1440x900 emulated capture, an annotated capture and a short screencast;
- kills the exe.

Run it as:

```text
node capture-prototype.cjs --exe <path to tauri-app.exe> --work <empty folder> --port <1024-65535> --pw <folder with node_modules/playwright-core>
```

The captures it produced stayed outside the repo. They show machine-specific paths and,
in the first run, real spend figures.
