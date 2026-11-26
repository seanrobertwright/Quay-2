import { lockedState } from "./lockedState.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { When } from "./When.tsx";

/** The line under a locked surface's header bar, tinted in its state's colour: why it is locked, and at its right end when that was. */
export const LockedBand = ({ record }: { record: SurfaceRecord }) => {
  const { reason, Icon, tone, at } = lockedState(record);
  return (
    <div className={`flex flex-wrap items-center gap-x-1.5 border-b border-[#30363d] bg-current/8 px-3 py-1.5 text-[11px] ${tone}`}>
      <p role="status" className="flex min-w-0 items-center gap-1.5">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {reason}
      </p>
      {at !== null && <When ms={at} className="ml-auto shrink-0 text-[#8b949e]" />}
    </div>
  );
};
