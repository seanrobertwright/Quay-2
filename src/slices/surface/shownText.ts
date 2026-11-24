// A short text an agent wrote, such as an address or a terminal's name, where Quay shows it.
import { UNSEEN } from "./linkTarget.ts";

/** The most characters of it that are shown. */
const MOST_SHOWN = 200;

/** `text` as Quay shows it: cut where it is long, with a space for each character nobody sees. */
export function shownText(text: string): string {
  const characters = [...text.slice(0, 2 * MOST_SHOWN + 1)];
  const cut = characters.length > MOST_SHOWN;
  return `${characters.slice(0, MOST_SHOWN).join("").replace(new RegExp(UNSEEN, "gu"), " ")}${cut ? "…" : ""}`;
}
