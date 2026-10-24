import { useEffect, useState } from "react";
import { createCtrlBPrefix, CtrlBPrefix } from "./ctrlBPrefix";

/**
 * The `Ctrl+B` prefix a component keeps for its whole life, so a re-render between Ctrl+B and
 * its second key does not drop it. Unmounting disposes it, which cancels its timer.
 */
export function useCtrlBPrefix(): CtrlBPrefix {
  const [prefix] = useState(() => createCtrlBPrefix());
  useEffect(() => () => prefix.dispose(), [prefix]);
  return prefix;
}
