/// <reference types="node" />
// Component tests for withdrawing a pending graph workflow candidate (#444, #463): Withdraw on the
// candidate's row in the Revisions panel and in the status line, its confirm dialog, a refusal,
// and the state the host leaves afterwards. They render the real graph workflow form over the
// real graph host model into happy-dom and fake only Tauri's `invoke`, the out-of-process
// boundary, answering the model's `praxis` calls with the records the real CLI printed
// (graph_outputs.fixture.json).
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement, useEffect, useState, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDraft } from "./drafts.ts";
import { createGraphHost, type GraphHost } from "./graphHost.ts";
import type { CallOutcome, HostCondition } from "./praxisHost.ts";
import type { GraphWorkflowCheck, Validation } from "./types.ts";

const { GraphWorkflowForm } = await import("./GraphWorkflowForm.tsx");

const NAME = "ship";
const SIGNED_IN: HostCondition = { state: "signedIn" };
const RECORDED_DIGEST = "sha256:f29d05656810f1a352c2fa594710e4f01333ea7e1f8833708bdb6a915870474f";

const recorded = JSON.parse(
  readFileSync(new URL("../../../src-tauri/src/slices/praxis/host/graph_outputs.fixture.json", import.meta.url), "utf8"),
) as { cases: { name: string; stdout: Record<string, unknown> }[] };
const stdout = (name: string) => structuredClone(recorded.cases.find((c) => c.name === name)!.stdout);

type Revision = Record<string, unknown>;

/** The recorded `graphs show`, as `ship`, with revision 1 `CURRENT` and revision 2 `status2`. */
function show(status2: string, fields: Record<string, unknown> = {}): CallOutcome {
  const record = stdout("graphs show");
  const rs = record.revisions as Revision[];
  Object.assign(record, {
    name: NAME,
    revisions: [{ ...rs[0], status: status2 }, { ...rs[1], status: "CURRENT" }],
    currentRevision: 1,
    runnable: true,
    pendingCount: status2 === "CANDIDATE" ? 1 : 0,
    ...fields,
  });
  return { kind: "record", record };
}

const withdrawn = (): CallOutcome => ({ kind: "record", record: { ...stdout("graphs withdraw: a pending candidate"), name: NAME, revision: 2 } });

function notPending(): CallOutcome {
  const record = stdout("graphs withdraw: not pending");
  return { kind: "hostRefused", message: String(record.message), hostCode: String(record.hostCode), record };
}

interface Call {
  command: string;
  args: Record<string, unknown>;
  answer(outcome: CallOutcome): void;
  answered?: boolean;
}

/** The model's `praxis` calls, each waiting until the test answers it. */
function fakeHost() {
  const calls: Call[] = [];
  const invoker = (command: string, args: Record<string, unknown>) => {
    if (command === "praxis_host_cancel") return Promise.resolve(undefined);
    return new Promise<unknown>((resolve) => calls.push({ command, args, answer: resolve }));
  };
  const label = (c: Call) => (c.command === "praxis_host_graph_withdraw" ? `withdraw ${String(c.args.revision)}` : c.command === "praxis_host_graph_show" ? "show" : c.command);
  const pending = () => calls.filter((c) => !c.answered);
  return {
    invoker,
    calls,
    open: () => pending().map(label),
    async answer(what: string, outcome: CallOutcome) {
      const call = pending().find((c) => label(c) === what);
      assert.ok(call, `no open ${what} call; open: ${pending().map(label).join(", ")}`);
      call.answered = true;
      await act(async () => {
        call.answer(outcome);
        await settle();
      });
    },
  };
}

/** Lets settled calls' follow-ups run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const accepted: Validation = { verdict: null, diagnostics: [], omitted: { errors: 0, warnings: 0, info: 0 } };
const passing: GraphWorkflowCheck = { diagnostics: [], grants: ["g1"] };

let mounted: { root: Root; container: HTMLElement; graphs: GraphHost } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, container, graphs } = mounted;
    act(() => root.unmount());
    container.remove();
    graphs.dispose();
    mounted = null;
  }
});

/** The form, drawn again on every change to the model, as the builder draws it. */
const Harness: FC<{ graphs: GraphHost; draft: Parameters<typeof GraphWorkflowForm>[0]["draft"] }> = ({ graphs, draft }) => {
  const [, setVersion] = useState(0);
  useEffect(() => graphs.subscribe(() => setVersion((v) => v + 1)), [graphs]);
  return createElement(GraphWorkflowForm, {
    projectPath: "C:/project",
    draft,
    contracts: ["c"],
    graphs: ["g"],
    graphBindings: [{ id: "g-1", graphId: "g" }],
    refresh: 0,
    host: {
      view: graphs.workflow(NAME),
      condition: SIGNED_IN,
      onCheckAgain: () => void graphs.checkAgain(NAME),
      onWithdraw: (revision: number) => graphs.withdraw(NAME, revision),
    },
    onEdit: () => {},
    onOpen: () => {},
    onValidated: () => {},
  });
};

