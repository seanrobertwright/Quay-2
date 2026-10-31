import React from "react";
import type { HandOff } from "./handOff";

/**
 * The "With ‹agent›" label on a conflicted file an agent holds (#392), in the Conflicts list and the
 * resolver's file list; nothing when no agent holds it. The agent name is untrusted and shown only
 * as text.
 */
export const HeldBadge: React.FC<{ held: HandOff | undefined }> = ({ held }) =>
  held === undefined ? null : (
    <span className="shrink-0 max-w-[40%] truncate text-[11px] text-[#d2a8ff]" title={`With ${held.agentName}`}>
      With {held.agentName}
    </span>
  );
