# Swarm 2: TDD Swarm kata

Build a password-strength checker the test-first way, with a team of four: an agent that writes the tests, an agent that makes them pass, a shell that re-runs them on every save, and an agent that reviews. You drive the loop, one pane at a time.

<!-- At a glance: Time and Tokens are generated from test runs. -->
Agents: 3 Claude agents + 1 PowerShell shell · Level: Starter

**You'll learn:** launching a four-pane preset, moving between panes, zooming one pane to read it, and running a red-green-review loop by hand. (A2A 3 automates this same loop.)

## Before you start

- [ ] Quay installed, and the shared "Before you start" page's checks done (Claude Code 2.1.296+, event-bridge plugin 0.1.0+, PowerShell 7, Node 24+, git).
- [ ] About 25 minutes.

---

:::: step 1. Get the starter project

::: do
1. Download `tdd-swarm-kata.zip` from this page and unzip it into a new, empty folder.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press <kbd>Ctrl+B N</kbd> and choose **PowerShell**.
:::

::: paste PowerShell pane
```text
git init; git add -A; git commit -m Starter; npm install
```
:::

::: see
![A single PowerShell pane in Quay. npm install has finished and the prompt is back; the rail shows the project.](./01-starter-installed.webp)
:::

::: must
- `git commit` prints `Starter` as the message
- `npm install` ends with `added` and a package count, no errors
:::

::: may
- The package count
:::

::: ifnot node or npm is not recognised
Node 24 or later isn't on your PATH. Install it from the shared Before-you-start page, then close and reopen Quay.
:::

::::

:::: step 2. Launch the TDD Swarm

::: do
1. Press <kbd>Ctrl+B S</kbd> to open the Swarm launcher.
2. Select **TDD Swarm** and click **Launch**.
3. Wait until each of the three Claude panes has printed one line and gone quiet.
:::

::: see
![A 2x2 grid. Top-left test-architect, top-right feature-impl, bottom-left test-runner (a PowerShell prompt), bottom-right reviewer. Each Claude pane ends with a one-line role confirmation.](./02-swarm-launched.webp)
:::

::: must
- Four panes, named `test-architect`, `feature-impl`, `test-runner` and `reviewer`
- Each Claude pane ends with one line confirming its role, then waits
- No pane has touched a file
:::

::: may
- The wording of each confirmation
- How long the panes take to start
:::

::: ifnot a Claude pane shows a one-line plugin hint
The event-bridge plugin is missing in Claude Code. Click **Copy** on the hint, paste the install line into that pane, then type `/reload-plugins`. The hint clears on its own.
:::

::: ifnot the panes open in the wrong layout
Press <kbd>Ctrl+B g</kbd> for the 2x2 grid.
:::

::::

:::: step 3. Start the test watcher

::: do
1. Click into the **test-runner** pane (or press <kbd>Ctrl+B o</kbd> until its border is highlighted).
:::

::: paste test-runner
```text
npm run test:watch
```
:::

::: see
![The test-runner pane shows Vitest in watch mode: 1 todo test, waiting for file changes.](./03-watcher-todo.webp)
:::

::: must
- `Tests  1 todo`
- A line saying Vitest is waiting for file changes
:::

::: may
- Timings
:::

::::

:::: step 4. Round 1, red: the Test Architect writes the first tests

::: paste test-architect
```text
Read AGENTS.md. In test/strength.test.ts, replace the todo with failing Vitest tests for rule 1 (length) only: an 11-character password must fail it and a 12-character password must pass it, checking both score and failed. Do not touch src/.
```
:::

::: see
![test-architect reports the tests it wrote. test-runner has re-run and shows every test failing with "not implemented".](./04-round-one-red.webp)
:::

::: must
- test-runner re-ran on its own
- Every test fails; none passes
- Only `test/strength.test.ts` changed
:::

::: may
- How many tests the architect wrote, and their names
- The failure text, as long as every test fails
:::

::: ifnot the architect asks whether it may edit the file
Reply `yes`. Normal permission mode asks before the first write.
:::

::::

:::: step 5. Round 1, green: the Implementer makes them pass

