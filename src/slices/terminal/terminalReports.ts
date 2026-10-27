/**
 * Replies xterm writes to onData by itself when it parses a query or a mode change, as opposed
 * to the user's keys, paste and mouse. Replaying saved output parses old queries again, and their
 * replies must not reach the live program as if the user had typed them.
 *
 * Each reply arrives as its own onData call, so a pattern matches the whole payload.
 */
const TERMINAL_REPORTS: RegExp[] = [
  // Cursor position (CPR) and extended cursor position (DECXCPR): ESC[row;colR, ESC[?row;colR
  /^\x1b\[\??\d+;\d+R$/,
  // Device status (DSR 5): ESC[0n
  /^\x1b\[\d+n$/,
  // Primary and secondary device attributes (DA1, DA2): ESC[?1;2c, ESC[>0;276;0c
  /^\x1b\[[?>][\d;]*c$/,
  // Mode report (DECRQM): ESC[?2004;1$y, ESC[4;2$y
  /^\x1b\[\??\d+;\d+\$y$/,
  // Window size in pixels, cell size, size in characters: ESC[4;h;wt, ESC[6;h;wt, ESC[8;r;ct
  /^\x1b\[[468];\d+;\d+t$/,
  // Focus in and out, sent at once when focus reporting (ESC[?1004h) turns on
  /^\x1b\[[IO]$/,
  // DCS replies such as DECRQSS (ESC P1$r...ESC\) and XTVERSION (ESC P>|name ESC\)
  /^\x1bP[\s\S]*\x1b\\$/,
  // OSC color replies (OSC 4/10/11/12): ESC]11;rgb:0d0d/1111/1717 ESC\ or BEL
  /^\x1b\][\s\S]*(?:\x1b\\|\x07)$/,
];

/**
 * Whether an onData payload is a terminal report rather than input from the user.
 *
 * A few modified function keys share a report's shape: xterm encodes Ctrl+F3 as ESC[1;5R, which
 * reads as a cursor position. Callers only drop reports while a replay is parsed, so the cost is
 * such a key pressed in that brief window.
 */
export function isTerminalReport(data: string): boolean {
  return TERMINAL_REPORTS.some((re) => re.test(data));
}

/**
 * A cursor position query (ESC[6n, or DECXCPR's ESC[?6n) as the last thing in a snapshot. ConPTY
 * sends one as a new terminal's first output and starts the shell only once it is answered.
 * Other queries, such as the XTVERSION query Claude Code sends while it sits idle, are left to
 * the replay: the program goes on without their reply, so a remount answering them again would
 * only type that reply into it.
 */
const TRAILING_CURSOR_QUERY = /\x1b\[\??6n$/;

/**
 * Splits a replay of a terminal's saved output into the part whose queries are old and a cursor
 * position query at its very end. With no output after it, the program is still waiting on that
 * query, so its reply must reach the program. Any earlier query was answered when it first arrived.
 */
export function splitPendingQueries(data: string): { replayed: string; pending: string } {
  const match = TRAILING_CURSOR_QUERY.exec(data);
  if (match === null) return { replayed: data, pending: "" };
  return { replayed: data.slice(0, match.index), pending: match[0] };
}
