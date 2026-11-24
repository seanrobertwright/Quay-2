// What Rust and the webview say to each other about surfaces, and the A2UI shapes both sides of the
// A2UI module speak in. Mirrors `src-tauri/src/slices/surface`.

/** One component of a surface, as a wire message holds it. */
export interface SurfaceComponent {
  id: string;
  component: string;
  [property: string]: unknown;
}

/** An A2UI 1.0 `createSurface` message. */
export interface CreateSurface {
  version: "1.0";
  createSurface: {
    surfaceId: string;
    /** Quay's catalog, which the A2UI module fills in. */
    catalogId?: string;
    components: SurfaceComponent[];
    dataModel: Record<string, unknown>;
  };
}

/** The action an operator's click sends, with its context resolved. */
export interface SurfaceAction {
  name: string;
  context: Record<string, unknown>;
}

/** An action as its click sent it. */
export interface SentAction extends SurfaceAction {
  /** The A2UI 1.0 `action` message it makes. */
  message: Record<string, unknown>;
}

/** A call for the webview to check. Mirrors `CheckRequest`. */
export interface CheckRequest {
  call: number;
  tool: string;
  /** The id the surface has if it is accepted. Empty for a raw call that creates none. */
  surface_id: string;
  /** The call's arguments: a typed call's as Rust checked them, a raw one's as its agent wrote them. */
  arguments: unknown;
}

/** One thing wrong with a call. A typed tool's is the engine's, as its `mapErrorToRendererMessage` gives it. */
export interface EngineError {
  code: string;
  /** The surface it is about, when that is known. */
  surfaceId?: string;
  /** For a raw call, a JSON Pointer into the call as its agent wrote it. */
  path?: string;
  message: string;
}

/** What the webview made of a check. Mirrors `Verdict`. */
export type Verdict =
  | {
      errors: EngineError[];
      /** How many more there are. Left out for none. */
      more?: number;
    }
  | {
      state: CreateSurface;
      asks: boolean;
      components: number;
      images: number;
      /** The image files it names, each once, in the order the surface has them. */
      image_paths: string[];
    };

/** Which surface. Mirrors `SurfaceKey`. */
export interface SurfaceKey {
  terminal_id: string;
  id: string;
}

/** Where a surface is drawn: the companion's Surface view, a stage tab of its own, or its terminal's pane. Mirrors `Place`. */
export type SurfacePlace = "companion" | "tab" | "strip";

/** How a board's run stands, as its agent says it. Mirrors `Status`. */
export type BoardStatus = "running" | "done" | "failed";

/** The run a board shows, with its clock, in milliseconds since the epoch. Mirrors `BoardRun`. */
export interface BoardRun {
  title: string;
  status: BoardStatus;
  started_at: number;
  /** When its agent last sent it. */
  updated_at: number;
  /** When its clock stopped, or null while it runs. */
  stopped_at: number | null;
}

/** A surface as Rust holds it. Mirrors `SurfaceRecord`. */
export interface SurfaceRecord extends SurfaceKey {
  tool: string;
  /** What its agent calls it: its title, or an ask's first question. */
  title: string;
  place: SurfacePlace;
  state: CreateSurface;
  revision: number;
  order: number;
  change: number;
  asks: boolean;
  /** When it was shown, in milliseconds since the epoch. */
  shown_at: number;
  /** The result its agent got, once the operator has answered. */
  answer: unknown;
  /** When the answer was sent, in milliseconds since the epoch, or null while there is none. */
  answered_at: number | null;
  /** When its terminal exited before it was settled, in milliseconds since the epoch, or null. */
  ended_at: number | null;
  /** The run a board shows, or null for another surface. */
  board: BoardRun | null;
}

/** A live surface has had no answer and, if it is a board, runs, and its terminal has not exited. One that is not live is locked. */
export const isLive = ({ answer, ended_at, board }: SurfaceRecord): boolean =>
  (answer ?? null) === null && ended_at === null && (board?.stopped_at ?? null) === null;
