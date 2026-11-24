/// <reference types="node" />
// Connecting Antigravity (#732): the Project panel's row, the offer at launch and the note in an
// Antigravity terminal, with Rust faked at Tauri's `invoke`.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AntigravityConnection } from "./connectTypes.ts";

const { AntigravityRow } = await import("./AntigravityRow.tsx");
const { ConnectNote } = await import("./ConnectNote.tsx");
const { forgetAntigravity, offerConnectAgain, onConnectRowAsked, readAntigravity } = await import("./antigravity.ts");
const { ShellWarningBanner } = await import("../stage/ShellWarningBanner.tsx");
const { dismissShellWarning } = await import("../stage/shellWarnings.ts");

const FILE = "C:\\Users\\op\\.gemini\\config\\mcp_config.json";
const ENTRY = '"quay": {\n  "command": "C:\\\\Quay\\\\quay-relay.exe",\n  "timeoutSeconds": 150\n}';
const MISSING: AntigravityConnection = { file: FILE, entry: ENTRY, state: "missing", found: null, problem: null };
const CONNECTED: AntigravityConnection = { ...MISSING, state: "connected", found: ENTRY };
const OLD: AntigravityConnection = { ...MISSING, state: "old_relay", found: '"quay": {"command": "D:\\\\old\\\\quay-relay.exe"}' };
const CHANGED: AntigravityConnection = { ...MISSING, state: "changed", found: '"quay": {\n      "command": "node",\n      "mine": true\n    }' };
const UNREADABLE: AntigravityConnection = { ...MISSING, state: "unreadable", problem: "it is not JSON: trailing comma at line 1 column 19" };

/** What the file holds, what the commands refuse with, and every command called. */
let now: AntigravityConnection | null = MISSING;
let refusal: string | null = null;
let calls: { cmd: string; args: Record<string, unknown> }[] = [];
const written = () => calls.filter((c) => c.cmd !== "antigravity_connection");

let mounted: { root: Root; container: HTMLElement }[] = [];
let asked = 0;
let stopAsking = () => {};

beforeEach(() => {
  now = MISSING;
  refusal = null;
  calls = [];
  asked = 0;
  window.localStorage.clear();
  forgetAntigravity();
  stopAsking = onConnectRowAsked(() => void (asked += 1));
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "antigravity_connection") return now;
    if (refusal) throw refusal;
    now = cmd === "antigravity_connect" ? CONNECTED : MISSING;
    return now;
  });
});

afterEach(() => {
  stopAsking();
  for (const { root, container } of mounted) {
    act(() => root.unmount());
    container.remove();
  }
  mounted = [];
  act(() => dismissShellWarning("connect-antigravity"));
});

async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(node));
  return { container, rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

const text = (container: HTMLElement) => container.textContent ?? "";
const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);
const press = async (container: HTMLElement, name: string) => {
  const found = button(container, name);
  assert.ok(found !== undefined, `button ${name}`);
  await act(async () => found.click());
};
const row = (container: HTMLElement) => {
  const found = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  assert.ok(found !== null, "the row");
  return found;
};

async function openRow() {
  const view = await render(createElement(AntigravityRow));
  await act(async () => row(view.container).click());
  return view.container;
}

test("the row opens in place on the file's path and the exact entry, and writes nothing", async () => {
  const { container } = await render(createElement(AntigravityRow));
  assert.match(text(container), /Antigravity.*Not connected/);
  assert.equal(row(container).getAttribute("aria-expanded"), "false");
  assert.equal(text(container).includes(FILE), false);

  await act(async () => row(container).click());

  assert.equal(row(container).getAttribute("aria-expanded"), "true");
  const region = document.getElementById(row(container).getAttribute("aria-controls") ?? "");
  assert.equal(region?.textContent?.includes(FILE), true);
  assert.equal(region?.querySelector("pre")?.textContent, ENTRY);
  assert.equal(button(container, "Remove"), undefined);
  assert.deepEqual(written(), []);

  await act(async () => row(container).click());
  assert.equal(row(container).getAttribute("aria-expanded"), "false");
  assert.equal(row(container).hasAttribute("aria-controls"), false);
});

test("Connect writes the entry, and Remove takes out the one that is shown", async () => {
  const container = await openRow();

  await press(container, "Connect");
  assert.deepEqual(written(), [{ cmd: "antigravity_connect", args: { seen: null } }]);
  assert.match(text(container), /AntigravityConnected/);
  assert.match(text(container), /Relaunch an Antigravity terminal that is already open/);
  assert.equal(button(container, "Connect"), undefined);

  calls = [];
  await press(container, "Remove");
  assert.deepEqual(written(), [{ cmd: "antigravity_remove", args: { seen: ENTRY } }]);
  assert.match(text(container), /Not connected/);
});

