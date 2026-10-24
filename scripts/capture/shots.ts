// Puts a tutorial's screenshots, taken by hand, beside its page: each saved shot replaces the
// still of the same name, a PNG converted to WebP. README.md beside this file says how to take them.
//
//   pnpm docs:shots <slug> <folder of saved shots>
//
// Exits 0 when every still has a shot, 1 when a still is left without one or a shot is named
// after no still, and 2 on a bad argument.

import { existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { TUTORIALS } from '../../docs/.vitepress/tutorials.ts';
import { capturePaths, WEBP_QUALITY } from './capture.ts';
import { placeSavedShots } from './shot-report.ts';

const root = join(import.meta.dirname, '..', '..');
const USAGE = 'usage: pnpm docs:shots <slug> <folder of saved shots>';

const [slug, folder, ...rest] = process.argv.slice(2);
const tutorial = TUTORIALS.find((t) => t.slug === slug);
if (slug === undefined || folder === undefined || rest.length > 0) {
  console.error(`docs:shots: ${USAGE}`);
  process.exit(2);
}
if (tutorial === undefined) {
  console.error(`docs:shots: ${slug} is not a tutorial slug; slugs are in docs/.vitepress/tutorials.ts`);
  process.exit(2);
}
const saved = resolve(folder);
if (!existsSync(saved) || !statSync(saved).isDirectory()) {
  console.error(`docs:shots: ${saved} is not a folder`);
  process.exit(2);
}

try {
  const { stills } = capturePaths(root, tutorial);
  const { placed, missing } = await placeSavedShots(stills, saved, WEBP_QUALITY);
  const shown = relative(root, stills).replaceAll('\\', '/');
  for (const name of placed) console.log(`${shown}/${name}.webp`);
  if (missing.length > 0) {
    console.error(`docs:shots: no shot saved for ${missing.join(', ')}; save each as <name>.png or <name>.webp in ${saved}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`docs:shots: ${(error as Error).message}`);
  process.exit(1);
}
