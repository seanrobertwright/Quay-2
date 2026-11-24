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
  /** The surfaces a raw call updates, as they were accepted last. Left out when it updates none. */
  held?: HeldSurface[];
}

/** A surface that the scratch copy is built from. Mirrors `HeldSurface`. */
export interface HeldSurface {
  place: SurfacePlace;
  state: CreateSurface;
}

/** One thing the webview found wrong with a call. A typed tool's is the engine's, as its `mapErrorToRendererMessage` gives it. Mirrors `CheckError`. */
export interface CheckError {
  code: string;
  /** The surface it is about, when that is known. */
  surfaceId?: string;
  /** For a raw call, a JSON Pointer into the call as its agent wrote it. */
  path?: string;
  message: string;
}

/** A surface the engine accepted. Mirrors `Accepted`. */
export interface Accepted {
  state: CreateSurface;
  asks: boolean;
  components: number;
  images: number;
  /** The image files it names, each once, in the order the surface has them. */
  image_paths: string[];
}

/** One of the surfaces a raw call creates or updates. Mirrors `AcceptedSurface`. */
export interface AcceptedSurface extends Accepted {
  surface_id: string;
}

/** What the webview made of a check. Mirrors `Verdict`. */
export type Verdict =
  | {
      errors: CheckError[];
      /** How many more there are, which is none when it is left out. Only a raw call's are counted. */
      more?: number;
    }
  | Accepted
  /** A raw call's: each surface that is there once all of its messages are applied. */
  | { surfaces: AcceptedSurface[] };

/** Which surface. Mirrors `SurfaceKey`. */
export interface SurfaceKey {
  terminal_id: string;
  id: string;
}

/** Where its agent has a surface drawn: the companion's Surface view, a stage tab of its own, or its terminal's pane. Mirrors `Place`. */
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

/** Which of what the operator put in an earlier revision of a surface its latest one keeps. Mirrors `Carried`. */
export interface Carried {
  /** The oldest revision that anything is carried on from. */
  from: number;
  /** The data paths that updates have set since, each with the last revision whose update did. */
  set: Record<string, number>;
}

/** An answered surface that its agent opened again. Times are in milliseconds since the epoch. Mirrors `Reopened`. */
export interface Reopened {
  at: number;
  /** The answer it had. */
  answer: unknown;
  answered_at: number;
}

/** A surface as Rust holds it. Mirrors `SurfaceRecord`. */
export interface SurfaceRecord extends SurfaceKey {
  tool: string;
  /** What its agent calls it: its title, or an ask's first question. */
  title: string;
  place: SurfacePlace;
  /** Whether the operator has a raw companion surface open as a stage tab. */
  as_tab: boolean;
  state: CreateSurface;
  revision: number;
  /** Where it stands among the surfaces: one committed or opened again later has a higher order. */
  order: number;
  /** The order it was committed with. Opened again or replaced, it keeps that. */
  began: number;
  change: number;
  asks: boolean;
  /** When it was shown, in milliseconds since the epoch. */
  shown_at: number;
  /** When its agent last changed its content, in milliseconds since the epoch. */
  updated_at: number;
  carried: Carried;
  /** How it was opened again, or null when it was not since it was last answered. */
  reopened: Reopened | null;
  /** The result its agent got, once the operator has answered. */
  answer: unknown;
  /** When the answer was sent, in milliseconds since the epoch, or null while there is none. */
  answered_at: number | null;
  /** When its terminal exited before it was settled, in milliseconds since the epoch, or null. */
  ended_at: number | null;
  /** When its agent deleted it before it was answered, in milliseconds since the epoch, or null. */
  withdrawn_at: number | null;
  /** The run a board shows, or null for another surface. */
  board: BoardRun | null;
}

/** Where a surface is drawn: in the place its agent chose, unless the operator moved it. */
export const drawnIn = ({ place, as_tab }: SurfaceRecord): SurfacePlace => (as_tab ? "tab" : place);

/** Whether a surface is locked with nothing sent of it: its terminal exited, or its agent deleted it. */
export const isUnanswered = ({ ended_at, withdrawn_at }: SurfaceRecord): boolean => ended_at !== null || withdrawn_at !== null;

/** A live surface has no answer and, if it is a board, runs, its terminal has not exited, and its agent has not deleted it. One that is not live is locked. */
export const isLive = (record: SurfaceRecord): boolean =>
  (record.answer ?? null) === null && !isUnanswered(record) && (record.board?.stopped_at ?? null) === null;
