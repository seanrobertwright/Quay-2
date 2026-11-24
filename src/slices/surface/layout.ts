// How the frame lays out a typed surface: the A2UI module draws the parts and the frame places them.
import { createContext, type ComponentType, type ReactNode } from "react";

/** A surface's data model, by data path. */
export interface SurfaceData {
  get: (path: string) => unknown;
  set: (path: string, value: unknown) => void;
  /** Calls `changed` after every change, until the returned function is called. */
  subscribe: (changed: () => void) => () => void;
}

export interface LayoutProps {
  /** Draws the named part. A part left out is not drawn, and keeps what was typed in it. */
  part: (name: string) => ReactNode;
  data: SurfaceData;
}

export type Layout = ComponentType<LayoutProps>;

/** What the root Column of a surface hands its parts to, or null to draw them as a column. */
export const LayoutContext = createContext<{ Layout: Layout; data: SurfaceData } | null>(null);
