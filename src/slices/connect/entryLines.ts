/** `entry`, a member as its file has it, without the indentation its lines after the first share. */
export function entryLines(entry: string): string {
  const [first, ...rest] = entry.split(/\r?\n/);
  const indents = rest.filter((line) => line.trim() !== "").map((line) => line.length - line.trimStart().length);
  const shared = indents.length === 0 ? 0 : Math.min(...indents);
  return [first, ...rest.map((line) => line.slice(shared))].join("\n");
}
