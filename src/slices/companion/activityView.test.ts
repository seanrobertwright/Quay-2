/// <reference types="node" />
// Component tests for the companion's Activity view (#644): the selected terminal's tool calls,
// with expandable output, merged with its messages; the message strip that sends it a task; and
// its pending permission request answered in place. They render the real companion over the real
// attention queue hook, and fake only Tauri's `invoke`, the out-of-process boundary:
// `get_pending_permissions` lists the requests the backend holds, `resolve_permission` takes an
// answer, and `a2a_send_prompt` sends a message.
import { fakeInvoke } from "../../test-support/dom.ts";
import { installShellLook } from "../../test-support/shellLook.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Envelope } from "../bridge/useBridgeEvents.ts";
import type { TrailMessage } from "../orchestrator/trailMessages.ts";
import type { CompanionShowRequest } from "./Companion.tsx";
import { companionPrefs } from "./companionPrefs.ts";
import { memoryStorage, terminalInfo } from "./fixtures/companionFixtures.ts";

const { Companion, REPOSITORY_VIEW, ACTIVITY_VIEW } = await import("./Companion.tsx");
const { useAttentionQueue } = await import("../attention/useAttentionQueue.ts");

const PROJECT = "E:/alpha";
const agent = terminalInfo("a", PROJECT);
const projects = [{ path: PROJECT, name: "Alpha", terminal_ids: ["a"] }];

const event = (seq: number, type: string, ts: number, data: Record<string, unknown>): Envelope => ({
  v: 1,
  boot: "boot",
  seq,
  ts,
  sessionId: "session",
  tag: agent.id,
  type,
  data,
});
const EVENTS = [
  event(2, "tool.finished", 2_000, { tool: "Bash", toolUseId: "t1", input: { command: "pnpm test" }, text: "12 passed", status: "ok" }),
  event(1, "tool.started", 1_000, { tool: "Bash", toolUseId: "t1", input: { command: "pnpm test" } }),
];
const MESSAGES: TrailMessage[] = [
  {
    id: "m1",
    from_terminal: "user",
    from_name: "You",
    to_terminal: agent.id,
    to_name: agent.name,
    content: "run the tests",
    as_user: true,
    timestamp: 500,
    status: "completed",
    response: "All 12 pass",
  },
];

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
});

interface Backend {
  pending?: Record<string, unknown>[];
  /** Every command the companion sent, with its arguments, in order. */
  calls: { command: string; args: Record<string, unknown> }[];
}

/** Renders the companion on the Activity view for `agent`, over a backend holding `pending`. */
async function render({ pending = [], showRequest = null }: { pending?: Record<string, unknown>[]; showRequest?: CompanionShowRequest | null } = {}) {
  const backend: Backend = { pending, calls: [] };
  fakeInvoke(async (command, args) => {
    backend.calls.push({ command, args });
    if (command === "get_pending_permissions") return pending;
    if (command === "resolve_permission" || command === "a2a_send_prompt") return null;
    throw new Error(`no fake for ${command}`);
  });
  const prefs = companionPrefs(memoryStorage({ quay_companion_opens_on: "activity" }));
  const Shell: FC<{ request: CompanionShowRequest | null }> = ({ request }) => {
    const queue = useAttentionQueue([agent]);
    return createElement(Companion, {
      selectedTerminal: agent,
      projects,
      projectWorktrees: {},
      views: [REPOSITORY_VIEW, ACTIVITY_VIEW],
      prefs,
      activity: { events: EVENTS, messages: MESSAGES, waiting: queue.items, answer: queue.answerPermission },
      showRequest: request ?? { terminalId: agent.id, view: "activity", seq: 1 },
    });
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(Shell, { request: showRequest })));
  await settle();
  return { backend, container, rerender: (request: CompanionShowRequest) => act(async () => root.render(createElement(Shell, { request }))) };
}

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const view = () => document.querySelector('[data-companion-view="activity"]') as HTMLElement;
const entries = () => [...view().querySelectorAll('ol[aria-label="Activity"] > li')];
function button(name: string): HTMLButtonElement {
  const found = [...view().querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
  assert.equal(found.length, 1, `one button named "${name}", found ${found.length}`);
  return found[0];
}

test("Activity lists the terminal's messages and tool calls oldest first, each call's output behind a toggle", async () => {
  await render();
  const rows = entries();
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent ?? "", /You.*run the tests.*All 12 pass/);
  assert.match(rows[1].textContent ?? "", /Bash.*pnpm test/);
  assert.doesNotMatch(rows[1].textContent ?? "", /12 passed/, "output starts folded");

  const toggle = button("Show output of Bash pnpm test");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(entries()[1].textContent ?? "", /12 passed/);
});

