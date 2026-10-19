# Starter: examples/tutorials/tdd-swarm-kata/

```
starter/
  package.json        name tdd-swarm-kata, "type": "module", engines node >=24
                      scripts: test "vitest run", test:watch "vitest", typecheck "tsc --noEmit"
                      devDependencies: vitest, typescript (exact versions, no ^)
  package-lock.json
  tsconfig.json       strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext,
                      allowImportingTsExtensions, rewriteRelativeImportExtensions
  .gitignore          node_modules/
  README.md           the goal in two sentences; points at AGENTS.md
  AGENTS.md           see below
  CLAUDE.md           @AGENTS.md
  src/strength.ts     the API contract, unimplemented:
                        export type StrengthReport = { score: number; failed: string[] };
                        export function checkStrength(password: string): StrengthReport {
                          throw new Error("not implemented");
                        }
  test/strength.test.ts
                        import { describe, it } from "vitest";
                        describe("checkStrength", () => {
                          it.todo("rule 1: length");
                        });
```

No `check/` folder: the agents' own tests are the check.

## AGENTS.md (content)

- **Goal:** `checkStrength(password)` reports which of three rules a password fails.
- **Rules, in this order and with these names:**
  1. `length`: at least 12 characters.
  2. `classes`: at least three of: lowercase letter, uppercase letter, digit, symbol (anything else).
  3. `repeats`: no character appears three or more times in a row.
- **Report:** `score` is the number of rules passed (0 to 3); `failed` lists the names of the failed rules in the order above.
- **Commands:** `npm test`, `npm run test:watch`, `npm run typecheck`.
- **House rules:** npm only; no new dependencies; no `enum` or `namespace`; keep the exported signature in `src/strength.ts` unchanged.

## Starter CI state

Skeleton: `npm ci`, `npx tsc --noEmit` clean, `vitest run` green (1 todo).

## What the TDD Swarm role prompts must make true (input to the launch-prompt fix)

- **test-architect** edits only `test/`; never `src/`.
- **feature-impl** edits only `src/`; never `test/`.
- **reviewer** edits nothing; replies only.
- All three read `AGENTS.md` before their first change and wait for the user between tasks. None messages a teammate unless asked: this tutorial's loop is driven by the learner, and A2A 3 teaches the automated relay.

## Screenshot list

| File | Shows |
| --- | --- |
| 01-starter-installed.webp | PowerShell pane after npm install |
| 02-swarm-launched.webp | 2x2 grid, three role confirmations |
| 03-watcher-todo.webp | Vitest watch, 1 todo |
| 04-round-one-red.webp | All tests failing |
| 05-round-one-green.webp | All passing (+ 05-round-one-green.mp4, the clip: watcher re-runs and turns green) |
| 06-review-zoomed.webp | Reviewer zoomed, numbered list |
| 07-round-two-red.webp | Mixed pass/fail |
| 08-all-green.webp | All passing, more tests |
| 09-approved.webp | APPROVED |
| 10-check.webp | Final run, typecheck, git status |

Fixture recording: one whole run, four terminals (three Claude casts plus bridge logs, one PowerShell cast), markers 01 to 10.
