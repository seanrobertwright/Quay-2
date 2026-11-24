import { lazy, Suspense } from "react";
import { LinksContext } from "../links.ts";
import { loadA2ui } from "../surfaceHost.ts";
import type { SurfaceRecord } from "../surfaceTypes.ts";

const SurfaceContent = lazy(async () => ({ default: (await loadA2ui()).SurfaceContent }));

/** A raw surface as it was, with every form control in it disabled and its links as text. */
export const RawAsked = ({ record }: { record: SurfaceRecord }) => (
  <fieldset disabled className="min-w-0 opacity-70">
    <LinksContext.Provider value={null}>
      <Suspense fallback={<p className="text-[#8b949e]">Loading…</p>}>
        <SurfaceContent record={record} layout={null} />
      </Suspense>
    </LinksContext.Provider>
  </fieldset>
);
