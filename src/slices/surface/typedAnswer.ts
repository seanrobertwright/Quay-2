/**
 * Whether `prompt` is the line Quay types into a terminal for a surface's answer that no open call can
 * return, as the CLI reports it, so possibly wrapped as pasted content. Mirrors `is_typed_line`.
 */
export function isTypedAnswer(prompt: string): boolean {
  const line = prompt.trim().replace(/^<pasted_content(?: [^>]*)?>\s*/, "");
  return line.startsWith('[Quay surface "') && line.includes('" (') && line.includes(")]: {");
}
