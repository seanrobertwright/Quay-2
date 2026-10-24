# Starters CI

The `Starters` workflow (`.github/workflows/starters.yml`) checks that every tutorial's starter
project installs, type-checks and has its tests in the state its tutorial expects. It runs on
`windows-latest` for changes under `examples/**` and to its own files.

## Layout

Each tutorial has a folder under `examples/tutorials/`:

```text
examples/tutorials/<slug>/
  starter/              the starter project the learner downloads
  check/                the check suite, when the tutorial has one
  expected-state.json   what the checker expects of the starter
```

Every folder under `examples/tutorials/` must hold both `starter/` and `expected-state.json`; one
missing either fails the run. When `examples/tutorials/` does not exist, the run passes with no
starters.

## What the checker does

Before running anything, it reads every tutorial folder and fails the run if any of them has:

- an expected state that is not valid JSON, has a field it doesn't know, a red outcome with no
  count, or any other malformed value (the message names the starter and the field);
- a dependency in `starter/package.json` on a range (`^`, `~`, `*`, `x`, a tag or anything but
  one exact version);
- a `check/` folder with no `checkSuite`, or a `checkSuite` with no `check/` folder;
- a `patch.file` missing from the starter, or a named script missing from its `package.json`.

A starter's pinned versions move only at a tutorial sweep, which `scripts/test-runs/README.md`
describes.

Then, for each starter, in a throwaway copy of `starter/` (without `node_modules`):

1. checks `files`, as the learner receives them;
2. runs `npm ci`, which must pass (when it doesn't, the starter's remaining steps are skipped);
3. runs `npx --no -- tsc --noEmit --pretty` and compares it with `typecheck`;
4. runs `npm test` and compares it with `tests`;
5. runs each of `scripts`, in order, with `npm run <name>`;
6. copies `check/` into the copy beside `src/`, as the learner unzips it, and runs the check suite;
7. takes `check/` back out, applies `patch.file` with `git apply` and runs `npm test` again.

Every command gets the starter's `env` on top of the runner's environment. Test runs must be
Vitest: the checker adds `--reporter=default --reporter=json --outputFile=<file>` and reads the
counts from the JSON report.

## Running it locally

```sh
pnpm starters:test        # the checker's own tests
pnpm starters:typecheck   # type-check the checker
pnpm starters:check       # check every starter under examples/tutorials
node scripts/starters-ci/check-starters.ts --tutorials <dir>   # check another folder
```

It needs Node 24 or later, which runs the checker's TypeScript without a build step.

## Writing a TypeScript starter

A learner runs a starter's TypeScript with `node` as it is, for example `node src/cli.ts` in
Swarm 1, with no build step. For that to work, and type-check, under the starter's own
`package.json` and `tsconfig.json`:

- `package.json` has `"type": "module"`. Without it Node warns that the module type isn't
  specified and parses the file twice, and `tsc` treats the files as CommonJS.
- Imports name the `.ts` file, as `import { calculateTip } from "./tip.ts"`, since Node doesn't
  guess extensions, and `tsconfig.json` sets `allowImportingTsExtensions`, which needs `noEmit`.
  Without it `tsc` rejects every such import.
- `tsconfig.json` sets `erasableSyntaxOnly`, so `tsc` rejects the syntax Node can't strip:
  `enum`, `namespace` and parameter properties. The starter's `AGENTS.md` says so too.

`examples/tutorials/first-swarm/starter/` is the pattern: `module` `nodenext`, `strict`,
`noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions` and
`types: ["node"]`.

A starter whose page has the learner read test names runs Vitest with `--reporter=verbose` in
its `test` script. Vitest's default reporter lists only failing tests, so a passing run shows no
names. The checker adds its own reporters after the script's, which still works.

## The expected-state format

Only `typecheck` and `tests` are required.