test("the message strip sends a task to the terminal's agent as the operator, then clears", async () => {
  const { backend } = await render();
  const field = view().querySelector("textarea") as HTMLTextAreaElement;
  assert.equal(field.getAttribute("aria-label"), `Message to ${agent.name}`);

  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
    setValue.call(field, "fix the flaky test");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Send").click());
  await settle();

  assert.deepEqual(
    backend.calls.filter((c) => c.command === "a2a_send_prompt").map((c) => c.args),
    [{ request: { from_terminal: "user", to_terminal: agent.id, prompt: "fix the flaky test", as_user: true } }],
  );
  assert.equal(field.value, "");
});

test("a pending permission request shows at the top with Allow once, Allow for session and Deny, answered in place", async () => {
  const { backend } = await render({
    pending: [{ requestId: "req-1", sessionId: "s", tag: agent.id, tool: "Bash", input: { command: "rm -rf dist" } }],
  });
  const request = view().querySelector('[aria-label="Permission request"]') as HTMLElement;
  assert.ok(request, "the request shows");
  assert.ok(view().firstElementChild?.contains(request), "at the top of the view");
  assert.match(request.textContent ?? "", /Bash.*rm -rf dist/);
  for (const name of ["Allow once", "Allow for session", "Deny"]) button(name);

  await act(async () => button("Allow for session").click());
  await settle();

  assert.deepEqual(
    backend.calls.filter((c) => c.command === "resolve_permission").map((c) => c.args),
    [{ requestId: "req-1", decision: "allow", reason: null, rememberForSession: true }],
  );
  assert.equal(view().querySelector('[aria-label="Permission request"]'), null);
});

/** A request the backend holds for `agent`, as `get_pending_permissions` lists it. */
const pendingRequest = (tool: string, input: unknown, requestId = "req-1") => ({ requestId, sessionId: "s", tag: agent.id, tool, input });
/** The same, with the agent's reason. */
const reasonedRequest = (reason: string) => ({ ...pendingRequest("Bash", { command: "pnpm test" }), reason });
const requests = () => [...view().querySelectorAll<HTMLElement>('[aria-label="Permission request"]')];
/** Each pending request's scroll box for the rest of its input. */
const inputBoxes = () => [...view().querySelectorAll<HTMLElement>('[role="group"][aria-label^="Rest of the "]')];
/** The request's code block: what it works on, such as its command. */
const codeBlock = () => requests()[0].querySelector<HTMLElement>('[role="group"][aria-label^="Summary of the "]');
/** The request's inset for the agent's reason, named by the label Quay writes. */
const reasonInset = () => {
  const label = [...requests()[0].querySelectorAll("p")].find((p) => p.textContent === `${agent.name} says`);
  return label ? requests()[0].querySelector<HTMLElement>(`[role="group"][aria-labelledby="${label.id}"]`) : null;
};
/** The labelled blocks in a scroll box, each as its name and its value. */
const blocks = (box: HTMLElement) =>
  [...box.querySelectorAll('[role="group"][aria-labelledby]')].map((block) => [
    document.getElementById(block.getAttribute("aria-labelledby") ?? "")?.textContent,
    block.querySelector("pre")?.textContent,
  ]);

