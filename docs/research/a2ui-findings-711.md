# Findings: one typed surface in the running app

**Verdict: the spec's cut works in the Tauri webview.** Every criterion was measured on a built Quay with the app's own content security policy. The 5 s verdict limit has room to spare: the slowest verdict seen was 533 ms, with the webview's CPU slowed six times. `#715` can build on this, with three changes this run found:

1. **A check sent while the webview reloads is lost and costs the whole 5 s.** 14 of 26 calls aimed at a reload were refused. Handing the unanswered checks to the page when it loads brought that to 0 of 13.
2. **A terminal's first output after a load takes the focus out of a surface.** The rest of what the operator types then goes to the agent's terminal. This is today's `useTerminal.ts` on master, not the engine. A guard fixed it.
3. **The engine only reports a failed `@checks`; it does not hold the action.** Quay's Button must.

Run on 2026-11-24, 2:29 to 3:25 AM Eastern. Code and scripts: `src/slices/stage/prototype-a2ui-live` on this branch, with the prototype's log. Review changed the code after the runs, and none of the timings were taken again: arguments of the wrong shape now get a verdict (they threw, and the call failed after 5 s), a bad `A2UI711_WAIT_S` is refused, failed `invoke` calls are noted, and an ask's part names have one home in `ask.ts`. `bundle.mjs` run on the changed code gives 567.0 kB (151.4 kB gzip) of growth, against the 566.8 kB (151.3 kB gzip) below.

## How it was run

| What | Version or setting |
| --- | --- |
| Engine | `@a2ui/react` 0.16.1, `@a2ui/web_core` 0.16.1, `zod` 3.25.76, `STRICT_VALIDATION`, `version: "1.0"` |
| Quay | This branch, 0.8.0, `vite build` and `cargo build --release --features tauri/custom-protocol`, LTO off and 16 codegen units to save time |
| Webview | WebView2 157.0.4341.60, page `http://tauri.localhost/`, 60 Hz, device pixel ratio 3 |
| Others | Tauri 2.12.3, wry 0.57.0, React 19.3.0, Vite 8.3.4, Node 26.13.1, pnpm 12.21.0, rustc 1.99.1, Windows 11 26200, Ryzen 9 5950X |
| Caller | A fake CLI in a Quay agent terminal (kind Gemini, its command replaced by a shell), posting `tools/call` to `QUAY_MCP_URL` with the terminal's own `QUAY_A2A_TOKEN` |
| Driver | `agent-tauri` to attach and read the console; Playwright over CDP for timed keys |

The path is the spec's: Rust emits a check, the webview checks on a scratch engine, Rust commits and emits the surface, the call waits up to 100 s.

## Criteria

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Two-question ask drawn in the companion, one open at a time, parts keep their input | **Works** |
| 2 | Send held by `/frame/ready`; its click gives one action with the right context | **Works**; a double-click gives two actions, and Rust refused the second |
| 3 | Unsent answer sent after a pause and on leaving; no visible lag at 340 px, 600 characters | **Works**; about 1 ms of work a key |
| 4 | Surface and unsent answer rebuilt from Rust after a real reload; same for a raw data model | **Works** |
| 5 | An agent's update while typing keeps what was typed outside its paths | **Works**, with focus and caret kept |
| 6 | No content security policy violation | **None**, with a control that shows the check sees them |
| 7 | pnpm installs the pins with no peer conflict; bundle growth recorded | **No conflict from the pins**; +566.8 kB (+151.3 kB gzip) |
| 8 | 500-component verdict against 5 s | **About 20 ms**; slowest of every run 533 ms |

### 1. Drawn in the companion

`quay_ask` with two questions arrived in the companion's Surface view, which opened by itself, 340 px wide with no sideways overflow. Nothing was selected, the agent's pick was marked, every input had a label.

| Step | Seen |
| --- | --- |
| On arrival | Question 1 open, question 2 closed, "0 of 2 answered" |
| Question 1 answered, Next | Question 2 open, question 1 closed with its answer on the row |
| Question 1 opened again | Its option and its text are back |
| Companion to Repository and back | Both answers, the open question and Send's state are back |
| Another terminal selected and back | The same |