/** The form for `ship`, whose host read shows revision 2 waiting for admission over admitted revision 1. */
async function renderCandidate() {
  fakeInvoke(async (command) => {
    switch (command) {
      case "praxis_validate":
        return accepted;
      case "praxis_check_graph_workflow":
        return passing;
      case "praxis_graph_workflow_triggers":
        return { ids: [], unchecked: [] };
      default:
        throw new Error(`unexpected invoke ${command}`);
    }
  });
  const host = fakeHost();
  const graphs = createGraphHost({ projectPath: "C:/project", call: host.invoker });
  graphs.setLocal([{ name: NAME, bundleDigest: RECORDED_DIGEST, nameProblem: null }]);
  graphs.setCondition(SIGNED_IN);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container, graphs };
  const made = createDraft(
    { kind: "graph-workflows", id: NAME },
    { id: NAME, kind: "graph-workflows", missing: false, content: { version: 1, contractId: "c", graphId: "g", graphBindingId: "g-1" }, contentHash: "h" },
  );
  assert.ok(made.ok);
  await act(async () => root.render(createElement(Harness, { graphs, draft: made.value })));
  void graphs.checkAgain(NAME);
  await act(settle);
  await host.answer("show", show("CANDIDATE"));
  return { host, root: container };
}

const text = (el: Element | null | undefined) => el?.textContent ?? "";
const statusLine = (root: HTMLElement) => root.querySelector('[role="status"]')?.parentElement ?? null;
const table = (root: HTMLElement) => root.querySelector('table[aria-label="Revisions on the host"]');
const rows = (root: HTMLElement) => [...(table(root)?.querySelectorAll("tbody tr") ?? [])];
const dialog = (root: HTMLElement) => root.querySelector('[role="dialog"]');
const buttonIn = (el: Element | null | undefined, name: string) =>
  [...(el?.querySelectorAll("button") ?? [])].find((b) => (b.getAttribute("aria-label") ?? text(b).trim()) === name);
const click = async (el: Element | undefined) => {
  assert.ok(el, "the control is drawn");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
  });
};

test("Withdraw shows on the pending candidate's row and in the status line, and nowhere else", async () => {
  const { root } = await renderCandidate();
  assert.ok(buttonIn(statusLine(root), "Withdraw revision 2"), "the status line's Withdraw");
  const [candidate, current] = rows(root);
  assert.ok(buttonIn(candidate, "Withdraw revision 2"), "the candidate row's Withdraw");
  assert.equal(current.querySelector("button"), null, "an admitted revision has no Withdraw");
});

test("the confirm names the revision and says the owner can no longer admit it, and Cancel withdraws nothing", async () => {
  const { host, root } = await renderCandidate();
  for (const opener of [buttonIn(statusLine(root), "Withdraw revision 2"), buttonIn(rows(root)[0], "Withdraw revision 2")]) {
    await click(opener);
    const shown = dialog(root);
    assert.ok(shown, "the confirm is shown");
    assert.equal(text(root.querySelector(`#${shown.getAttribute("aria-labelledby")}`)), "Withdraw revision 2 of ship?");
    assert.match(text(shown), /The owner can no longer admit revision 2\./);
    await click(buttonIn(shown, "Cancel"));
    assert.equal(dialog(root), null, "Cancel closes the confirm");
  }
  assert.deepEqual(host.open(), [], "nothing was sent to the host");
});

test("after withdrawing, the record falls back to its admitted revision's state, and the history shows the candidate as withdrawn", async () => {
  const { host, root } = await renderCandidate();
  await click(buttonIn(statusLine(root), "Withdraw revision 2"));
  await click(buttonIn(dialog(root), "Withdraw"));
  assert.deepEqual(host.open(), ["withdraw 2"]);
  assert.match(text(dialog(root)), /Withdrawing revision 2/);
  await host.answer("withdraw 2", withdrawn());
  // The host is read again once it has answered.
  await host.answer("show", show("WITHDRAWN"));
  assert.equal(dialog(root), null, "the confirm closes once the withdrawal is done");
  assert.equal(text(root.querySelector('[role="status"]')).split(" · ")[0], "On the host: Admitted");
  assert.deepEqual(rows(root).map((tr) => [...tr.querySelectorAll("th, td")].slice(0, 2).map(text)), [["2", "Withdrawn"], ["1", "Current"]]);
  assert.equal(buttonIn(root, "Withdraw revision 2"), undefined, "nothing pending is left to withdraw");
});

test("a withdrawal the host refuses because the candidate is already decided stays in the confirm with the host's reason, and Withdraw is withheld", async () => {
  const { host, root } = await renderCandidate();
  await click(buttonIn(rows(root)[0], "Withdraw revision 2"));
  await click(buttonIn(dialog(root), "Withdraw"));
  await host.answer("withdraw 2", notPending());
  // The owner admitted it in the browser first.
  await host.answer("show", show("CURRENT", { currentRevision: 2, revisions: [{ ...(stdout("graphs show").revisions as Revision[])[0], status: "CURRENT" }] }));
  const shown = dialog(root);
  assert.ok(shown, "the confirm stays open");
  assert.equal(
    text(shown.querySelector('[role="alert"]')),
    "The host refused: revision 2 of ship is no longer pending. The owner has admitted or rejected it, or it was withdrawn already.",
  );
  const withdraw = buttonIn(shown, "Withdraw");
  assert.equal(withdraw?.getAttribute("aria-disabled"), "true");
  await click(withdraw);
  assert.deepEqual(host.open(), [], "a refused withdrawal isn't sent again");
  assert.match(text(root.querySelector('[role="status"]')), /^On the host: Admitted/);
});
