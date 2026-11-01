// Open in browser for a run on the Praxis host (#362, #452). Decisions on a run (approve, pause,
// cancel, resolving a hold) happen only in the host's browser page, so Quay opens that page and
// nothing else: an address on the local host's https port, `https://127.0.0.1:<port>/…`. Every
// view that offers Open in browser opens it through here.
import { openUrl } from "@tauri-apps/plugin-opener";

// The port is written out, so a default port that a URL parser would drop is refused too.
const RUN_PAGE = /^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/[^\s]*$/;

/** True when `address` is a page on the local Praxis host, `https://127.0.0.1:<port>/…`. */
export function isRunPageAddress(address: string): boolean {
  const match = RUN_PAGE.exec(address);
  return match !== null && Number(match[1]) <= 65_535 && URL.canParse(address);
}

/**
 * Opens `address` in the system browser when it is a run page address; false, and nothing
 * opened, when it isn't. Rejects when the opener does.
 */
export async function openRunPage(address: string, open: (url: string) => Promise<void> = openUrl): Promise<boolean> {
  if (!isRunPageAddress(address)) return false;
  await open(address);
  return true;
}