- The engine wraps each React component in a light-DOM element with `display: contents` (`a2ui-react-column` and so on). There is no shadow root. The layout context passes through it: the root `Column` gets it and calls `buildChild(partName)`.
- What is not in the data model is not kept when a part leaves the screen. A `Tabs` with its second tab picked came back on the first.

### 2. Send

| Step | Seen |
| --- | --- |
| Click on Send before all is answered | Button `disabled`, 0 actions |
| Question 1 answered, question 2 never opened | Held |
| Both answered, then question 2 changed to spaces | Free, then held again |
| One click | 1 action; the call returned `{"answers":[{"question":"Which base should this branch take?","chosen":["Merge master in"],"text":"keep the tags"},{"question":"What should the release note say about the new behaviour?","chosen":[],"text":"Say it is faster"}]}` |
| Enter on the focused button | 1 action |
| Double-click | 2 engine actions 1 ms apart; Rust logged `ANSWERED`, then `SECOND ANSWER refused` |
| Answer carrying revision 1 of 10 | `stale`, refused |

**The engine does not enforce `@checks`.** In Node, with `/frame/ready` unset, the Button's `isValid` is `false` and calling its `action` still dispatches. The hold is the `disabled` attribute that Quay's component sets (`engine-probe.mjs`).

### 3. Typing and the unsent answer

600 key presses each, through CDP, into the first question's text box. "Work" is from `keydown` to the end of React's update. "Frame" is to the next frame. All times in ms. Every run ended with the exact text.

| Case | Work, median / 95% / max | Frame, median / 95% / max | Long frames (over 50 ms) |
| --- | --- | --- | --- |
| Plain `<textarea>`, 12.5 keys a second | 0.5 / 0.8 / 1.3 | 10.0 / 17.1 / 19.5 | 0 |
| Two-question ask, 12.5 a second | 1.0 / 1.8 / 2.4 | 10.3 / 17.7 / 19.8 | 0 |
| Plain `<textarea>`, 33 a second | 0.5 / 0.7 / 1.0 | 9.8 / 17.3 / 33.7 | 0 |
| Two-question ask, 33 a second | 0.9 / 1.3 / 2.0 | 10.0 / 17.6 / 33.7 | 0 |
| The same, its terminal printing without pause | 0.8 / 1.2 / 2.4 | 10.9 / 17.7 / 23.3 | 0 |
| The same, a 500 ms pause every 20 keys | 1.2 / 3.2 / 5.0 | 11.3 / 18.8 / 25.1 | 0 |
| Largest ask the limits allow, 33 a second | 0.8 / 1.2 / 2.2 | 10.0 / 17.5 / 33.7 | 0 |
| Raw, 230 kB call with its data model, 12.5 a second | 0.8 / 1.3 / 2.2 | 9.8 / 17.3 / 22.3 | 0 |
| Raw, 500 components on screen, 12.5 a second | 1.3 / 2.1 / 3.7 | 11.2 / 18.3 / 23.7 | 0 |

- The frame time is that of a plain text box, so there is no visible lag. One key redraws one `TextField`, not the card.
- **Pause:** 400 ms. The run with pauses sent the answer 30 times; each took 3 to 9 ms to Rust and back. Finding what changed took 0.2 ms at most, and 1.9 ms for the 230 kB surface.
- **Leaving the screen** sends it at once. Log: `ask_5 DRAFT (left) revision=1 of 1 entries=6 bytes=168`.
- **Unbroken typing sends nothing until it pauses**, so a renderer that dies loses what was typed since the last pause. Measured with `Page.crash`: "kept before the crash" came back and " lost in the crash" did not. Quay did not recover the crashed page by itself in the 20 s before it was reloaded.
- What is held is a map from data path to value, holding only what differs from the accepted state, and the revision it was read at.

### 4. Reload

| Case | Seen |
| --- | --- |
| Ask half answered, `Page.reload` | Both answers, the open question, the opened questions and a free Send are back. Navigation type `reload`. |
| The same, `location.reload()` | The same |
| Reload right after the last key, inside the 400 ms pause, both ways | Nothing lost: a `pagehide` listener's `invoke` reaches Rust |
| Sent after four reloads | The call that was open throughout returned the answer, 21 s after it began |
| Raw surface: text, checkbox and choice | Rebuilt; fields the operator had not touched are the agent's |
| Raw surface updated by its agent, then reloaded | The agent's values and what was typed outside them |

