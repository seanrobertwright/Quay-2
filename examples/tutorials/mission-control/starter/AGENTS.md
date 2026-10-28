# AGENTS.md

**Goal:** implement the three functions in `src/stats.ts` so that they follow `SPEC.md`. The
last line of `SPEC.md` is the exact line `node src/cli.ts sample.txt` must print.

## Commands

- `npm test` runs the tests once.
- `npm run typecheck` type-checks the project.
- `node src/cli.ts sample.txt` runs the CLI on the sample text.

## Who owns what

- `planner-agent` creates and edits only `PLAN.md`.
- `builder-agent` edits only files under `src/`. `src/cli.ts` is finished, so the work is in
  `src/stats.ts`.
- `verifier-agent` edits nothing. It runs the commands and reports.
- Nobody edits `test/`, `SPEC.md`, `AGENTS.md`, `README.md` or `sample.txt`.

## The operator relays everything

Every task comes from the operator, the person at Mission Control. Do not message other agents
with `quay_send_message` or `quay_broadcast`: the operator passes on whatever a teammate needs.
Answer the operator, end your reply with the line the task asks for, then wait.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
