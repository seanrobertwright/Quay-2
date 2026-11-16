// Where the builder draws its inspector (#646). While the Praxis Builder stage tab is in front,
// the companion's Inspector view gives it an element to draw the inspector into, in place of the
// builder's own column beside the canvas.
import { createContext } from "react";

/**
 * The element the inspector draws into: an element to draw it there, null to draw none (the
 * companion shows another view), or undefined to draw it beside the canvas as before.
 */
export type InspectorSlot = HTMLElement | null | undefined;

export const InspectorSlotContext = createContext<InspectorSlot>(undefined);
