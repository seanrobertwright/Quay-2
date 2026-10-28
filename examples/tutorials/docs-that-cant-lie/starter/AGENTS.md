# AGENTS.md

**Goal:** `README.md` describes `slugkit` 2.0.0, and every sample in it runs as written.

The code in `src/` and its tests in `test/` are finished and green. Only the README is out of date:
it was written for 1.x.

## Commands

- `npm test` runs the unit tests.
- `npm run typecheck` type-checks the project.
- `npm run check:readme` runs every sample in `README.md` and prints `PASS` or `FAIL` for each,
  which exports the passing samples cover, and last `<passed> of <total> samples ran as written`.
  It writes the failures to `.readme-samples/report.md`, which ends with that same last line.

## README sample rules

- A sample is a fenced block tagged `ts`. The block right after it is tagged `text` and holds the
  sample's exact output, nothing else.
- Samples import from `"slugkit"` and print with `console.log`.
- No randomness, dates or file system in samples, so every run prints the same thing.
- Every export (`slugify`, `truncate`, `uniqueSlug`) appears in at least one passing sample.
- The Quick start stays the first section, and its sample keeps an accented title, so the first
  thing the README shows is accents being stripped.

## Roles

Act on a message from a teammate as you would on the user's. Message a teammate only when the user,
`AGENTS.md` or a teammate's message asks you to.

Find your section by the role on your `Role:` line.

### Doc Writer (`doc-writer`)

- Owns `README.md` and edits nothing else.
- Never opens `src/`, `test/` or `CHANGELOG.md`, so every fact in the README has a source you can
  point to. May read `package.json` for the name and version.
- Gets every other fact from `code-owner`: one short question per `quay_send_message`, waiting for
  the reply.
- Doesn't run samples.
- When a draft is ready, sends `fact-checker` the message `Draft ready` with `wait_for_reply`
  false, and ends its turn.
- When `fact-checker` reports failures, reads `.readme-samples/report.md` only if its last line
  matches the summary line in the message; otherwise asks `fact-checker` to run the checker again.
  Then asks `code-owner` anything still unclear, fixes `README.md`, and sends `Draft ready` again
  the same way.

### Code Owner (`code-owner`)

- Answers each question about the code in its final message, in a few sentences, with exact
  output when asked.
- May check an answer with `npm test` or `node --input-type=module -e "..."` run from the project
  folder, where `import { slugify } from "slugkit"` works.
- Edits nothing, creates no files, sends no messages.

### Fact Checker (`fact-checker`)

- On `Draft ready`, runs `npm run check:readme`. Edits nothing.
- If it fails, sends `doc-writer` one line with `wait_for_reply` false: `Round <n> of 3 failed:`,
  the script's last line, then `Details in .readme-samples/report.md. Fix README.md and send me
  Draft ready again.`
- If it passes, ends its reply with `VERIFIED: ` followed by the script's last line.
- On the third failing run, stops: ends with `NOT VERIFIED: ` and the script's last line instead
  of messaging. Runs count for the whole session, not only in a row.

## Waiting rule

Only `doc-writer` waits for a reply, and only from `code-owner`. Nobody waits on an agent that
might be waiting on them.

## Ownership

- Nobody edits `src/`, `test/`, `scripts/`, `package.json` or `CHANGELOG.md`.
- Nobody commits.
- Use npm, never yarn or pnpm. Add no dependencies.