test("pressing Connect, Remove or Read it again leaves focus on the row, while it runs and after", async () => {
  const container = await openRow();
  for (const [name, after] of [
    ["Connect", CONNECTED],
    ["Remove", UNREADABLE],
    ["Read it again", MISSING],
  ] as const) {
    const pressed = button(container, name);
    assert.ok(pressed !== undefined, `button ${name}`);
    let reply: (connection: AntigravityConnection) => void = () => {};
    fakeInvoke(() => new Promise((resolve) => (reply = resolve)));
    pressed.focus();
    await act(async () => pressed.click());
    assert.equal(document.activeElement === row(container), true, `${name}, while it runs`);

    await act(async () => reply(after));
    assert.equal(document.activeElement === row(container), true, `${name}, after`);
  }
});

test("an entry the operator changed is shown before it is removed or replaced", async () => {
  now = CHANGED;
  const container = await openRow();

  assert.match(text(container), /Changed/);
  const blocks = [...container.querySelectorAll("pre")].map((pre) => pre.textContent);
  assert.deepEqual(blocks, ['"quay": {\n  "command": "node",\n  "mine": true\n}', ENTRY]);

  await press(container, "Remove");
  assert.deepEqual(written(), [{ cmd: "antigravity_remove", args: { seen: CHANGED.found } }]);
});

test("a refused write says why and shows the entry that is in the file now", async () => {
  now = CONNECTED;
  const container = await openRow();
  now = CHANGED;
  refusal = "Nothing was written: the file's entry is not the one shown.";

  await press(container, "Remove");

  assert.equal(container.querySelector("[role=alert]")?.textContent, refusal);
  assert.equal([...container.querySelectorAll("pre")].some((pre) => pre.textContent?.includes('"mine": true')), true);
  refusal = null;
  await press(container, "Remove");
  assert.deepEqual(written()[written().length - 1], { cmd: "antigravity_remove", args: { seen: CHANGED.found } });
  assert.equal(container.querySelector("[role=alert]"), null);
});

test("an entry with an old relay can be connected again in its place", async () => {
  now = OLD;
  const container = await openRow();
  assert.match(text(container), /Old relay/);

  await press(container, "Connect again");

  assert.deepEqual(written(), [{ cmd: "antigravity_connect", args: { seen: OLD.found } }]);
});

test("a file that cannot be edited is named with the reason, and nothing can be pressed but reading it again", async () => {
  now = UNREADABLE;
  const container = await openRow();

  assert.equal(text(container).includes(FILE), true);
  assert.match(text(container), /it is not JSON: trailing comma at line 1 column 19/);
  assert.deepEqual([button(container, "Connect"), button(container, "Connect again"), button(container, "Remove")], [undefined, undefined, undefined]);

  now = MISSING;
  await press(container, "Read it again");
  assert.equal(button(container, "Connect") !== undefined, true);
});

test("the row reads the file again each time it opens", async () => {
  const { container } = await render(createElement(AntigravityRow));
  now = CONNECTED;

  await act(async () => row(container).click());

  assert.equal(button(container, "Remove") !== undefined, true);
});

test("a slow read does not replace a later one", async () => {
  const { container } = await render(createElement(AntigravityRow));
  const replies: ((connection: AntigravityConnection) => void)[] = [];
  fakeInvoke(() => new Promise((resolve) => replies.push(resolve)));
  await act(async () => row(container).click());
  await act(async () => row(container).click());
  await act(async () => row(container).click());
  assert.equal(replies.length, 2);

  await act(async () => replies[1](CONNECTED));
  await act(async () => replies[0](MISSING));

  assert.equal(button(container, "Remove") !== undefined, true);
});

test("a read that started while Connect was writing does not hide what it wrote", async () => {
  const container = await openRow();
  const replies: ((connection: AntigravityConnection) => void)[] = [];
  let reads = 0;
  fakeInvoke((cmd) => {
    if (cmd === "antigravity_connection" && (reads += 1) > 1) return Promise.resolve(CONNECTED);
    return new Promise((resolve) => replies.push(resolve));
  });
  await press(container, "Connect");
  await act(async () => void readAntigravity());

  await act(async () => replies[1](MISSING));
  await act(async () => replies[0](CONNECTED));

  assert.equal(button(container, "Remove") !== undefined, true);
});

test("a build that offers no surfaces has no row and no note", async () => {
  now = null;
  const { container } = await render(createElement(AntigravityRow));
  const note = await render(createElement(ConnectNote, { terminalId: "t", shown: true }));
  await act(async () => offerConnectAgain());

  assert.equal(container.innerHTML === "" && note.container.innerHTML === "", true);
});