::: paste feature-impl
```text
Read AGENTS.md. Make every test in test/ pass with the simplest correct implementation of checkStrength in src/strength.ts, covering rule 1 only for now. Do not edit test/.
```
:::

::: see
![test-runner flips from red to green as feature-impl saves src/strength.ts: all tests pass, 0 failed.](./05-round-one-green.webp)
:::
<!-- Clip step: 05-round-one-green.mp4, the watcher pane re-running and turning green. Under ten seconds; terminal motion, so it needs timed replay. -->

::: must
- test-runner shows all tests passing, 0 failed
- Only `src/strength.ts` changed in this step
:::

::: may
- How the implementer wrote it
:::

::::

:::: step 6. Review round 1

::: do
1. Paste the prompt below, then press <kbd>Ctrl+B z</kbd> with the **reviewer** pane focused to zoom it while you read.
2. Press <kbd>Ctrl+B z</kbd> again to go back to the grid.
:::

::: paste reviewer
```text
Read AGENTS.md, src/strength.ts and test/strength.test.ts. Review them for correctness, missed edge cases and readability. Reply with a numbered list of findings, most important first. Do not edit any file.
```
:::

::: see
![The reviewer pane zoomed to fill the stage, showing a numbered list of findings.](./06-review-zoomed.webp)
:::

::: must
- A numbered list
- No file changed
:::

::: may
- The findings themselves
:::

::::

:::: step 7. Round 2, red: tests for the remaining rules

::: paste test-architect
```text
Read AGENTS.md again. Add failing tests for rule 2 (classes) and rule 3 (repeats), including the order of names in failed, and one test where a password passes all three rules. Keep the rule 1 tests as they are. Do not touch src/.
```
:::

::: see
![test-runner shows a mix: the rule 1 tests pass, the new tests fail.](./07-round-two-red.webp)
:::

::: must
- At least one test passes and at least one fails
- Only `test/strength.test.ts` changed
:::

::: may
- The counts and names
:::

::::

:::: step 8. Round 2, green

::: paste feature-impl
```text
Read AGENTS.md. Make every test in test/ pass, implementing all three rules in src/strength.ts, then tidy the code without changing behaviour. Do not edit test/.
```
:::

::: see
![test-runner all green again, with more tests than in step 5.](./08-all-green.webp)
:::

::: must
- All tests pass, 0 failed
- Only `src/strength.ts` changed
:::

::: may
- The test count
:::

::::

:::: step 9. Sign-off

::: paste reviewer
```text
Re-read AGENTS.md, src/strength.ts and test/strength.test.ts. If all three rules are implemented and tested, reply with exactly APPROVED as your last line. Otherwise reply CHANGES REQUESTED followed by a numbered list of what's missing. Do not edit any file.
```
:::

::: see
![The reviewer pane ends with the line APPROVED.](./09-approved.webp)
:::

::: must
- The last line is `APPROVED`
:::

::: may
- Anything the reviewer says before it
:::

::: ifnot the reviewer says CHANGES REQUESTED
Copy its numbered list, paste it into **feature-impl** with "Address these and keep every test green. Do not edit test/.", wait for green in test-runner, then repeat this step.
:::

::::

:::: step 10. Check it worked

::: do
1. Click into **test-runner** and press <kbd>q</kbd> to stop the watcher.
:::

::: paste test-runner
```text
npm test; npm run typecheck; git status --short
```
:::

::: see
![test-runner shows the test run passing, a clean type check, and git status listing only src/strength.ts and test/strength.test.ts.](./10-check.webp)
:::

::: must
- `npm test` passes with 0 failed
- `npm run typecheck` prints nothing
- `git status --short` lists exactly `src/strength.ts` and `test/strength.test.ts`, both modified
:::

::: may
- The number of tests
:::

::: done
- Every test passes and the type check is clean
- The reviewer's last reply ends with `APPROVED`
- `git status --short` shows only `src/strength.ts` and `test/strength.test.ts`
:::

::::

**Next up:** Swarm 3, Full-Stack Pair: bookmarks app.
