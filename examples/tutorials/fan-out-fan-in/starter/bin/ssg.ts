// The ssg command. Finished: nobody edits this file.
import { run } from '../src/cli/run.ts';
import { buildPage } from '../src/site.ts';

process.exitCode = await run(process.argv.slice(2), buildPage);
