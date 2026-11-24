// What the tests of reviews share: a review, and the stage its tab is on, worked as the operator
// would. The test owns what it mounts.
import "../../../test-support/dom.ts";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { terminalInfo } from "../../companion/fixtures/companionFixtures.ts";
import type { TerminalInfo } from "../../terminal/types.ts";
import type { SurfaceKey, SurfaceRecord } from "../surfaceTypes.ts";
import type { Mounted } from "./askFixtures.ts";
import { acceptedSurface, settle, until } from "./fakeRust.ts";

const { StageTabBar } = await import("../../stage/StageTabBar.tsx");
const { useSurfaceTabs } = await import("../useSurfaceTabs.tsx");

/** The terminal that asks, unless a test says otherwise. */
export const TERMINAL: TerminalInfo = { ...terminalInfo("t1", "E:/alpha"), name: "fix-75" };

/** The spec's own review, with an item that names a file. */
export const REVIEW = {
  title: "Plan: pair each answer with its turn",
  body: "## Why\n\nAn answer can **outlive** its turn.",
  items: [
    { title: "Give every turn an id", detail: "In the *bridge*", file: "src/turns.ts:12" },
    { title: "Drop answers whose turn has gone" },
    { title: "Write it down" },
  ],
};

/** The review `id` of `terminal`, as Rust holds it once the webview has accepted `review`. */
export const acceptedReview = (id: string, review: unknown = REVIEW, terminal = "t1", order = 1): Promise<SurfaceRecord> =>
  acceptedSurface({ tool: "quay_review", place: "tab", id, terminal, order }, review);

/** The stage a test drew, and what the rest of Quay's window does to it. */
export interface MountedStage extends Mounted {
  /** Opens a surface, as a chip of its terminal does. Whether it has a tab. */
  open: (key: SurfaceKey) => Promise<boolean>;
  /** The same, for what is under way already. */
  openNow: (key: SurfaceKey) => boolean;
  /** Brings the terminals in front, as picking one does. */
  showTerminals: () => Promise<void>;
  /** Makes another project active. */
  showProject: (path: string) => Promise<void>;
}

const noop = () => {};

/** The stage's tab bar and what its tabs show, on `project`, as Quay's window has them. No pane of a terminal is drawn. */
export async function mountStage(terminals: readonly TerminalInfo[] = [TERMINAL], project = "E:/alpha"): Promise<MountedStage> {
  let tabs: ReturnType<typeof useSurfaceTabs>;
  let setFront: (id: string | null) => void;
  let setProject: (path: string) => void;
  const Harness = () => {
    const [activeProject, setActiveProject] = useState(project);
    const [frontId, setFrontId] = useState<string | null>(null);
    tabs = useSurfaceTabs({
      terminals,
      activeProject,
      frontId,
      onFront: setFrontId,
      onSelectTerminal: (terminal) => setActiveProject(terminal.project_path),
    });
    setFront = setFrontId;
    setProject = setActiveProject;
    return createElement(
      "main",
      null,
      createElement(StageTabBar, {
        terminals: [],
        currentTerminalId: "",
        layout: "single",
        zoomedFromLayout: null,
        onSelectTerminal: noop,
        onNewTerminal: noop,
        onUnsplit: noop,
        onSplitHorizontal: noop,
        onSplitVertical: noop,
        onSplitGrid: noop,
        onToggleZoom: noop,
        tools: tabs.tools,
        frontToolId: frontId,
        onSelectTool: tabs.select,
        onCloseTool: tabs.close,
        earlierTabs: tabs.earlier,
      }),
      tabs.tools.map(({ id, content }) => createElement("div", { key: id, "data-stage-tool-panel": id, hidden: id !== frontId }, content)),
    );
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  await settle();
  const run = async (does: () => void) => {
    await act(async () => does());
    await settle();
  };
  return {
    root,
    container,
    open: async (key) => {
      let opened = false;
      await run(() => void (opened = tabs.open(key)));
      return opened;
    },
    openNow: (key) => tabs.open(key),
    showTerminals: () => run(() => setFront(null)),
    showProject: (path) => run(() => setProject(path)),
  };
}

/** The surfaces' tabs, in the tab bar's order. */
export const tabs = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Stage tabs"] button[data-stage-tool]')];

/** The tab labelled `label`, if there is one. */
export const tab = (container: HTMLElement, label: string = REVIEW.title) => tabs(container).find((button) => button.textContent?.includes(label));

/** The frame in front, if a surface's tab is. */
export const frame = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-stage-tool-panel]:not([hidden]) section[data-surface]");

/** Brings the tab labelled `label` in front and returns its surface's frame, drawn. */
export async function openTab(container: HTMLElement, label?: string): Promise<HTMLElement> {
  await act(async () => tab(container, label)!.click());
  await until(() => frame(container) !== null && !frame(container)!.textContent?.includes("Loading"), "the review was never drawn");
  return frame(container)!;
}
