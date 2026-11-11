/// <reference types="node" />
// Test support: the scaffold the component tests of a graph run's run canvas (runCanvas.test.ts)
// and node panel (nodePanel.test.ts) share. It renders the real graph workflow form into happy-dom,
// inside a stand-in for the builder's root that counts the Escapes reaching it, and fakes only
// Tauri's `invoke`, the out-of-process boundary. It shows a run's detail, and draws the recorded run
// of several phases and the recorded revision it runs (graph_outputs.fixture.json). `READS`, the
// commands the form may send, all reads, is the graph run detail's tests' too
// (graphRunDetail.test.ts). No production module imports it. It installs happy-dom first
// (test-support/dom.ts), so a test file imports it before anything that renders.
import { fakeInvoke } from "../../../test-support/dom.ts";
import { mock } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "../drafts.ts";
import { createRevisionCache } from "../graphRevision.ts";
import { IS_MAC } from "../keymap.ts";
import type { CallOutcome } from "../praxisHost.ts";
import type { FileProblem } from "../types.ts";
import { recordedStdout } from "./graphOutputs.ts";
import { graphRunEntry as entry, graphRunsRecord, statusRecord } from "./runs.ts";

const { GraphWorkflowForm } = await import("../GraphWorkflowForm.tsx");

/** When each test starts, on its mocked clock. */
export const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
export const PROJECT = "C:/project";
/** The graph workflow the recorded run of several phases runs. */
export const NAME = "release-train";

let mounted: { root: Root; container: HTMLElement } | null = null;

/** Unmounts the rendered form, if any, and removes its container. */
export const unmount = () => {
  if (!mounted) return;
  const { root, container } = mounted;
  act(() => root.unmount());
  container.remove();
  mounted = null;
};

export interface Sent {
  command: string;
  args: Record<string, unknown>;
  answer: (value: unknown) => void;
}

/**
 * What `praxis_read` gives for a graph: the project's saved graph file with its layout file, if any,
 * or with why its layout was ignored, when that file or `.praxis/layout` itself can't be used; null
 * for a graph the project hasn't got; or, as `readFails`, the error it rejects with.
 */
export type SavedGraph =
  | { content?: Record<string, unknown>; layout?: Record<string, unknown>; layoutProblem?: FileProblem }
  | { readFails: string }
  | null;

/**
 * The backend: the form's own reads answer at once, and so does `praxis_read` of a graph, as
 * `saved` says; the runs list, graph status and revision reads wait for the test.
 */
export function fakeBackend(saved: SavedGraph = null) {
  const sent: Sent[] = [];
  fakeInvoke(
    (command, args) =>
      new Promise((resolve, reject) => {
        sent.push({ command, args, answer: resolve });
        switch (command) {
          case "praxis_validate":
            return resolve({ verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } });
          case "praxis_check_graph_workflow":
            return resolve({ grants: [], diagnostics: [] });
          case "praxis_graph_workflow_triggers":
            return resolve({ ids: [], unchecked: [] });
          case "praxis_read":
            if (args.kind !== "graphs") return reject(new Error(`unexpected read of ${String(args.kind)}`));
            if (saved !== null && "readFails" in saved) return reject(saved.readFails);
            return resolve(
              saved === null
                ? { id: args.id, kind: "graphs", missing: true }
                : { id: args.id, kind: "graphs", missing: false, contentHash: "h", content: saved.content ?? { id: args.id, nodes: [] }, layout: saved.layout, layoutProblem: saved.layoutProblem },
            );
          case "praxis_host_graph_runs":
          case "praxis_host_graph_status":
          case "praxis_host_graph_revision":
            return;
          case "praxis_host_cancel":
            return resolve(undefined);
          default:
            return reject(new Error(`unexpected invoke ${command}`));
        }
      }),
  );
  const of = (command: string) => sent.filter((s) => s.command === command);
  return {
    sent,
    lists: () => of("praxis_host_graph_runs"),
    statuses: () => of("praxis_host_graph_status"),
    revisionReads: () => of("praxis_host_graph_revision"),
    layoutReads: () => of("praxis_read"),
  };
}
export type Backend = ReturnType<typeof fakeBackend>;

/** Everything the form and its Runs view may send: each reads, and none writes a file or the host. */
export const READS: ReadonlySet<string> = new Set([
  "praxis_validate",
  "praxis_check_graph_workflow",
  "praxis_graph_workflow_triggers",
  "praxis_read",
  "praxis_host_graph_runs",
  "praxis_host_graph_status",
  "praxis_host_graph_revision",
  "praxis_host_cancel",
]);

/**
 * How many Escapes reached the builder since the form was rendered. It runs its keys on its root, in
 * the bubble phase, and skips a key whose default a control inside it prevented
 * (PraxisBuilderModal.tsx). An Escape it runs with nothing smaller to close, such as the graph
 * canvas's selection, hides the builder. A live binding: an importer reads the count as it is now.
 */
