export const USAGE = "Usage: receipt <shopping-list file> [--total]";

/**
 * Reads the command line: one file path, and --total to print only the total. Returns
 * { path, totalOnly }, or { error } with the reason when the command line is wrong.
 */
export function parseArgs(argv) {
  const unknown = argv.find((arg) => arg.startsWith("--") && arg !== "--total");
  if (unknown !== undefined) return { error: `unknown option ${unknown}` };
  const paths = argv.filter((arg) => !arg.startsWith("--"));
  if (paths.length !== 1) return { error: "give exactly one shopping-list file" };
  return { path: paths[0], totalOnly: argv.includes("--total") };
}
