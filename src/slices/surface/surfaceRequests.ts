// Asking the app to show a surface where it is drawn, from the surface itself, as the operator's move of it
// does (#727).
import type { SurfaceKey } from "./surfaceTypes.ts";

const EVENT = "quay:surface-request";

/** Asks for the surface `key` to be brought into view. */
export function requestSurface({ terminal_id, id }: SurfaceKey): void {
  window.dispatchEvent(new CustomEvent<SurfaceKey>(EVENT, { detail: { terminal_id, id } }));
}

/** Calls `show` with each request. Returns a function that stops it. */
export function onSurfaceRequest(show: (key: SurfaceKey) => void): () => void {
  const listener = (e: Event) => show((e as CustomEvent<SurfaceKey>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
