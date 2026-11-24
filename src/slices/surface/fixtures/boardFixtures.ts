// What the tests of boards share: the boards Rust holds, and the pane's strip they are drawn on.
import { act, createElement } from "react";
import type { TerminalInfo } from "../../terminal/types.ts";
import { terminalInfo } from "../../companion/fixtures/companionFixtures.ts";
import type { BoardRun, SurfaceComponent, SurfaceRecord } from "../surfaceTypes.ts";
import { arrives, changed, surface } from "./surfaceFixtures.ts";

const { BoardStrip } = await import("../strip/BoardStrip.tsx");

/** The terminal whose boards are drawn. */
export const TERMINAL: TerminalInfo = { ...terminalInfo("t1", "E:/alpha"), name: "fix-75" };

/** The strip of `terminal`'s pane. */
export const strip = (terminal: TerminalInfo = TERMINAL) => createElement(BoardStrip, { terminal });

export interface Shows {
  steps?: { label: string; state: string; note?: string }[];
  progress?: { done: number; total: number };
  stats?: { label: string; value: string }[];
}

/** The state the webview accepts of a board that shows these. */
function stateOf(id: string, { steps, progress, stats = [] }: Shows): SurfaceRecord["state"] {
  const parts: SurfaceComponent[] = [];
  if (steps) parts.push({ id: "steps", component: "Steps", steps });
  if (progress) parts.push({ id: "progress", component: "Progress", ...progress });
  stats.forEach((stat, i) => parts.push({ id: `stat_${i}`, component: "Stat", ...stat }));
  const root = { id: "root", component: "Column", children: parts.map((part) => part.id) };
  return { version: "1.0", createSurface: { surfaceId: id, catalogId: "urn:quay:a2ui:catalog:v1", components: [root, ...parts], dataModel: {} } };
}

/** The board `id` of terminal `t1`, as Rust holds it. It runs unless `run` says otherwise. */
export function board(id: string, shows: Shows = {}, run: Partial<BoardRun> = {}, over: Partial<SurfaceRecord> = {}): SurfaceRecord {
  const now = Date.now();
  const whole: BoardRun = { title: id, status: "running", started_at: now, updated_at: now, stopped_at: null, ...run };
  return surface(id, { tool: "quay_board", place: "strip", asks: false, state: stateOf(id, shows), board: whole, ...over });
}

/** `record` as Rust holds it once its agent has sent it again. */
export function sentAgain(record: SurfaceRecord, shows: Shows = {}, run: Partial<BoardRun> = {}): SurfaceRecord {
  const now = Date.now();
  return changed(record, { revision: record.revision + 1, state: stateOf(record.id, shows), board: { ...record.board!, updated_at: now, ...run } });
}

/** `record` as Rust holds it once its agent has marked it. */
export const settled = (record: SurfaceRecord, status: "done" | "failed", shows: Shows = {}): SurfaceRecord =>
  sentAgain(record, shows, { status, stopped_at: Date.now() });

/** `record` as Rust holds it once its terminal has exited. */
export function ended(record: SurfaceRecord): SurfaceRecord {
  const now = Date.now();
  return changed(record, { ended_at: now, board: { ...record.board!, stopped_at: now } });
}

/** Sends `record` from Rust, and lets the page draw it: one that was drawn just before waits its turn. */
export async function redrawn(record: SurfaceRecord): Promise<void> {
  await arrives(record);
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 260))));
}

/** Seven steps, of which three are done and the fourth is under way. */
export const SEVEN = ["Read", "Find", "Plan", "Change call sites", "Test", "Document", "Release"].map((label, i) => ({
  label,
  state: i < 3 ? "done" : i === 3 ? "active" : "pending",
}));

export const lines = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>("[data-board-line] > button")];
export const line = (container: HTMLElement, id: string) => lines(container).find((button) => button.closest<HTMLElement>("[data-board-line]")?.dataset.boardLine === id);
/** The board that is open over the terminal, if one is. */
export const opened = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-open-board] [data-surface]");
