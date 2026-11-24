/**
 * Whether `prompt`, as a CLI reports it, has the shape of the line Quay types into a terminal for a
 * surface's answer that no open call can return. Rust's `is_typed_line` tells by the same shape; this
 * also trims the prompt and drops the tag a CLI wraps pasted content in, which Rust's caller does.
 */
export function isTypedAnswer(prompt: string): boolean {
  const line = prompt.trim().replace(/^<pasted_content(?: [^>]*)?>\s*/, "");
  return line.startsWith('[Quay surface "') && line.includes('" (') && line.includes(")]: {");
}