- **Time to rebuild**, every page load in the log but those after 07:44:30 in the first run. "Rebuild" is from the page asking for the list to the last surface built. "Done" is counted from the start of the navigation. Minimum / median / maximum in ms. Most of the final build's surfaces from the fourth row on have 500 components.

| Build | Surfaces | Loads | Rebuild | Done |
| --- | --- | --- | --- | --- |
| Final | 0 | 3 | 25 / 27 / 32 | 218 / 322 / 340 |
| Final | 1 to 9 | 9 | 37 / 129 / 220 | 223 / 350 / 464 |
| Final | 10 to 16 | 11 | 152 / 179 / 248 | 341 / 406 / 447 |
| Final | 20 and 21 | 3 | 452 / 457 / 547 | 775 / 777 / 888 |
| Final | 24 to 26 | 11 | 348 / 406 / 449 | 611 / 656 / 733 |
| First | 0 | 18 | 16 / 36 / 58 | 213 / 273 / 419 |
| First | 1 to 9 | 37 | 39 / 74 / 145 | 249 / 285 / 395 |
| First | 12 | 2 | 93 / 103 / 112 | 300 / 313 / 326 |
| First | 17 to 23 | 20 | 161 / 246 / 506 | 384 / 499 / 918 |

- After a reload the companion opens on Repository, not on the Surface view. The spec says what selecting a terminal opens, not what a reload opens.
- **Checks during a reload.** A check is an event. One sent before the new page listens is lost.

| Call sent this long after the reload began | As the spec has it, two runs | With unanswered checks handed over on load |
| --- | --- | --- |
| 0, 10, 20, 40, 60, 80 ms | 12 of 12 refused after 5,003 to 5,017 ms | 6 of 6 shown, 221 to 274 ms |
| 100, 130, 160 ms | 2 of 6 refused | 3 of 3 shown, 44 to 60 ms |
| 200, 250, 300, 400 ms | 8 of 8 shown | 4 of 4 shown, 39 to 136 ms |

A check answered by both the old event and the hand-over gives a second verdict, which Rust drops (`LATE VERDICT dropped`). While a lost check runs out its 5 s, every terminal's calls wait behind it: this prototype checks and commits one call at a time for the whole of Quay (`checking` in `a2ui_live.rs`). #706 asks for one at a time per terminal, under which only that terminal's calls would wait; that was not built or measured.

### 5. Update while typing

| Agent's update | What the operator had | After it |
| --- | --- | --- |
| `/status`, then a relabelled `TextField`, then `/meta/owner`, during 87 keys into Note | Focus in Note, caret at its end | All 87 keys, focus and caret kept; label, status and owner changed |
| `/status` inside the pause after typing in Owner | Owner "operator", not yet sent | Owner kept |
| `/meta/owner` | Owner "operator" | Owner is the agent's; Note kept |
| `/meta` | Owner "operator again" | Owner is the agent's; Note kept |
| Two updates while another terminal was selected | Owner typed just before | Owner kept |
| No `path` (the same as `/`) | Note typed | **Everything is the agent's, all that was typed is gone.** In the engine `/frame` goes too. |
| `/status` in the middle of an IME composition | 日本 | Composition went on to 日本語 |
| An unsent answer read before an update and arriving after it | | Rust dropped the path the update set and kept the rest |

Typing in the middle of the text kept the caret, and Ctrl+Z worked.

**Focus.** The first time a terminal prints after it is mounted, `useTerminal.ts` (`firstPtyOutputFocused`) focuses its xterm. With an update arriving just after a reload, the surface lost the focus after 8 of 21 keys and the other 13 went to the terminal. Skipping that focus when the active element is an input outside the pane left all 21 in the surface, over two updates. `scheduleFocus` in the same file focuses the terminal five times in the 500 ms after it is selected; that was read, not measured.

### 6. Content security policy

Policy sent by Tauri with the page, from its response header: `base-uri 'none'; default-src 'self'; img-src 'self' blob:; script-src 'self' 'sha256-…' (three hashes); connect-src ipc: http://ipc.localhost https://api.github.com; style-src 'self' 'unsafe-inline'; form-action 'none'; frame-src 'none'; object-src 'none'`.

