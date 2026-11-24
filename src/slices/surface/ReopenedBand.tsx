import { lookOf } from "./looks/index.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { When } from "./When.tsx";

/** The line under a live surface's header bar when its agent opened it again: when, and what the operator had sent and when. */
export const ReopenedBand = ({ record }: { record: SurfaceRecord }) => {
  const { reopened, tool, state } = record;
  if (!reopened) return null;
  const { Settled } = lookOf(tool);
  return (
    <div data-reopened className="border-b border-[#30363d] bg-[#d29922]/10 px-3 py-1.5 text-[11px] text-[#8b949e]">
      <p role="status">
        <span className="text-[#e3b341]">
          Reopened by the agent, <When ms={reopened.at} />.
        </span>{" "}
        You sent at <When ms={reopened.answered_at} />:
      </p>
      {Settled && <Settled answer={reopened.answer} components={state.createSurface.components} />}
    </div>
  );
};
