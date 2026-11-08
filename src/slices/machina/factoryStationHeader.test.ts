/// <reference types="node" />
// The Factory Station header names its engine and where it runs (#481, ADR 0006): Machina is
// Quay's local factory, so an operator can tell it apart from a Praxis host. The real modal is
// rendered into happy-dom, with only Tauri's `invoke` (and event listening) faked.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const { FactoryStationModal } = await import("./FactoryStationModal.tsx");
// The modal listens for state updates. `listen` and its unlisten reach these Tauri internals as
// well as `invoke`, so they get stand-ins that do nothing.
const tauriWindow = window as unknown as { __TAURI_INTERNALS__: object; __TAURI_EVENT_PLUGIN_INTERNALS__?: object };
Object.assign(tauriWindow.__TAURI_INTERNALS__, { transformCallback: () => 1 });
tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

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

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  fakeInvoke(async (cmd) => {
    switch (cmd) {
      case "plugin:event|listen":
        return 1;
      case "plugin:event|unlisten":
        return null;
      case "machina_get_status":
        return STATUS;
      case "machina_list_work_orders":
        return [];
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
