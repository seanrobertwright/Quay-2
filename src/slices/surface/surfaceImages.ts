// The image files of a drawn surface: Rust reads each once for as long as something in the surface draws
// it, and what it gave is a blob URL for that long.
import { createContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SurfaceKey } from "./surfaceTypes.ts";

/** Where the reading of an image stands, or why it is not shown, in words for the operator. */
export type ImageReading = { state: "reading" } | { state: "read"; url: string } | { state: "refused"; why: string };

export interface SurfaceImages {
  /**
   * Reads the image at `path`, unless it is read already, and tells `told` how that stands until the
   * returned function is called. Once nobody is told, its blob URL is revoked, and what a read that is
   * still under way gives is dropped.
   */
  open: (path: string, told: (reading: ImageReading) => void) => () => void;
}

/** The images of the surface that is drawn. Where none is, none is read. */
export const ImagesContext = createContext<SurfaceImages>({
  open: (_path, told) => {
    told({ state: "refused", why: "There is no surface to read it for." });
    return () => {};
  },
});

/** The type of each kind Rust gives, by the first byte, which differs in each. */
const TYPES: ReadonlyMap<number, string> = new Map([
  [0x89, "image/png"],
  [0xff, "image/jpeg"],
  [0x47, "image/gif"],
  [0x52, "image/webp"],
]);

const blobUrl = (bytes: ArrayBuffer): string => URL.createObjectURL(new Blob([bytes], { type: TYPES.get(new Uint8Array(bytes)[0]) }));

export const READING: ImageReading = { state: "reading" };

/** The images of the surface `key`. */
export function surfaceImages({ terminal_id, id }: SurfaceKey): SurfaceImages {
  interface Held {
    reading: ImageReading;
    told: Set<(reading: ImageReading) => void>;
  }
  const held = new Map<string, Held>();

  function hold(path: string): Held {
    const mine: Held = { reading: READING, told: new Set() };
    held.set(path, mine);
    const settle = (read: () => ImageReading) => {
      // Let go of while it was read, and perhaps read anew since
      if (held.get(path) !== mine) return;
      mine.reading = read();
      for (const tell of mine.told) tell(mine.reading);
    };
    invoke<ArrayBuffer>("surface_image", { terminalId: terminal_id, id, path }).then(
      (bytes) => settle(() => ({ state: "read", url: blobUrl(bytes) })),
      (why) => settle(() => ({ state: "refused", why: String(why) })),
    );
    return mine;
  }

  return {
    open: (path, told) => {
      const mine = held.get(path) ?? hold(path);
      mine.told.add(told);
      told(mine.reading);
      return () => {
        mine.told.delete(told);
        if (mine.told.size > 0 || held.get(path) !== mine) return;
        held.delete(path);
        if (mine.reading.state === "read") URL.revokeObjectURL(mine.reading.url);
      };
    },
  };
}