| Step | `securitypolicyviolation` events | Security entries in the log |
| --- | --- | --- |
| Load | 0 | 0 |
| Ask, a surface of 16 component kinds with `formatString`, `formatDate` and a `regex` check, 500 components, a rejected update, a rejected create, an answer | 0 | 0 |
| Control: `new Function`, an inline script, a remote image, a remote `fetch` | 4, one each | Reported |

- The listener was installed before any page script ran.
- While surfaces were drawn the page asked only for `http://ipc.localhost` and one `data:` icon of the browser's own date input. The remote `Image`, the Markdown image and the raw `<script>` in Markdown asked for nothing and made no element.
- The engine added no style sheet: 0 adopted sheets and 6 `<style>` elements, before and after.

### 7. Packages and bundle

| Check | Seen |
| --- | --- |
| `pnpm peers check`, this branch with the pins | 5 conflicts, none of them the engine's: `@docsearch/react` (three), `eslint-plugin-jsx-a11y`, `vitepress-plugin-mermaid` |
| The same on `301d9d3`, the branch's base on master | The same 5 |
| The same on this branch before the change | 6: `@a2ui/markdown-it` 0.2.2 wants `@a2ui/web_core` ^0.14.0. That direct dependency was imported by nothing and is removed. |
| `pnpm why zod` | One `zod` 3.25.76 under the engine. `zod` 4.6.7 is there too, under `eslint-plugin-react-hooks` only. |
| `pnpm install --frozen-lockfile` | Passes |

- **pnpm 12 holds back packages published in the last 24 hours.** 0.16.1 was published 2026-11-23 18:34 to 18:37 UTC, so this run's install wrote three `minimumReleaseAgeExclude` lines into `pnpm-workspace.yaml`. They were taken out again. A build ticket installing after 2026-11-24 18:37 UTC should not see them, and they should not be committed.
- `@a2ui/react` still installs `@a2ui/markdown-it` 0.2.4, `markdown-it` and `dompurify`. None of them is in the bundle.

| Build, `bundle.mjs` | JS | gzip |
| --- | --- | --- |
| Quay without the A2UI module | 2,346.1 kB | 665.7 kB |
| Quay with it in the main chunk | 2,912.8 kB | 817.0 kB |
| **Growth**, this prototype's own components included; CSS does not grow | **566.8 kB** | **151.3 kB** |
| With it in a chunk of its own: that chunk | 562.5 kB | 150.3 kB |
| Engine alone, React external, surface and core | 396.0 kB | 103.9 kB |
| Engine alone, with the basic catalog to derive from | 509.3 kB | 134.0 kB |
| `markdown-it` alone, not used by this prototype, so to be added | 135.9 kB | 54.7 kB |

The main chunk holds everything today, so without `import()` the engine is parsed at every start.

### 8. Verdict for 500 components

"Verdict" is Rust's clock from the event to the answer. "Webview" is the check alone. "Call" is the CLI's whole HTTP call. Minimum / median / maximum in ms, final build.

| Case | Calls | Verdict | Webview | Call |
| --- | --- | --- | --- | --- |
| First after a reload | 1 | 29 | 18 | 67 |
| 500 mixed components, 48 kB | 15 | 18 / 20 / 43 | 9 / 10 / 25 | 54 / 61 / 108 |
| 500 `Text` in one `Column` | 10 | 17 / 21 / 28 | 8 / 10 / 14 | 51 / 70 / 93 |
| 500 mixed, 151 kB | 10 | 28 / 32 / 35 | 9 / 11 / 14 | 67 / 76 / 97 |
| 500 mixed, 277 kB, data model about 230 kB | 10 | 48 / 52 / 56 | 11 / 11 / 14 | 100 / 111 / 133 |
| 501 components, refused | 5 | 29 / 32 / 37 | 9 / 9 / 13 | 67 / 70 / 85 |
| 500 `Text`, operator typing | 5 | 31 / 34 / 40 | 8 / 9 / 12 | 73 / 78 / 87 |
| 500 mixed, another terminal printing without pause | 8 | 56 / 93 / 128 | 17 / 22 / 30 | 120 / 188 / 239 |
| 500 mixed, webview CPU slowed 6 times | 8 | 204 / 237 / 364 | 80 / 103 / 158 | 248 / 296 / 420 |
| 277 kB, webview CPU slowed 6 times | 5 | 349 / 402 / 533 | 129 / 165 / 181 | 425 / 462 / 598 |
| 500 mixed, window minimised | 6 | 20 / 36 / 38 | 10 / 19 / 22 | 70 / 108 / 112 |
| 500 mixed, minimised for over 6.5 minutes | 8 | 24 / 35 / 48 | 13 / 21 / 27 | 65 / 98 / 137 |

