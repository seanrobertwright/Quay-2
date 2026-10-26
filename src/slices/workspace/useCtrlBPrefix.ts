import { useEffect, useState } from "react";
import { createCtrlBPrefix, CtrlBPrefix } from "./ctrlBPrefix";

/**
 * The `Ctrl+Shift+B` prefix a component keeps for its whole life, so a re-render between
 * Ctrl+Shift+B and its second key does not drop it. Unmounting disposes it, which cancels its timer.
 */
export function useCtrlBPrefix(): CtrlBPrefix {
  const [prefix] = useState(() => createCtrlBPrefix());
  useEffect(() => () => prefix.dispose(), [prefix]);
  return prefix;
}
