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

/** A call for the webview to check. Mirrors `CheckRequest`. */
export interface CheckRequest {
  call: number;
  tool: string;
  surface_id: string;
  /** The call's arguments, as Rust checked them. */
  arguments: unknown;
}

/** An engine error, as its `mapErrorToRendererMessage` gives it. */
export interface EngineError {
  code: string;
  path?: string;
  message: string;
}

/** What the webview made of a check. Mirrors `Verdict`. */
export type Verdict = { errors: EngineError[] } | { state: CreateSurface; asks: boolean; components: number; images: number };

/** Which surface. Mirrors `SurfaceKey`. */
export interface SurfaceKey {
  terminal_id: string;
  id: string;
}

/** Where a surface is drawn: the companion's Surface view, a stage tab of its own, or its terminal's pane. Mirrors `Place`. */
export type Place = "companion" | "tab" | "strip";

/** A surface as Rust holds it. Mirrors `SurfaceRecord`. */
export interface SurfaceRecord extends SurfaceKey {
  tool: string;
  place: Place;
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
}

/** A live surface has had no answer, and its terminal has not exited. One that is not live is locked. */
export const isLive = ({ answer, ended_at }: SurfaceRecord): boolean => (answer ?? null) === null && ended_at === null;
