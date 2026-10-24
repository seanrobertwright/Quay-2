# AGENTS.md

**Goal:** `receipt` prints a receipt for a shopping-list file. Convert it from JavaScript to
TypeScript with no change in behaviour. It is done when `npm run typecheck` reports no errors,
`npm test` passes, no `.js` file is left under `src/`, and
`node src/cli/main.ts samples/groceries.txt` prints the receipt.

## Commands

- `npm test` runs the tests once.
- `npm run typecheck` type-checks `src/` once.
- `node src/cli/main.js samples/groceries.txt` runs the command; it is `main.ts` once renamed.

## Who owns what

- `parse-agent` edits only `src/parse/`.
- `format-agent` edits only `src/format/`.
- `cli-agent` edits only `src/cli/`.
- Nobody edits `test/`, `tsconfig.json`, `package.json`, `package-lock.json` or `samples/`.

## The seam between folders

`src/cli/` imports the other two folders through their barrels, `src/parse/index` and
`src/format/index`. Each agent owns the import lines in its own folder, and never fixes an
import in a teammate's folder.

Every import inside `src/` names the file as it is now: once a file is renamed to `.ts`, every
import of it says `.ts`. Watch out: `tsc` and Vitest both still find a renamed file by its old
`.js` name, so neither reports a stale import. Node doesn't, so
`node src/cli/main.ts samples/groceries.txt` fails until every import is right. To see whether a
teammate has renamed a file yet, look in their folder.

## Migration rules

- Rename each file with `git mv`, from `.js` to `.ts`.
- Keep every exported name and what it does: the tests in `test/` are frozen.
- Add real types. No `any`, no `@ts-ignore`, no `@ts-expect-error`.
- Never loosen `tsconfig.json`.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.

## House rules

- A watcher pane is already running `tsc` in watch mode for the human. Run `npm run typecheck`
  once when you think you're done; never start your own watch.
- When your folder is done, end your turn with one last line: `DONE src/<your folder>/`.
- Use npm, never yarn or pnpm. Add no dependencies.
