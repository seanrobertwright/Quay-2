// Keyboard-only use of the graph canvas (#248, #264): what a node is called to a screen
// reader, how far the arrow keys nudge, what Go to node lists, where a node added from the
// palette below the selected one goes, and where Tab goes once the edges join the order.
import { NUDGE_WINDOW_MS, type Step } from "./history.ts";
import type { NodeIssues } from "./issues.ts";
import { configSummary } from "./kinds.ts";
import { hasOwn, type PraxisNode, type XYPosition } from "./model.ts";

/** How far an arrow key moves the selection, in pixels, and how far with Shift. */
export const NUDGE = 8;
export const NUDGE_SHIFT = 40;

/** The most nodes Go to node lists at once; typing narrows the rest. */
export const GO_TO_LIMIT = 50;

/** The space between a node and one the palette adds below it, in pixels. */
export const BELOW_GAP = 48;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A card's accessible name: "`<KIND>` `<id>`, `<summary>`, depends on N, M problems". */
export function nodeAriaLabel(node: PraxisNode, issues: NodeIssues | undefined): string {
  const summary = configSummary(node) || "no settings";
  return `${node.kind || "No kind"} ${node.id}, ${summary}, depends on ${node.dependsOn.length}, ${plural(issues?.count ?? 0, "problem", "problems")}`;
}

const ARROWS: Record<string, XYPosition> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** How far an arrow key moves the selection, or null for any other key. */
export function nudgeOffset(key: string, shift: boolean): XYPosition | null {
  if (!hasOwn(ARROWS, key)) return null;
  const by = shift ? NUDGE_SHIFT : NUDGE;
  return { x: ARROWS[key].x * by, y: ARROWS[key].y * by };
}

/** The undo step of a nudge: nudges of the same nodes merge while they come quickly (#248). */
export function nudgeStep(ids: readonly string[]): Step {
  return {
    label: ids.length === 1 ? `Move ${ids[0]}` : `Move ${ids.length} nodes`,
    merge: { key: `nudge|${JSON.stringify([...ids].sort())}`, windowMs: NUDGE_WINDOW_MS },
  };
}

/**
 * The nodes whose id or kind holds `query`, ignoring case, in file order, at most
 * `GO_TO_LIMIT`; `more` says whether other nodes match too.
 */
export function matchNodes<N extends Pick<PraxisNode, "id" | "kind">>(nodes: readonly N[], query: string): { matches: N[]; more: boolean } {
  const q = query.trim().toLowerCase();
  const matches: N[] = [];
  for (const n of nodes) {
    if (!n.id.toLowerCase().includes(q) && !n.kind.toLowerCase().includes(q)) continue;
    if (matches.length === GO_TO_LIMIT) return { matches, more: true };
    matches.push(n);
  }
  return { matches, more: false };
}

/**
 * The element with focus, an edge's SVG group included, for giving focus back later; null
 * when it is the page itself.
 */
export function focusedElement(): HTMLElement | SVGElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement || el instanceof SVGElement ? el : null;
}

/** A card's place and size on the canvas. */
export interface Box extends XYPosition {
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Where a node of `size` goes below the card `above`: same left edge, a gap under it, then a
 * step right, card width and gap, past each card in `taken` that is in the way.
 */
export function positionBelow(above: Box, taken: readonly Box[], size: { width: number; height: number }): XYPosition {
  const spot = { x: above.x, y: above.y + above.height + BELOW_GAP, ...size };
  // One step per card at most: past that many, every card has been stepped past.
  for (let i = 0; i <= taken.length && taken.some((t) => overlaps(t, spot)); i++) spot.x += size.width + BELOW_GAP;
  return { x: spot.x, y: spot.y };
}

/**
 * Where Tab goes from `current`, once the graph's edges follow its last node in the tab
 * order. `stops` are the tab stops in document order, which the edges aren't among, and the
 * order wraps, as the builder's focus trap does. Returns null when the move involves no edge,
 * so the browser or the trap moves focus as usual.
 */
export function tabTarget<T>(stops: readonly T[], lastNode: T | null, edges: readonly T[], current: T, backwards: boolean): T | null {
  if (lastNode === null || edges.length === 0) return null;
  const at = stops.indexOf(lastNode);
  if (at < 0) return null;
  const order = [...stops.slice(0, at + 1), ...edges, ...stops.slice(at + 1)];
  const i = order.indexOf(current);
  if (i < 0) return null;
  const next = order[(i + (backwards ? -1 : 1) + order.length) % order.length];
  return edges.includes(current) || edges.includes(next) ? next : null;
}