test("a permission request carries the Quay mark: an edge and glow in the pie palette's accent, and the QUAY badge", async () => {
  installShellLook("tron");
  await render({ pending: [pendingRequest("Bash", { command: "pnpm test" })] });
  const card = requests()[0];
  assert.equal(getComputedStyle(card).borderColor, "#18e0ff");
  assert.equal(getComputedStyle(card).boxShadow, "0 0 3px #18e0ff, 0 0 12px rgba(24, 224, 255, 0.22)");
  installShellLook("sunset");
  assert.equal(getComputedStyle(card).borderColor, "#ff3d81", "the edge follows the palette");
  assert.match(getComputedStyle(card).boxShadow, /#ff3d81/, "so does the glow");

  const badge = [...card.querySelectorAll("span")].find((span) => span.textContent === "QUAY");
  assert.ok(badge !== undefined, "the badge is text");
  assert.ok(!badge.closest('[aria-hidden="true"]'), "a screen reader reads it");
});

test("a permission request's title and icon are amber on Quay's plain ground, with no amber border or tint", async () => {
  await render({ pending: [pendingRequest("Bash", { command: "pnpm test" })] });
  const card = requests()[0];
  const title = card.querySelector("h3");
  assert.equal(title?.textContent, "Permission request");
  // The classes, as the test DOM compiles no Tailwind.
  assert.ok(title?.classList.contains("text-[#e3b341]"));
  const icon = card.querySelector('svg[aria-hidden="true"]');
  assert.ok(icon?.classList.contains("text-[#e3b341]"));
  assert.ok(card.classList.contains("bg-[#161b22]"));
  // A border colour utility would win over the mark's edge.
  assert.deepEqual([...card.classList].filter((name) => name.startsWith("border")), ["border"]);
  assert.ok(!card.parentElement?.innerHTML.includes("d29922"), "the old amber is gone");
});

test("a request says in Quay's words which terminal asks to use which tool, with the command apart in a code block", async () => {
  const command = "cat <<'EOF'\n  **two**  spaces\n\thttp://example.com [x](http://y) <a href='z'>z</a>\nEOF";
  await render({ pending: [pendingRequest("Bash", { command })] });
  assert.equal(requests()[0].querySelector("p")?.textContent, "term-a asks to use Bash");
  const block = codeBlock();
  assert.equal(block?.getAttribute("aria-label"), "Summary of the Bash input");
  assert.equal(block?.querySelector("pre > code")?.textContent, command, "verbatim");
  const pre = block?.querySelector("pre");
  assert.ok(pre?.classList.contains("whitespace-pre-wrap"), "newlines and spaces are kept");
  assert.ok(pre?.classList.contains("wrap-anywhere"), "a long unbroken line wraps");
  assert.equal(block?.querySelectorAll("a, b, i, strong, em").length, 0, "neither Markdown nor a link");
  assert.ok(block?.textContent === command, "Quay's own words are outside the block");
});

test("the agent's reason is inset under a label naming its terminal, verbatim", async () => {
  const reason = "**Trust me**\n  [allow](http://y) <b>now</b>";
  await render({ pending: [reasonedRequest(reason)] });
  const inset = reasonInset();
  assert.equal(inset?.textContent, reason);
  assert.ok(inset?.querySelector("p")?.classList.contains("whitespace-pre-wrap"), "newlines and spaces are kept");
  assert.equal(inset?.querySelectorAll("a, b, i, strong, em").length, 0, "neither Markdown nor a link");
});

test("a request with no reason, or with an input nothing summarises, draws no empty box for it", async () => {
  await render({ pending: [pendingRequest("mcp__list__add", { item: 1 })] });
  assert.ok(reasonInset() === null);
  assert.ok(codeBlock() === null);
  assert.equal(inputBoxes().length, 1);
});

test("a long command and a long reason each scroll in their own box, reached by keyboard, and the answers follow them", async () => {
  await render({ pending: [{ ...pendingRequest("Bash", { command: "echo x\n".repeat(200) }), reason: "because\n".repeat(200) }] });
  for (const box of [codeBlock(), reasonInset()]) {
    assert.ok(box?.classList.contains("overflow-auto"));
    assert.ok([...(box?.classList ?? [])].some((name) => name.startsWith("max-h-")), "a bounded height");
    assert.equal(box?.tabIndex, 0);
    for (const name of ["Allow once", "Allow for session", "Deny"]) {
      assert.ok(!box?.contains(button(name)), name);
      assert.ok((box?.compareDocumentPosition(button(name)) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING, name);
    }
  }
});

test("a Write request shows its path and its content, newlines kept, with nothing to click first", async () => {
  await render({ pending: [pendingRequest("Write", { file_path: "src/a.ts", content: "one\n  two\n" })] });
  assert.match(requests()[0].textContent ?? "", /Write.*src\/a\.ts/);
  assert.equal(inputBoxes().length, 1);
  assert.deepEqual(blocks(inputBoxes()[0]), [["content", "one\n  two\n"]]);
  const value = inputBoxes()[0].querySelector("pre")!;
  assert.ok(value.classList.contains("whitespace-pre-wrap"), "newlines and spaces are kept");
  assert.ok(value.classList.contains("wrap-anywhere"), "a long unbroken line wraps");
});

test("a request from an MCP tool with a path shows its other arguments, nested ones as indented JSON", async () => {
  await render({
    pending: [pendingRequest("mcp__files__copy", { path: "src", to: "dist", options: { deep: true, skip: ["a"] }, depth: 3, force: false, mode: null })],
  });
  assert.deepEqual(blocks(inputBoxes()[0]), [
    ["to", "dist"],
    ["options", '{\n  "deep": true,\n  "skip": [\n    "a"\n  ]\n}'],
    ["depth", "3"],
    ["force", "false"],
    ["mode", "null"],
  ]);
});

test("the box is about ten lines high, then scrolls", async () => {
  await render({ pending: [pendingRequest("Write", { file_path: "src/a.ts", content: "line\n".repeat(50) })] });
  // Ten lines of 1rem and the box's 1rem of padding, as classes: the test DOM lays nothing out.
  for (const name of ["max-h-44", "leading-4", "p-2", "overflow-auto"]) assert.ok(inputBoxes()[0].classList.contains(name), name);
});

test("the scroll box's accessible name includes the tool", async () => {
  await render({ pending: [pendingRequest("Write", { file_path: "src/a.ts", content: "one" })] });
  assert.equal(inputBoxes()[0].getAttribute("aria-label"), "Rest of the Write input");
});

test("an input that is not a plain object is one JSON value with no name, with no code block", async () => {
  await render({ pending: [pendingRequest("mcp__list__add", ["a", { b: 1 }])] });
  assert.equal(requests()[0].querySelector("p")?.textContent, "term-a asks to use mcp__list__add");
  assert.ok(codeBlock() === null);
  const box = inputBoxes()[0];
  assert.equal(box.querySelector("pre")?.textContent, '[\n  "a",\n  {\n    "b": 1\n  }\n]');
  assert.deepEqual(box.querySelectorAll("[aria-labelledby]").length, 0, "nothing names the one value");
});

test("a value of 20,001 characters draws 20,000 and a button that draws the rest, keeping focus in the box", async () => {
  await render({ pending: [pendingRequest("Write", { file_path: "a.txt", content: "x".repeat(20_000) + "y", note: "short" })] });
  const box = inputBoxes()[0];
  const content = () => box.querySelectorAll("pre")[0].textContent ?? "";
  assert.ok(content() === "x".repeat(20_000), "the first 20,000 characters");
  const showAll = button("Show all (20,001 characters)");
  assert.ok(box.contains(showAll));
  showAll.focus();
  await act(async () => showAll.click());
  assert.ok(content() === "x".repeat(20_000) + "y", "the whole value");
  assert.equal(box.querySelectorAll("button").length, 0);
  assert.ok(document.activeElement === box, "focus stays in the scroll box");
});

test("a value of 20,000 characters is drawn whole, with no button", async () => {
  await render({ pending: [pendingRequest("Write", { file_path: "a.txt", content: "x".repeat(20_000) })] });
  assert.ok(inputBoxes()[0].querySelector("pre")?.textContent === "x".repeat(20_000));
  assert.equal(inputBoxes()[0].querySelectorAll("button").length, 0);
});

test("a large value is not cut inside a character", async () => {
  await render({ pending: [pendingRequest("Write", { file_path: "a.txt", content: "x".repeat(19_999) + "😀" })] });
  assert.ok(inputBoxes()[0].querySelector("pre")?.textContent === "x".repeat(19_999));
  button("Show all (20,001 characters)");
});

test("an Edit request shows its old and new text as two labelled blocks", async () => {
  await render({ pending: [pendingRequest("Edit", { file_path: "a.ts", old_string: "let a;\n", new_string: "const a = 1;\n" })] });
  assert.deepEqual(blocks(inputBoxes()[0]), [
    ["old_string", "let a;\n"],
    ["new_string", "const a = 1;\n"],
  ]);
});

test("a Bash request with only its command shows no box", async () => {
  await render({ pending: [pendingRequest("Bash", { command: "pnpm test" })] });
  assert.equal(codeBlock()?.textContent, "pnpm test");
  assert.equal(inputBoxes().length, 0);
});

test("a Bash request that also leaves the sandbox shows that field", async () => {
  await render({ pending: [pendingRequest("Bash", { command: "pnpm test", dangerouslyDisableSandbox: true })] });
  assert.deepEqual(blocks(inputBoxes()[0]), [["dangerouslyDisableSandbox", "true"]]);
});

test("markup in a name or a value is drawn as those characters, with no link", async () => {
  const markup = "<b>bold</b> [x](http://y) **z** <a href='http://y'>y</a>";
  await render({ pending: [pendingRequest("Write", { file_path: "a.md", content: markup, "<i>name</i>": { "<b>": "**z**" } })] });
  const box = inputBoxes()[0];
  assert.deepEqual(blocks(box), [
    ["content", markup],
    ["<i>name</i>", '{\n  "<b>": "**z**"\n}'],
  ]);
  assert.equal(box.querySelectorAll("a, b, i, strong, em").length, 0);
});

test("the answers stay outside the scroll box and answer the request", async () => {
  const { backend } = await render({ pending: [pendingRequest("Write", { file_path: "a.ts", content: "one" })] });
  const box = inputBoxes()[0];
  for (const name of ["Allow once", "Allow for session", "Deny"]) {
    assert.ok(!box.contains(button(name)), name);
    assert.ok(box.compareDocumentPosition(button(name)) & Node.DOCUMENT_POSITION_FOLLOWING, `${name} comes after the box`);
  }
  await act(async () => button("Deny").click());
  await settle();
  assert.deepEqual(
    backend.calls.filter((c) => c.command === "resolve_permission").map((c) => c.args.decision),
    ["deny"],
  );
});

test("two requests with the same field names share no element ids", async () => {
  await render({
    pending: [
      pendingRequest("Write", { file_path: "a.ts", content: "one" }, "req-1"),
      pendingRequest("Write", { file_path: "b.ts", content: "two" }, "req-2"),
    ],
  });
  assert.deepEqual(inputBoxes().map(blocks), [[["content", "one"]], [["content", "two"]]]);
  const ids = [...view().querySelectorAll("[id]")].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(" "));
});

test("a request to show a message marks that message as the one shown", async () => {
  const { rerender } = await render();
  assert.equal(view().querySelector('[aria-current="true"]'), null);
  await rerender({ terminalId: agent.id, view: "activity", entryId: "message:m1", seq: 2 });
  const current = view().querySelector('[aria-current="true"]');
  assert.ok(current);
  assert.match(current.textContent ?? "", /run the tests/);
});
