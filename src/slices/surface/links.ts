// What the frame gives the links in a surface: what a click may cause, and the foot that says where
// a link leads before the click.
import { createContext } from "react";

/** What a surface may cause. Each throws unless a click on its control is being handled. */
export interface SurfaceEffects {
  /** Opens a web address in the browser. */
  openUrl: (url: string) => void;
  /** Shows a file: in the file manager, or in the diff view when it has uncommitted changes. */
  showFile: (path: string, line?: number) => void;
  /** Selects a terminal of the surface's own project, by its id or its exact name. */
  focusTerminal: (terminal: string) => void;
  /** Puts a text on the clipboard. */
  copyText: (text: string) => void;
}

export interface SurfaceLinks {
  effects: SurfaceEffects;
  /** The id of the frame's foot, which describes the link it speaks of. */
  footId: string;
  /** Keeps the foot's line while a link is drawn, until the returned function is called. */
  present: () => () => void;
  /** Says at the foot where the link `id` leads while the pointer or the focus is on it; null when it leaves. */
  point: (by: "pointer" | "focus", id: string, address: string | null) => void;
}

/** The frame's links, or null where a surface is drawn with no frame and links are text. */
export const LinksContext = createContext<SurfaceLinks | null>(null);