- Drawing one (1,472 elements): 33 to 40 ms from the check's arrival to the live engine, then 25 to 42 ms to the screen.
- WebView2 reports `visible` while the window is minimised, so nothing may wait for `visibilitychange` there.
- Only a reload (criterion 4) came near 5 s.

## Also seen

- **Strict mode lets no update remove a component.** Leaving a child out of its parent's list makes it an orphan and the update is refused. A delete and a create of the id in one call works.
- An update must carry the whole component. One that leaves out a required property is refused.
- The engine throws `code: "VALIDATION_ERROR"` with no path. `VALIDATION_FAILED` and the path come from `mapErrorToRendererMessage`.
- `/frame/ready`, written on every draw, is enough to make an unsent answer of an untouched ask. It follows from the rest and need not be held.

## Not tested, and why

- **A real CLI.** The fake one uses the same route and token; #693 made the round trip in three CLIs.
- **The typed-in answer after the wait, dismissal, reopening and rejoin.** Not in this ticket. In this prototype a second call on a surface ends the first one's wait.
- **Review and board, `Icon` and `List`.** One typed tool was asked for. Markdown was drawn by the look prototype's parser, not by `markdown-it`.
- **A real IME, a real screen reader, a hand on the keyboard.** Keys and composition came through CDP. F5 sent that way does not reload, so the two reloads tested are CDP's and the page's own.
- **A slow machine.** The CPU was slowed for the webview only, on a fast desktop. Memory pressure was not tried.
- **macOS and Linux.** Windows only.
- **The shipped release profile's LTO.** Only LTO and the number of codegen units differ.
- The frame's CLI label was fixed to "Claude Code", and dismiss did nothing.

A parallel session launched its own Quay with the same CDP port at 07:44:30 UTC and drove this one. Runs after that were dropped and repeated on a port of its own. No user configuration file was touched; nothing had to be restored. Every process started was stopped.

## Spec changes

Each block gives the text in #706 that a finding contradicts, and its replacement. What #706 only leaves out is under "Gaps" below, without a replacement.

**1. Modules.** Replace

> Rust keeps that state, which is enough to rebuild the scratch copy and to redraw after a webview reload. The webview asks for the whole list when it loads.

with

> Rust keeps that state, which is enough to rebuild the scratch copy and to redraw after a webview reload. When it loads, the webview first listens, then asks for the whole list, then for every check that has no verdict yet and answers those too: a check sent while it was loading reached nobody. A second verdict for one check is dropped.

**2. A surface's life, the unsent answer.** Replace

