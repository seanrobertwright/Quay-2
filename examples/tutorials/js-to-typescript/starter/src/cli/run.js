import { parseDocument } from "../parse/index.js";
import { renderReceipt } from "../format/index.js";
import { parseArgs, USAGE } from "./args.js";

/**
 * Runs receipt with the command-line arguments in argv. io.readFile(path) returns a file's text
 * and io.out(line) prints one line, so the tests can pass in their own. Returns the exit code:
 * 0 for a receipt, 1 for a list with bad lines or a file that can't be read, 2 for bad arguments.
 */
export function run(argv, io) {
  const args = parseArgs(argv);
  if (args.error) {
    io.out(`receipt: ${args.error}`);
    io.out(USAGE);
    return 2;
  }
  let text;
  try {
    text = io.readFile(args.path);
  } catch (error) {
    io.out(`receipt: can't read ${args.path}: ${error.message}`);
    return 1;
  }
  const list = parseDocument(text);
  if (list.errors.length > 0) {
    for (const problem of list.errors) io.out(`receipt: ${problem.message}`);
    return 1;
  }
  const receipt = renderReceipt(list.items);
  io.out(args.totalOnly ? receipt.split("\n").at(-1) : receipt);
  return 0;
}
