import { useEffect, useId, useRef } from "react";
import type { SurfaceLinks } from "../links.ts";

const WAYS = ["pointer", "focus"] as const;

/**
 * What a control that leads to `address` takes, so that the frame's foot says so while the pointer or the
 * focus is on it, and describes it. Nothing for one that leads nowhere.
 */
export function usePointed(links: SurfaceLinks | null, address: string | null) {
  const id = useId();
  const on = useRef({ pointer: false, focus: false });
  useEffect(() => {
    if (!links || address === null) return;
    const gone = links.present();
    // It may be on it already, with another address
    for (const by of WAYS) if (on.current[by]) links.point(by, id, address);
    return () => {
      for (const by of WAYS) links.point(by, id, null);
      gone();
    };
  }, [links, id, address]);
  const point = (by: (typeof WAYS)[number], is: boolean) => () => {
    on.current[by] = is;
    if (address !== null) links?.point(by, id, is ? address : null);
  };
  return {
    "aria-describedby": links && address !== null ? links.footId : undefined,
    onMouseEnter: point("pointer", true),
    onMouseLeave: point("pointer", false),
    onFocus: point("focus", true),
    onBlur: point("focus", false),
  };
}
