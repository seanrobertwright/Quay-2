# AGENTS.md

**Goal:** ship `pricetag` v1.3.0. The release-captain agent cuts the release; its teammates
follow the Release protocol below while it does.

## Commands

- `npm test` runs the price tests and the release tests, which check `package.json` against
  `CHANGELOG.md`.
- `npm run typecheck` checks the types.
- `node src/cli.ts --version` prints the version in `package.json`.

## Who owns what

- `release-captain` owns `package.json`, `package-lock.json`, `CHANGELOG.md`, the release commit
  and the tag.
- `feature-dev` owns `src/` and `test/`.
- `docs-writer` owns `README.md`.

Never edit a file you don't own.

## Release protocol

Broadcasts arrive in your terminal as one line that starts `[Broadcast Notice]:`. Nobody is
waiting for your answer: write it for the person watching your pane.

- `FREEZE v<version>`: stop editing files now. End your answer with the line `FROZEN`. Until a
  `RELEASE PASS` notice arrives, refuse every request to edit a file and answer `FROZEN`.
- `RELEASE FAIL CRITICAL v<version>: <test>`: nothing was released and the freeze stays on. If
  the failing test covers files you own, find the cause without editing anything (`git log`,
  `git show`) and answer with one line that starts `CAUSE:` and names the commit and the file.
  Otherwise end your answer with the line `STILL FROZEN`.
- `RELEASE PASS v<version>`: the freeze is lifted. End your answer with the line `THAWED`.

### Release Captain steps

Follow them in order. Send every broadcast with `quay_broadcast` as a single line, because Quay
flattens newlines.

1. Broadcast `FREEZE v<version>: release in progress. Do not edit files until RELEASE PASS.`
2. Run `npm version <version> --no-git-tag-version`. Then, in `CHANGELOG.md`, move the entries
   under `## [Unreleased]` into a new `## [<version>] - <today>` section, with today's date as
   `YYYY-MM-DD`, and leave an empty `## [Unreleased]` above it.
3. Run `npm test`.
4. If every test passed: run
   `git commit package.json package-lock.json CHANGELOG.md -m "Release v<version>"` (name the
   files; never `git commit -a`), then `git tag v<version>`, then broadcast
   `RELEASE PASS v<version>: all tests passed, tagged v<version>. Freeze lifted.`
5. If any test failed: run `git restore package.json package-lock.json CHANGELOG.md`, then
   broadcast `RELEASE FAIL CRITICAL v<version>: <name of the first failing test>. Nothing released. Freeze stays on.`
6. Never fix a failing test or edit `src/` or `test/` yourself.

## House rules

- Use npm, never yarn or pnpm. Add no dependencies.
- Write TypeScript that Node can run as it is: no `enum`, no `namespace`, no parameter
  properties.
