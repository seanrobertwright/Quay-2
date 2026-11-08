/// <reference types="node" />
// The Factory Station in Machina's own words (#481, ADR 0006): its header names the engine and
// where it runs, since Machina is Quay's local factory and not a Praxis host, and a work order is
// taken with Accept. The real modal is rendered into happy-dom, with only Tauri's `invoke` faked.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { FactoryStationModal } = await import("./FactoryStationModal.tsx");

const STATUS = {
  loopMode: "ACTIVE",
  epoch: 3,
  sessionStartedAtMs: 0,
  statePath: "C:\\state.json",
  vaultRoot: "C:\\vault",
  workOrderCount: 0,
  measuredSpendUsd: 0,
  budgetUsd: 0,
  activeHolds: 0,
  runningJobs: 0,
};

/** A work order whose gate passed, waiting for the operator's Accept. */
const AWAITING = {
  id: "WO-1",
  title: "Add a greeting",
  objective: "Say hello",
  repoPath: "C:\\src\\repo",
  baseBranch: "main",
  baseSha: "a".repeat(40),
  branchName: "machina/wo-1",
  worktreePath: "C:\\src\\repo\\.machina\\worktrees\\wo-1",
  authorAgent: "claude",
  authorTerminalId: null,
  allowedOutputPaths: ["src/**"],
  dependsOn: [],
  maxCorrections: 2,
  attempts: 1,
  budgetUsd: 5,
  spend: { measured: true, usd: 0.5, responses: 3, note: "" },
  status: "AWAITING_ACCEPTANCE",
  stages: [],
  hold: null,
  vault: null,
  setupChecks: [],
  lastGate: null,
  mergeCommit: null,
  worktreeRemoved: false,
  error: null,
  epoch: 3,
  createdAtMs: 0,
  updatedAtMs: 0,
  events: [],
};

let workOrders: unknown[] = [];
let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  workOrders = [];
  fakeInvoke(async (cmd) => {
    switch (cmd) {
      case "machina_get_status":
        return STATUS;
      case "machina_list_work_orders":
        return workOrders;
      default:
        throw new Error(`no fake for ${cmd}`);
    }
  });
});
afterEach(() => {
  if (mounted) {
    const { root, container } = mounted;
    act(() => root.unmount());
    container.remove();
    mounted = null;
  }
  document.body.innerHTML = "";
});

async function renderStation(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(FactoryStationModal, {
        isOpen: true,
        activeProject: "",
        terminals: [],
        onClose: () => {},
        onSelectTerminal: () => {},
        onSpawnTerminal: () => {},
      })
    )
  );
  return container;
}

test("the Factory Station's title names Machina and says it runs locally", async () => {
  const container = await renderStation();
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  const title = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
  assert.equal(title.textContent, "Machina: local");
});

test("a work order whose gate passed offers Accept, which squash-merges it into its base branch", async () => {
  workOrders = [AWAITING];
  const container = await renderStation();
  const names = [...container.querySelectorAll("button")].map((b) => b.textContent?.trim());
  assert.ok(names.includes("Accept: squash-merge into main"), `buttons: ${names.join(" | ")}`);
});