test("asking for the row opens it and focuses it, once for each time it is asked", async () => {
  const { container, rerender } = await render(createElement(AntigravityRow, { openRequest: 1 }));
  assert.equal(row(container).getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement === row(container), true);

  await act(async () => row(container).click());
  await rerender(createElement(AntigravityRow, { openRequest: 1 }));
  assert.equal(row(container).getAttribute("aria-expanded"), "false");

  await rerender(createElement(AntigravityRow, { openRequest: 2 }));
  assert.equal(row(container).getAttribute("aria-expanded"), "true");
});

test("at launch an old relay is offered Connect again, with a link to the row, and nothing is written", async () => {
  now = OLD;
  const { container } = await render(createElement(ShellWarningBanner));

  await act(async () => offerConnectAgain());

  assert.match(text(container), /Antigravity starts an old relay/);
  await press(container, "Connect again");
  assert.equal(asked, 1);
  assert.equal(container.innerHTML, "");
  assert.deepEqual(written(), []);
});

test("at launch a missing entry is offered again only where Antigravity was connected", async () => {
  const { container } = await render(createElement(ShellWarningBanner));
  await act(async () => offerConnectAgain());
  assert.equal(container.innerHTML, "");

  // Connected, and found missing at a later launch
  await press(await openRow(), "Connect");
  now = MISSING;
  await act(async () => offerConnectAgain());
  assert.match(text(container), /Quay's entry is gone from Antigravity/);

  // Dismissed, it is not offered at the next
  await press(container, "Dismiss warning");
  await act(async () => offerConnectAgain());
  assert.equal(container.innerHTML, "");
});

test("an entry found at launch counts as connected, and one that Remove took out does not", async () => {
  const { container } = await render(createElement(ShellWarningBanner));
  now = CONNECTED;
  await act(async () => offerConnectAgain());
  assert.equal(container.innerHTML, "");
  now = MISSING;
  await act(async () => offerConnectAgain());
  assert.match(text(container), /Quay's entry is gone/);

  now = CONNECTED;
  await press(await openRow(), "Remove");
  assert.equal(container.innerHTML, "", "the offer goes with the entry");
  await act(async () => offerConnectAgain());
  assert.equal(container.innerHTML, "");
});

test("connecting takes the offer off the screen", async () => {
  now = OLD;
  const { container } = await render(createElement(ShellWarningBanner));
  await act(async () => offerConnectAgain());

  await press(await openRow(), "Connect again");

  assert.equal(container.innerHTML, "");
});

const note = (terminalId: string, shown = true) => createElement(ConnectNote, { terminalId, shown });

test("an unconnected Antigravity terminal says so once, with a link to the row", async () => {
  const first = await render(note("a"));
  assert.match(text(first.container), /Antigravity is not connected to Quay/);

  // Not in a second terminal, and not after the window loads again
  const second = await render(note("b"));
  assert.equal(second.container.innerHTML, "");
  act(forgetAntigravity);
  const later = await render(note("c"));
  assert.equal(later.container.innerHTML, "");
});

test("the note's link asks for the row and takes the note away", async () => {
  const { container } = await render(note("a"));

  await press(container, "Connect Antigravity in Settings");

  assert.equal(asked, 1);
  assert.equal(container.innerHTML, "");
});

test("the note can be dismissed, which gives focus back to its terminal", async () => {
  const { container } = await render(note("a"));
  const focused: string[] = [];
  const onFocusAsked = (event: Event) => focused.push((event as CustomEvent<{ terminalId: string }>).detail.terminalId);
  window.addEventListener("quay:focus-terminal", onFocusAsked);

  await press(container, "Dismiss the Connect note");

  window.removeEventListener("quay:focus-terminal", onFocusAsked);
  assert.deepEqual(focused, ["a"]);
  assert.equal(container.innerHTML, "");
  assert.equal(asked, 0);
});

test("a terminal that is not shown says nothing, and its note waits until it is", async () => {
  const { container, rerender } = await render(note("a", false));
  assert.equal(container.innerHTML, "");
  assert.deepEqual(calls, []);

  await rerender(note("a"));
  assert.match(text(container), /not connected/);
});

test("the note goes once Antigravity is connected", async () => {
  const { container } = await render(note("a"));
  assert.equal(container.innerHTML === "", false);

  await press(await openRow(), "Connect");

  assert.equal(container.innerHTML, "");
});

test("a terminal says nothing where there is an entry, the operator's own included", async () => {
  for (const connection of [CONNECTED, CHANGED, OLD]) {
    now = connection;
    forgetAntigravity();
    const { container } = await render(note("a"));
    assert.equal(container.innerHTML, "", connection.state);
  }
  now = UNREADABLE;
  const { container } = await render(note("z"));
  assert.match(text(container), /not connected/);
});

test("a read that fails shows nothing", async () => {
  fakeInvoke(() => Promise.reject(new Error("no")));
  const { container } = await render(createElement(AntigravityRow));
  const { container: other } = await render(note("a"));
  await act(async () => offerConnectAgain());

  assert.equal(container.innerHTML === "" && other.innerHTML === "", true);
});
