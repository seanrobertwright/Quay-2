// Open in browser for a run on the Praxis host (#362, #452). Decisions on a run (approve, pause,
// cancel, resolving a hold) happen only in the host's browser page, so Quay opens that page and
// nothing else: an https address on this machine's Praxis host. Every view that offers Open in
// browser opens it through here.
//
// #362 names `https://127.0.0.1:<port>/`. The praxis CLI at the pinned AI-WS-SDK commit builds
// `runPageAddress` and `blockingRunAddress` on the host's browser origin instead
// (`browserOrigin` in engine/src/browser-origin.ts): `https://praxis-<label>.localhost:<port>`,
// where the label is ten lower-case base32 characters. A `.localhost` name always resolves to
// loopback (RFC 6761), so both forms stay on this machine, and both are accepted.
import { openUrl } from "@tauri-apps/plugin-opener";

// The port is written out, so a default port that a URL parser would drop is refused too.
const RUN_PAGE = /^https:\/\/(?:127\.0\.0\.1|praxis-[a-z2-7]{10}\.localhost):([1-9][0-9]{0,4})\/[^\s]*$/;

/**
 * True when `address` is a page on this machine's Praxis host: `https://127.0.0.1:<port>/…` or
 * the host's browser origin, `https://praxis-<label>.localhost:<port>/…`.
 */
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
