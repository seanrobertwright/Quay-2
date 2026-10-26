import type { StageLayout } from "../terminal/types";

export type GridSlots = [string | null, string | null, string | null, string | null];

/**
 * Picks the four slots for the 2x2 grid when `splitGrid` runs. When a grid is already showing,
 * filled slots stay where they are and only empty slots take the next visible terminal not
 * already in the grid. Switching into the grid from another layout puts the active terminal
 * in slot 0 and fills the rest in rail order.
 */
export function chooseGridSlots({
  layout,
  currentSlots,
  visibleTerminalIds,
  activeTerminalId,
}: {
  layout: StageLayout;
  currentSlots: GridSlots;
  visibleTerminalIds: readonly string[];
  activeTerminalId: string | null;
}): GridSlots {
  if (layout === "grid") {
    const taken = new Set(currentSlots.filter((id): id is string => id !== null));
    const remaining = visibleTerminalIds.filter((id) => !taken.has(id));
    let nextIdx = 0;
    return currentSlots.map((slot) => slot ?? remaining[nextIdx++] ?? null) as GridSlots;
  }

  const slot0 = activeTerminalId || visibleTerminalIds[0] || null;
  const remaining = visibleTerminalIds.filter((id) => id !== slot0);
  return [
    slot0,
    remaining[0] ?? null,
    remaining[1] ?? null,
    remaining[2] ?? null,
  ];
}
