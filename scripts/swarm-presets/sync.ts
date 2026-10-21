// Rewrites the preset lists in the README and the swarm presets feature page from
// `BUILTIN_SWARM_PRESETS`. With --check, writes nothing and fails when either list is stale.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GENERATED_FILES } from './swarm-presets.ts';

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== '--check');
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown.join(' ')}. Usage: node scripts/swarm-presets/sync.ts [--check]`);
  process.exit(2);
}
const check = args.includes('--check');

const stale: string[] = [];
for (const file of GENERATED_FILES) {
  const path = fileURLToPath(file.path);
  const text = await readFile(path, 'utf8');
  let generated: string;
  try {
    generated = file.regenerate(text);
  } catch (error) {
    console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (generated === text) continue;
  stale.push(path);
  if (!check) await writeFile(path, generated);
}

if (check && stale.length > 0) {
  console.error(`The preset lists are stale in:\n${stale.map((path) => `  ${path}`).join('\n')}\nRun pnpm docs:presets.`);
  process.exit(1);
}
for (const path of check ? [] : stale) console.log(`Wrote the preset list in ${path}`);