| Field | Shape | Meaning |
| --- | --- | --- |
| `typecheck` | `{ "expect": "pass" }` | `tsc --noEmit` exits 0. |
| | `{ "expect": "fail", "lineStartsWith": "<text>" }` | `tsc` exits non-zero and a line of its output, colours stripped, starts with the text. |
| `tests` | `{ "expect": "pass", "passed"?: n, "todo"?: n }` | `npm test` exits 0 with no failing test, and the counts given match. Todo tests count as green. |
| | `{ "expect": "fail", "failed": n, "total"?: n }` | Exactly `failed` tests fail, out of `total` when given. |
| `checkSuite` | `{ "script": "<name>", ...outcome }` | Run with `npm run <name>`, then compared like `tests`. |
| | `{ "vitest": ["<arg>", ...], ...outcome }` | Run with `npx --no -- vitest <args>`, then compared like `tests`. |
| `scripts` | `[{ "name", "expect", "exitCode"?, "outputIncludes"?, "producesFiles"? }]` | Each script exits 0 (`pass`), or non-zero, or exactly `exitCode` (`fail`); its output holds every `outputIncludes` string; it leaves every `producesFiles` path. |
| `env` | `{ "NAME": "value" }` | Environment variables for every command run for this starter. |
| `files` | `{ "present"?: [path], "absent"?: [path], "linesAbsent"?: { path: [line] } }` | Paths in the starter that must exist or not, and lines a file must not hold. |
| `patch` | `{ "file": "<path>", "failingTests": ["<name>", ...] }` | Needs `tests.expect` `"pass"`: the starter ships green. After `git apply`, exactly the named tests fail. A name matches a test's title or its full name. |

Paths are relative to `starter/`, use `/`, and never contain `..`. Script names keep to letters,
digits and `:._-`, and Vitest arguments may also hold `/`, `=` and leading dashes, since both
reach a shell. A starter whose
patch must apply on Windows carries a `.gitattributes` with `* text=auto eol=lf`.

## Every shape the tutorials need

Tests green, with Swarm 2's one todo counting as green:

```json
{ "typecheck": { "expect": "pass" }, "tests": { "expect": "pass", "todo": 1 } }
```

Tests red with a count: Swarm 3, 7 of 8 failing (Swarm 1, Swarm 4, Swarm 10, A2A 4, A2A 5 and
A2A 8 take the same shape with their own counts):

```json
{ "typecheck": { "expect": "pass" }, "tests": { "expect": "fail", "failed": 7, "total": 8 } }
```

Type check red with an exact line plus a test count: Swarm 7.

```json
{
  "typecheck": { "expect": "fail", "lineStartsWith": "Found 24 errors" },
  "tests": { "expect": "pass", "passed": 12 }
}
```

A check suite failing against the starter: Swarm 5, 4 of 6 (Swarm 9, A2A 3 and A2A 10 take the
same shape):

```json
{
  "typecheck": { "expect": "pass" },
  "tests": { "expect": "pass", "passed": 7 },
  "checkSuite": { "vitest": ["run", "check"], "expect": "fail", "failed": 4, "total": 6 }
}
```

Named scripts expected to fail while `npm test` and the type check stay green: A2A 9.

```json
{
  "typecheck": { "expect": "pass" },
  "tests": { "expect": "pass" },
  "scripts": [
    {
      "name": "check:readme",
      "expect": "fail",
      "exitCode": 1,
      "outputIncludes": ["FAIL sample 1", "0 of 1 samples ran as written"],
      "producesFiles": [".readme-samples/report.md"]
    }
  ]
}
```

A per-starter environment: A2A 6 runs its bench with `BENCH_TIME_MS=500`.

```json
{
  "env": { "BENCH_TIME_MS": "500" },
  "typecheck": { "expect": "pass" },
  "tests": { "expect": "pass", "passed": 6 },
  "scripts": [{ "name": "bench", "expect": "pass" }]
}
```

Ships green, plus a patch that must break exactly the named tests: A2A 7.

```json
{
  "typecheck": { "expect": "pass" },
  "tests": { "expect": "pass" },
  "patch": { "file": "patches/late-change.patch", "failingTests": ["pads cents under ten with a zero"] }
}
```

Swarm 6: its red check run and its `.env.example`.

```json
{
  "typecheck": { "expect": "pass" },
  "tests": { "expect": "pass", "passed": 8 },
  "checkSuite": { "script": "check", "expect": "fail", "failed": 6, "total": 6 },
  "files": { "present": [".env.example"], "absent": [".env"], "linesAbsent": { ".gitignore": [".env"] } }
}
```

`scripts/starters-ci/starters.test.ts` runs each of these against test starters it writes to a
temp folder, with a stand-in for the processes the checker starts.
