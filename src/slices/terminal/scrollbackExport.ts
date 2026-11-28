import { formatDateStamp } from "../../lib/dates.ts";

/** The name an exported scrollback file is saved under: `<terminal>-<local date>.log`. */
export function scrollbackFileName(terminalName: string, ms: number): string {
  const safeName = terminalName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safeName}-${formatDateStamp(ms)}.log`;
}
