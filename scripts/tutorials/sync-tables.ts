// Writes the tutorial tables into the Tutorials landing page and the README, listing only the
// tutorials whose pages exist. `docs:build` runs it with --check, which fails when either file is
// out of date; `pnpm docs:tutorials` brings both up to date.
//
//   node scripts/tutorials/sync-tables.ts [--check]
//
// Exits 0 when both files are (or now are) up to date, 1 when --check finds one stale or a page
// breaks the tables' rules, and 2 on a bad argument.

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { syncTutorialTables } from './sync.ts';

function main(): number {
  let check: boolean;
  try {
    const { values } = parseArgs({ options: { check: { type: 'boolean' } }, strict: true, allowPositionals: false });
    check = values.check ?? false;
  } catch (error) {
    console.error(`sync-tables: ${(error as Error).message}`);
    console.error('usage: node scripts/tutorials/sync-tables.ts [--check]');
    return 2;
  }

  const report = syncTutorialTables({ root: join(import.meta.dirname, '..', '..'), write: !check });
  for (const problem of report.problems) console.error(`sync-tables: ${problem}`);
  if (check && report.stale.length > 0) {
    console.error(`sync-tables: the tutorial tables are out of date in ${report.stale.join(' and ')}. Run \`pnpm docs:tutorials\`.`);
    return 1;
  }
  if (!check) for (const file of report.stale) console.log(`sync-tables: updated ${file}`);
  return report.problems.length > 0 ? 1 : 0;
}

process.exitCode = main();
