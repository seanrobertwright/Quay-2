/**
 * The terminal a single-pane stage shows. Zoomed from a split (`Ctrl+Shift+B Z`), it is the pane that
 * had focus, which `Ctrl+Shift+B O` or a click made the active terminal. Otherwise it is the primary
 * terminal, or the active one while there is no primary.
 */
export function singleLayoutTerminalId({
  primaryTerminalId,
  activeTerminalId,
  zoomed,
}: {
  primaryTerminalId: string | null;
  activeTerminalId: string | null;
  zoomed: boolean;
}): string | null {
  if (zoomed) return activeTerminalId ?? primaryTerminalId;
  return primaryTerminalId || activeTerminalId;
}
