import { lockedState } from "./lockedState.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { When } from "./When.tsx";

/** The line under a locked surface's header bar: why it is locked, and when that was. */
export const LockedBand = ({ record }: { record: SurfaceRecord }) => {
  const { reason, Icon, tone, at } = lockedState(record);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 border-b border-[#30363d] px-3 py-1.5 text-[11px] text-[#8b949e]">
      <p role="status" className={`flex items-center gap-1.5 ${tone}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {reason}
      </p>
      {at !== null && <When ms={at} />}
    </div>
  );
};
