// What an agent's image leads to. It is worked out from the text alone: nothing is fetched or read.
import { linkTarget, UNSEEN } from "./linkTarget.ts";

/** A path, which Rust judges as the image is shown, or why there is no image, in words for the operator. */
export type ImageTarget = { kind: "file"; path: string } | { kind: "none"; why: string };

const none = (why: string): ImageTarget => ({ kind: "none", why });

/** What an image in Markdown leads to. Its address may have percent escapes, as a Markdown link's may. */
export function markdownImageTarget(address: string): ImageTarget {
  if (address === "") return none("It names no file.");
  if (/^https?:/i.test(address)) return none("Quay loads no image from the web.");
  if (/^data:/i.test(address)) return none("Quay shows an image only from a file.");
  const target = linkTarget(address);
  return target?.kind === "file" ? target : none("It is not a path Quay can open.");
}

/** What an Image's `url` leads to. It takes a path as it is, in which a percent sign is only that. */
export function imageTarget(url: string): ImageTarget {
  const path = url.trim();
  const target = markdownImageTarget(path);
  return target.kind === "file" ? { kind: "file", path } : target;
}

/** The most characters of an address that a box shows. */
const MOST_SHOWN = 200;

/** `address` as a box shows it: cut where it is long, with a space for each character nobody sees. */
export function shownAddress(address: string): string {
  const characters = [...address.slice(0, 2 * MOST_SHOWN + 1)];
  const cut = characters.length > MOST_SHOWN;
  return `${characters.slice(0, MOST_SHOWN).join("").replace(new RegExp(UNSEEN, "gu"), " ")}${cut ? "…" : ""}`;
}
