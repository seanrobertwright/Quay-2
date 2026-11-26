import { useState } from "react";

/** Why a surface's frame did not take what the operator did, as its foot shows it. */
export interface Refusal {
  /** Sets the frame's own refusal, or null to take it away. */
  setRefusal: (why: string | null) => void;
  /** What the foot shows: the frame's own refusal, else what was said from outside it. */
  shown: string | null;
  /** Takes away what the foot shows, at its notice's ×. */
  dismiss: () => void;
}

/**
 * A frame's refusal of an answer, dismissal or move, in front of `outside`: why something done from outside
 * the frame, such as closing its tab, did not dismiss it. `forgetOutside` takes that away.
 */
export function useRefusal(outside: string | null, forgetOutside?: () => void): Refusal {
  const [refusal, setRefusal] = useState<string | null>(null);
  return {
    setRefusal,
    shown: refusal ?? outside,
    dismiss: () => (refusal !== null ? setRefusal(null) : forgetOutside?.()),
  };
}
