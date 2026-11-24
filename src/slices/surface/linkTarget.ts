// What an agent's link leads to. It is worked out from the text alone: nothing is fetched or read.

/** A web address, as it is shown and opened. */
export interface WebTarget {
  kind: "web";
  address: string;
  host: string;
}

/** A path on this machine, which Rust judges at the click. */
export interface FileTarget {
  kind: "file";
  path: string;
}

/** The longest address a link may have: the frame's foot shows all of it. */
const MAX_ADDRESS = 2048;

/** More percent escapes inside percent escapes than this are nothing an agent means. */
const MAX_DECODES = 4;

/** Control and invisible characters, which some parsers drop and no reader sees. */
export const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{fffd}]/u;

/** The web address `href` is, spelled as the network spells it, or null when it is none. */
export function webTarget(href: string): WebTarget | null {
  if (href.length > MAX_ADDRESS || /[\p{Cc}\u{fffd}]/u.test(href) || !/^https?:\/\//i.test(href) || !URL.canParse(href)) return null;
  const { href: address, host } = new URL(href);
  return address.length > MAX_ADDRESS ? null : { kind: "web", address, host };
}

/** `text` with its percent escapes read, or null when they are not escapes of anything. */
function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Whether a colon in `path` is more than a drive's or a line number's, so that it may be a scheme's.
 * A line number follows a name with a dot or a folder.
 */
function hasScheme(path: string): boolean {
  const plain = path.normalize("NFKC").replace(/^[a-z]:(?=[\\/])/i, "");
  const line = /:\d{1,9}(:\d{1,9})?$/.exec(plain);
  const name = line ? plain.slice(0, line.index) : plain;
  return name.includes(":") || (line !== null && !/[./\\]/.test(name));
}

function fileTarget(href: string): FileTarget | null {
  if (href === "" || /^[#?]/.test(href)) return null;
  // Rust reads what follows a file: scheme.
  if (/^file:\/\//i.test(href)) return UNSEEN.test(href) ? null : { kind: "file", path: href };
  let text = href;
  for (let i = 0; i <= MAX_DECODES; i += 1) {
    if (UNSEEN.test(text) || hasScheme(text)) return null;
    const next = decoded(text);
    if (next === null || next === text) return { kind: "file", path: decoded(href) ?? href };
    text = next;
  }
  return null;
}

/** What a Markdown link to `href` leads to, or null when it is no link and is shown as text. */
export function linkTarget(href: string): WebTarget | FileTarget | null {
  if (href.length > MAX_ADDRESS || href.trim() !== href) return null;
  return /^https?:/i.test(href) ? webTarget(href) : fileTarget(href);
}
