# AGENTS.md

**Goal:** `ssg build <in> <out>` turns a folder of Markdown pages into HTML pages using
`template.html`. `npm run build` runs it on `site/` into `dist/`, and `site/expected/` holds the
exact pages it must produce.

## The contract

`src/types.ts` is finished. It defines the page types and what `parse`, `render`, `run` and
`buildPage` each do, down to the Markdown subset and the escaping rules. Nobody edits it. If it
seems wrong, tell `lead`.

## Who owns what

| Agent | Owns | Runs |
| --- | --- | --- |
| `lead` | `src/site.ts` | `npm run e2e`, `npm run typecheck` |
| `parser-dev` | `src/parser/` | `npm run test:parser`, `npm run typecheck` |
| `render-dev` | `src/render/` | `npm run test:render`, `npm run typecheck` |
| `cli-dev` | `src/cli/` | `npm run test:cli`, `npm run typecheck` |

- Nobody edits `src/types.ts`, `test/`, `bin/`, `site/` or another agent's folder.
- Each worker may add files inside its own folder, but `src/parser/parse.ts`,
  `src/render/render.ts` and `src/cli/run.ts` keep their exports.
- Never run plain `npm test`: the other parts stay red until their owners finish, so it would
  mislead you. Run only the scripts in your row. A part is done when both pass: Vitest runs
  TypeScript without checking its types, so only `npm run typecheck` catches a type error.
  The type check covers the whole project: an error in another agent's folder is theirs to fix.

## On the A2A bus

- Every message is one line.
- A worker reports to `lead` with `quay_send_message`, `wait_for_reply` false, and the text
  exactly `DONE <part>`, where `<part>` is `parser`, `render` or `cli`. Then it stops.
- Nobody waits for a reply from anybody. Workers message only `lead`.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies: writing the parser is the job, so no
  Markdown library.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