export let builderEscapes = 0;

/** The stand-in for the builder's root: it counts each Escape that reaches it and that nothing inside handled. */
const builderKeys = (e: ReactKeyboardEvent) => {
  if (e.key === "Escape" && !e.defaultPrevented) builderEscapes += 1;
};

export interface FormSpies {
  onEdit?: (edit: unknown) => void;
  onOpen?: (ref: unknown) => void;
  /** The `workOrderId` of a run to show as the form opens. */
  showRun?: string;
}

/**
 * The graph workflow form, in the stand-in for the builder's root. Each form has its own revision
 * cache, so no test reads a revision another kept.
 */
export function form(spies: FormSpies = {}) {
  const ref = { kind: "graph-workflows" as const, id: NAME };
  const content = { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" };
  const draft = createDraft(ref, { id: NAME, kind: "graph-workflows", missing: false, content, contentHash: "h" });
  assert.ok(draft.ok);
  const shown = createElement(GraphWorkflowForm, {
    projectPath: PROJECT,
    draft: draft.value,
    contracts: ["c"],
    graphs: ["g"],
    graphBindings: [{ id: "g-1", graphId: "g" }],
    refresh: 0,
    onEdit: spies.onEdit ?? (() => {}),
    onOpen: spies.onOpen ?? (() => {}),
    onValidated: () => {},
    runsShown: true,
    showRun: spies.showRun,
    revisions: createRevisionCache(),
  });
  return createElement("div", { onKeyDown: builderKeys }, shown);
}

/** Renders `element` into a new container on the page, with no Escape yet counted. */
export async function render(element: ReturnType<typeof form>): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  builderEscapes = 0;
  await act(async () => root.render(element));
  return container;
}

export const text = (el: Element | null | undefined) => el?.textContent ?? "";
export const buttons = (root: Element) => [...root.querySelectorAll("button")];
export const button = (root: Element, name: RegExp) =>
  buttons(root).find((b) => name.test(b.getAttribute("aria-label") ?? text(b))) as HTMLButtonElement | undefined;
export const click = (el: HTMLElement | undefined) => act(async () => el?.click());
export const tick = (ms: number) => act(async () => mock.timers.tick(ms));
export const answer = (s: Sent, outcome: CallOutcome) => act(async () => s.answer(outcome));

/** The modifier a builder chord's Mod is here: Cmd on macOS, else Ctrl. */
export const MOD = IS_MAC ? "metaKey" : "ctrlKey";

/** Sends a keydown of `key` to `target`, as the browser does, and returns it. */
export async function press(target: Element, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => void target.dispatchEvent(event));
  return event;
}

/** Opens Runs, lists `rows`, and shows run `n`'s detail. */
export async function showRun(backend: Backend, n = 1, rows: unknown[] = [entry(n)], spies: FormSpies = {}): Promise<HTMLElement> {
  const root = await render(form(spies));
  await click(button(root, /^Runs$/));
  await answer(backend.lists()[0], graphRunsRecord(NAME, rows));
  await click(button(root, new RegExp(`^Show run-${n}$`)));
  return root;
}

export const detail = (root: HTMLElement) => root.querySelector('[aria-label^="Run run-"]') as HTMLElement | null;
/** The run canvas, found by its heading. */
export const runCanvas = (root: HTMLElement) =>
  ([...(detail(root)?.querySelectorAll("section") ?? [])].find((s) => /^Run canvas/.test(text(s.querySelector("h4")))) as HTMLElement | undefined) ?? null;
export const nodesToggle = (root: HTMLElement) => button(detail(root) as HTMLElement, /^Nodes/) as HTMLButtonElement;

/** The recorded revision the recorded run of several phases runs. */
export const recordedRevision = (): CallOutcome => ({ kind: "record", record: recordedStdout("graphs show: a revision") });
export const severalPhases = () => statusRecord(recordedStdout("status: nodes in several phases"));

/** Shows run 1, whose view is the recorded run of several phases, and answers its revision read with `revision`. */
export async function drawRun(backend: Backend, revision: CallOutcome = recordedRevision(), spies: FormSpies = {}): Promise<HTMLElement> {
  const root = await showRun(backend, 1, [entry(1)], spies);
  await answer(backend.statuses()[0], severalPhases());
  await answer(backend.revisionReads()[0], revision);
  return root;
}

/** The recorded refusal of a revision the host doesn't hold. */
export function refused(): CallOutcome {
  const refusal = recordedStdout("graphs show: a revision, not submitted");
  return { kind: "hostRefused", message: String(refusal.message), hostCode: "NOT_FOUND", record: refusal };
}