> **The unsent answer** (text, choices, opened questions, dropped items, a raw surface's data model) is held in the store beside its surface, sent from the webview after a short pause in typing and when the surface leaves the screen. It survives switching terminals, a move between companion and tab, and a webview reload. It goes when the surface is settled, dismissed or removed. An agent's update keeps what the operator has typed, except the data paths that update sets.

with

> **The unsent answer** (text, choices, opened questions, dropped items, a raw surface's data model) is held in the store beside its surface, sent from the webview 400 ms after the last change, when the surface leaves the screen, when an update is drawn and on `pagehide`. It is a map from data path to value of what differs from the accepted state, with the revision it was read at; what the frame can work out again, such as `/frame/ready`, is left out. It survives switching terminals, a move between companion and tab, and a webview reload. What was typed since the last pause is lost if the renderer dies. Only the data model is kept: a tab picked inside a surface, a text box's height and its undo are not. It goes when the surface is settled, dismissed or removed. An agent's update keeps what the operator has typed, except the data paths that update sets, the paths under them and the paths that hold them. An update with no path, or `/`, sets everything. Rust drops those paths when it commits the update, and again from an unsent answer read before it that arrives later.

**3. Typed surfaces on the engine.** Replace

> The frame writes its own state under `/frame` in the data model. Buttons read it: `@checks` on `/frame/ready` holds Send, and a label bound to `/frame/approveLabel` reads "Approve without 2 items".

with

> The frame writes its own state under `/frame` in the data model. Buttons read it: `@checks` on `/frame/ready` holds Send, and a label bound to `/frame/approveLabel` reads "Approve without 2 items". The engine only reports a failed check and still dispatches the action, so Quay's Button is disabled while `isValid` is false and its handler refuses as well.

**4. Validation, the engine's errors.** Replace

> - The engine's `code` and `message` pass through. Quay's own errors use `VALIDATION_FAILED`, and `INTEGRITY_ERROR` for ids.

with

> - The engine's errors go through its `mapErrorToRendererMessage`, whose `code`, `path` and `message` pass through; the thrown error has another code (`VALIDATION_ERROR`) and no path. Quay's own errors use `VALIDATION_FAILED`, and `INTEGRITY_ERROR` for ids.

**5. Where surfaces appear, arrival.** Replace

> A tab appears pulsing and never takes the stage. A strip arrives folded. No toast.

with

> A tab appears pulsing and never takes the stage. A strip arrives folded. No toast. A terminal never takes the focus from a field in a surface: today's focus on a terminal's first output (`src/slices/terminal/useTerminal.ts`, `firstPtyOutputFocused`) skips when the active element is an input outside the pane.

**6. Further Notes, the heading of the engine table.** Replace

> **Run on `@a2ui/react` and `@a2ui/web_core` 0.16.1, 2026-11-23** (Node and happy-dom, strict mode; not in the Tauri webview). These are the contract tests' first cases.

with

> **Run on `@a2ui/react` and `@a2ui/web_core` 0.16.1, 2026-11-23** (Node and happy-dom, strict mode), and in the built Tauri webview on 2026-11-24 for #711. These are the contract tests' first cases.

**7. Further Notes, rows of that table.** Replace

> | Unknown component, unknown function, bad property | `VALIDATION_FAILED` with a path inside the message body |

with

> | Unknown component, unknown function, bad property | Thrown as `VALIDATION_ERROR`; mapped to `VALIDATION_FAILED` with a path inside the message body |

and

> | Bundle, React external | 406 kB (110 kB gzip) for surface and core; 522 kB (141 kB) once the basic catalog is there to derive from. Lit stays in both. |

with

> | Bundle, React external | 396 kB (104 kB gzip) for surface and core; 509 kB (134 kB) once the basic catalog is there to derive from. Lit stays in both. In Quay's own build, with the prototype's components: 567 kB (151 kB). `markdown-it` adds 136 kB (55 kB). |

**8. Further Notes, unproven.** Replace

> Still unproven: the looks and the engine in the Tauri webview; telling a network path from a local disk on macOS and Linux;

with

> Still unproven: the looks in the Tauri webview, apart from a live ask's and a live raw surface's in the companion; `Icon`, `List` and Markdown through `markdown-it` there; telling a network path from a local disk on macOS and Linux;

## Gaps in #706 that this run met

Nothing here contradicts #706, so there is no replacement text.

- **Validation.** Under "Whole after every call" no update can take a component away: one left out of its parent is an orphan (`INTEGRITY_ERROR`). Delete and create in one call works. An update must carry each component whole.
- **Focus.** `scheduleFocus` in `useTerminal.ts` would take the focus as the first output does. It was read, not measured, and is unchanged here.
- **Companion.** #706 does not say which view a reload opens.
- **Send.** A double-click dispatches twice before anything is redrawn. Rust's one answer per surface holds.
- **Engine module.** #706 does not say whether it is in the main chunk. It was measured both ways (criterion 7).
- **Packages.** #706 does not mention pnpm's `minimumReleaseAgeExclude`. No such line is needed or committed.
- **Rows the engine table could gain:** a Button's action called while its `@checks` fail is dispatched; an update that drops a child is `INTEGRITY_ERROR` for the orphan; `updateDataModel` with no path, or `/`, replaces the whole model, `/frame` included; in the webview 500 components are checked in about 10 ms with a verdict in about 20 ms, 533 ms at worst with the CPU slowed 6 times.

No change to the 5 s verdict, the 500 components or the 256 kB.
