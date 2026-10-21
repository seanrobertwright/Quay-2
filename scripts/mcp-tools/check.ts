// Fails when the A2A page's tool reference disagrees with the tools Quay's MCP server lists.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { REFERENCE_PAGE, TOOL_LIST, parseToolList, parseToolReference, referenceProblems } from './mcp-tools.ts';

if (process.argv.length > 2) {
  console.error(`Unknown argument: ${process.argv.slice(2).join(' ')}. Usage: node scripts/mcp-tools/check.ts`);
  process.exit(2);
}

/** Runs `read` on `file`, or exits naming `file` with what went wrong. */
async function load<T>(file: URL, read: (text: string) => T): Promise<T> {
  try {
    return read(await readFile(file, 'utf8'));
  } catch (error) {
    console.error(`${fileURLToPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const tools = await load(TOOL_LIST, parseToolList);
const reference = await load(REFERENCE_PAGE, parseToolReference);
const problems = referenceProblems(tools, reference);

if (problems.length > 0) {
  console.error(
    `The tool reference in ${fileURLToPath(REFERENCE_PAGE)} disagrees with ${fileURLToPath(TOOL_LIST)}:\n` +
      problems.map((problem) => `  ${problem}`).join('\n'),
  );
  process.exit(1);
}
