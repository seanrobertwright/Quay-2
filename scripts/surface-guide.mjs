// Writes the guide that quay_surface_guide returns, generated from the surface catalog's own schemas, to
// where Rust builds it in. A build runs it with the release workflow's Node, which runs no TypeScript.
//
//   node scripts/surface-guide.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

if (process.argv.length > 2) {
  console.error(`Unknown argument: ${process.argv.slice(2).join(' ')}. Usage: node scripts/surface-guide.mjs`);
  process.exit(2);
}

const file = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const written = file('src-tauri/src/slices/surface/surface_guide.md');

// Vite compiles the catalog's TypeScript and JSX.
const { module } = await runnerImport(file('src/slices/surface/a2ui/guide/guide.ts'), { configFile: false, logLevel: 'error' });
const text = module.guide();

// Written only when it changes, since cargo compiles again what is built in from a newer file.
const before = await readFile(written, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (before !== text) await writeFile(written, text);
