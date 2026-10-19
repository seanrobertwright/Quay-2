# Outline: Swarm 10, Parallel experiments with worktrees

Prototype outline for the ticket "Tutorial outline: Swarm 10, Parallel experiments with worktrees".
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `parallel-worktrees`. Page `docs/tutorials/swarm/parallel-worktrees/index.md`. Starter `examples/tutorials/parallel-worktrees/starter/`.

## What Quay can do today, checked in the code

The charting idea was: two worktrees, an agent in each trying a different approach, compare them in the Diff Inspector, keep the winner. Read against the code, three things shape the draft.

- **A Swarm can't span worktrees.** `launchSwarm` spawns every agent with the active project's folder. If a worktree is the active project, the whole swarm lands in that worktree. So this draft launches Dev & Watcher once per worktree. "Per-agent worktrees for Swarm" stays in fog unless the maintainer promotes it (open question 1).
- **The stage shows one folder at a time.** The stage filters terminals to the active project's exact folder, and each worktree counts as its own folder. The two experiments can't be on screen side by side. You flip between them by clicking a worktree in the rail. The rail lists every terminal under its worktree, with its status badge, so you can see the other experiment's status without flipping.
- **The Diff Inspector is an edit log, not a branch diff.** `Ctrl+B D` opens the "Visual Diff & File Changes" drawer. It lists each Edit and Write tool call that the `event-bridge` plugin reports, newest first, with a terminal dropdown, a "Filter files..." box and a Unified/Split toggle. It cannot compare two branches. So the draft uses it to read what each agent wrote, and a starter script in a Quay pane does the measured comparison (open question 2).

Also found along the way, each raised below: `Ctrl+B W` targets the active folder, so pressing it with a worktree selected nests the new worktree inside that one; removing a worktree with uncommitted changes fails with no message in Quay; worktrees go in `.worktrees/<branch>` inside the project, which the git-worktrees feature page gets wrong.

## The page, top to bottom

**Title:** Swarm 10: Parallel experiments with worktrees

**Pitch:** Not sure which design is better? Try both at once. You give each idea its own git worktree and its own Dev & Watcher swarm, let the two agents build in parallel without touching each other's files, measure the results, merge the winner and throw the loser away.

**Tiles:** Time and Tokens are generated from test runs. Agents: 2 x Claude + 3 shells. Level: Advanced.

**You'll learn:** creating worktrees from Quay (`Ctrl+B W`), launching a swarm into a worktree, flipping between experiments in the rail, reading each agent's edits in the Diff Inspector (`Ctrl+B D`), and merging one branch while removing the others.

**Before you start** (the shared Before-you-start page, linked, plus two lines):

- Quay 2 installed; Claude Code 2.1.296 or later, signed in; `event-bridge` 0.1.0 or later; PowerShell 7; Node 24 or later, npm and Git, with Git's `user.name` and `user.email` set.
- You've done Swarm 1, so Dev & Watcher, `Ctrl+B O` and the watcher are familiar.
- You know what a git branch and a merge are. This tutorial explains worktrees, not git.

## The starter project

A contacts de-duplicator with its tests written and red, and a compare script that measures any branch's attempt.

```text
starter/
  package.json          name parallel-worktrees, "type": "module", engines node >=24
                        scripts: test "vitest", test:once "vitest run", typecheck "tsc --noEmit",
                                 compare "node scripts/compare.ts"
                        devDependencies pinned: vitest, typescript, @types/node
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module nodenext, exclude [".worktrees"]
  vitest.config.ts      test.exclude adds ".worktrees/**"
  .gitignore            node_modules/, .worktrees/
  README.md             the goal, and the team's bar: 50,000 contacts in under 500 ms
  AGENTS.md             see below
  CLAUDE.md             @AGENTS.md
  src/dedupe.ts         export type Contact = { id: string; name: string; email: string; phone: string };
                        export function findDuplicates(contacts: Contact[]): string[][] {
                          throw new Error("not implemented");
                        }
  test/dedupe.test.ts   six Vitest tests, all red against the stub
  scripts/contacts.ts   seeded generator: 50,000 contacts holding exactly 2,500 duplicate groups
  scripts/bench.ts      imports <folder>/src/dedupe.ts, times findDuplicates on the 50,000, prints ms and group count
  scripts/compare.ts    one row per argument (see below)
```

**The rule.** Two contacts are the same person when their emails match after trimming and lower-casing, or their phones match after keeping only digits. It is transitive. An empty email or phone never matches. `findDuplicates` returns groups of two or more ids, ids in input order, groups ordered by their first member.

**The six tests.**

1. An empty list gives no groups.
2. A list with no duplicates gives no groups.
3. `Ada@Example.com ` and `ada@example.com` are one group.
4. `(555) 010-2000` and `555.010.2000` are one group.
5. A matches B by email and B matches C by phone: one group of three.
6. Two contacts with empty email and empty phone are not a group.

**`npm run compare -- <branch> ...`.** For each argument it uses `.worktrees/<branch>`, or the project folder for `main`. It runs `vitest run` there, runs `scripts/bench.ts` against that folder in a child process with a 5-second cut-off, and counts `git diff --shortstat main -- src` in that folder. It prints one row per branch:

```text
branch      tests  50k contacts  groups  under 500 ms  src lines
try-scan    6/6    over 5 s      -       FAIL          +24 -1
try-index   6/6    41 ms         2500    PASS          +58 -1
```

**`AGENTS.md`**, in short:

- Goal: `findDuplicates` in `src/dedupe.ts`, to the rule above.
- Commands: `npm test` (watch), `npm run test:once`, `npm run typecheck`.
- House rules: npm only, no new dependencies, no `enum` or `namespace`, keep the exported signature.
- Edit only `src/dedupe.ts`. Never edit `test/` or `scripts/`.
- A watcher pane runs the tests; don't run them yourself.
- Speed is measured separately; don't write benchmarks. (The 500 ms bar is in `README.md`, not here, so the `try-scan` agent isn't tempted to overrule its brief.)
- Stay inside the folder you were started in.

**Starters CI expected state:** `npm ci` and `npx tsc --noEmit` clean, `vitest run` red (6 of 6 failing), using the per-starter expected-state marker from the Swarm 3 outline. No check suite: the compare script is the check, and it ships in the starter.

**Two experiments, rigged on purpose.** `try-scan` is told to compare every pair (short and plain, but about 1.25 billion comparisons at 50,000). `try-index` is told to index by email and phone and join with a union-find (one pass). Both pass the six tests. Only one passes the bar. The page says so plainly: in real work you won't know the winner ahead of time (open question 7).

## Steps

### 1. Get the starter project

**Do**

1. Download `parallel-worktrees.zip` from this page and unzip it into a new, empty folder, for example `C:\tutorials\parallel-worktrees`.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell**, name it `main-shell` and click **Launch**.

**Paste into `main-shell`**

```text
git init -b main; git add -A; git commit -m Starter; npm install
```

**You should see:** `01-starter-installed.webp`. One PowerShell pane named `main-shell`; `npm install` has finished and the prompt is back. The rail shows the project.

**Must match**

- `git commit` prints `Starter` as the message, on branch `main`.
- `npm install` ends with `added` and a package count, no errors.

**May differ**

- The package count and timings.

### 2. Make two worktrees

One sentence on worktrees: a worktree is a second folder checked out on its own branch, sharing the same repository, so two agents can edit "the same" file without touching each other.

**Do**

1. Make sure the project itself, not a worktree, is selected in the rail.
2. Press `Ctrl+B W`. The **New Git Worktree** dialog opens.
3. Type `try-scan` as the **Branch Name**. Leave **Create as new branch** ticked, from `main`.
4. Untick **Launch Claude Code terminal immediately**. You'll launch a whole swarm there instead.
5. Click **Create Worktree**.
6. Repeat steps 2 to 5 with `try-index`.
7. In the rail, expand **Worktrees (2)** under the project.

**Paste into `main-shell`**

```text
git worktree list
```

**You should see:** `02-worktrees-created.webp`. The rail with `Worktrees (2)` expanded, showing `try-scan` and `try-index`; `main-shell` listing three worktrees.

**Must match**

- Three lines: the project folder `[main]`, `.worktrees/try-scan [try-scan]`, `.worktrees/try-index [try-index]`.

**May differ**

- The commit hashes.

**If not: "Git worktree add failed: invalid reference: main".** Your repository's first branch is called `master`. Paste `git branch -m main` into `main-shell` and create the worktrees again.

**If not: the second worktree's folder is inside the first.** A worktree was selected when you pressed `Ctrl+B W`. Remove it from the rail, select the project and create it again.

### 3. Launch the first experiment

**Do**

1. Click `try-scan` under **Worktrees** in the rail. The stage empties: this worktree has no terminals yet.
2. Press `Ctrl+B S`. Check the launcher says **Target: try-scan**. **Dev & Watcher** is selected. Click **Launch Swarm Now**.
3. Press `Ctrl+B O` to move focus to `build-watcher`.

**Paste into `build-watcher`**

```text
npm ci; npm test
```

**You should see:** `03-scan-red.webp`. `lead-dev` on the left confirming its role; `build-watcher` on the right in Vitest watch mode, red. The rail shows both terminals under `try-scan`.

**Must match**

- `lead-dev`'s first line reads `Role: Lead Developer`.
- `build-watcher` shows `Tests  6 failed` and the "Waiting for file changes" line.
- Both terminals are listed under `try-scan` in the rail, not under the project.

**May differ**

- The wording of `lead-dev`'s acknowledgement; install timings.

**If not: the launcher says Target: parallel-worktrees.** You launched into the main folder. Close both terminals from the rail, click `try-scan` and launch again.

### 4. Brief the first experiment

**Do**

1. Press `Ctrl+B O` to move focus back to `lead-dev`.

**Paste into `lead-dev`**

```text
Implement findDuplicates in src/dedupe.ts so every test in test/dedupe.test.ts passes. Use the simplest approach you can: compare every pair of contacts and merge the groups they belong to. Keep it short and plain. Edit only src/dedupe.ts. Don't run the tests yourself: the build-watcher pane is running them, and I'm watching it. Tell me when you believe they all pass.
```

**You should see:** `04-scan-working.webp`. `lead-dev` working on `src/dedupe.ts`; its badge says Working.

**Must match**

- The badge on `lead-dev` says Working.

**May differ**

- How far it has got.

Don't wait for it. The next step starts the second experiment while this one works.

### 5. Launch the second experiment

**Do**

1. Click `try-index` under **Worktrees** in the rail. The stage empties again. `try-scan` keeps working behind it: its `lead-dev` row in the rail still shows Working.
2. Press `Ctrl+B S`. Check the launcher says **Target: try-index**. Click **Launch Swarm Now**.
3. Press `Ctrl+B O` to move focus to `build-watcher`.

**Paste into `build-watcher`**

```text
npm ci; npm test
```

**You should see:** `05-index-red.webp`. A second Dev & Watcher pair, this one under `try-index`, watcher red. In the rail, `try-scan`'s `lead-dev` is still Working.

**Must match**

- `build-watcher` shows `Tests  6 failed`.
- The rail lists two terminals under each worktree.

**May differ**

- Whether `try-scan`'s `lead-dev` has already gone Idle.

### 6. Brief the second experiment

**Do**

1. Press `Ctrl+B O` to move focus back to `lead-dev`.

**Paste into `lead-dev`**

```text
Implement findDuplicates in src/dedupe.ts so every test in test/dedupe.test.ts passes. Build it for speed: index the contacts by normalized email and by normalized phone in Maps, and join matching contacts with a union-find, so the work is one pass over the list. Edit only src/dedupe.ts. Don't run the tests yourself: the build-watcher pane is running them, and I'm watching it. Tell me when you believe they all pass.
```

**You should see:** `06-index-working.webp`. This `lead-dev` working; both `lead-dev` rows in the rail say Working.

**Must match**

- Two Working badges in the rail, one under each worktree.

**May differ**

- How far each agent has got.

### 7. Flip between the experiments

**Do**

1. Click `try-scan` in the rail, then `try-index`. The whole split flips between the two experiments.
2. Keep flipping now and then until both watchers are green and both agents say they're done.

**You should see:** `07-flip-experiments.webp`, with `07-flip-experiments.mp4` as the clip: clicking `try-scan` in the rail swaps the stage from `try-index`'s pair to `try-scan`'s pair, both watchers green.

**Must match**

- `Tests  6 passed` in both `build-watcher` panes.
- Both `lead-dev` badges say Idle.

**May differ**

- Which experiment finishes first, and how long they take (expect 3 to 10 minutes).
- The agents' wording.

**If not: a `lead-dev` edits the test file.** Paste into that `lead-dev`: "Undo your changes under test/ with git checkout -- test, then make the tests pass by editing src/dedupe.ts only."

**If not: a `lead-dev` runs the tests itself.** It still works. Tell it: "Thanks. From now on leave test runs to the watcher."

### 8. Read each experiment's edits

**Do**

1. Press `Ctrl+B D`. The **Visual Diff & File Changes** drawer opens with every edit both agents made.
2. Type `try-scan` in **Filter files...**. Click the top entry and read it. Switch between **Unified** and **Split**.
3. Change the filter to `try-index` and read that one.
4. Press `Esc` to close the drawer.

Teaching line: this drawer is a log of each edit as an agent made it, not a diff between branches. Both agents are called `lead-dev`, so filter by the worktree's folder name, which is part of every path.

**You should see:** `08-diff-inspector.webp`. The drawer filtered to `try-index`: `dedupe.ts` entries from `lead-dev`, the newest one open.

**Must match**

- Every entry under each filter is `dedupe.ts`.
- The terminal shown on each entry is `lead-dev`.

**May differ**

- How many entries there are, whether they're Edit or Write, and their `+` and `-` counts.

**If not: "No file modifications recorded yet".** The `event-bridge` plugin isn't reporting. See Before you start.

### 9. Measure both

**Do**

1. Click the project name in the rail. The stage shows `main-shell`.

**Paste into `main-shell`**

```text
npm run compare -- try-scan try-index
```

**You should see:** `09-compare.webp` (pane crop). The compare table: both experiments pass the tests, only `try-index` is under the bar.

**Must match**

- Both rows show `6/6`.
- `try-scan` shows `FAIL` under `under 500 ms`.
- `try-index` shows `2500` groups and `PASS`.

**May differ**

- The times, and whether `try-scan` shows a time or `over 5 s`.
- The line counts.

Teaching line: same team, same tests, two designs. The shorter one is too slow for the bar.

### 10. Keep the winner

**Paste into `main-shell`**

```text
git -C .worktrees/try-scan commit -am "Try a pairwise scan"; git -C .worktrees/try-index commit -am "Find duplicates by index"; git merge try-index
```

Teaching line: committing the loser keeps it on record until you delete its branch, and leaves both worktrees clean so Quay can remove them.

**You should see:** `10-merged.webp`. Two commit summaries, then the merge.

**Must match**

- The merge says `Fast-forward`.
- One file changed: `src/dedupe.ts`.

**May differ**

- The commit hashes and line counts.

### 11. Clean up and check it worked

**Do**

1. In the rail, hover `try-scan`, click its trash icon and confirm. Its two terminals close and the row goes.
2. Do the same for `try-index`.

**Paste into `main-shell`**

```text
git branch -D try-scan; git branch -d try-index; git worktree list; npm run compare -- main
```

**You should see:** `11-cleaned-up.webp` (pane crop). Two `Deleted branch` lines, one worktree line, and a compare row for `main`.

**Must match**

- `git worktree list` prints one line, ending `[main]`.
- The `main` row shows `6/6`, `2500` and `PASS`.

**May differ**

- The time on the `main` row.

**If not: a worktree row stays after you confirm.** It still had uncommitted changes. Paste its half of step 10's line into `main-shell`, then use the trash icon again.

**You're done when**

- The compare row for `main` reads `PASS`.
- `git worktree list` shows only the project folder.
- `git log --oneline` shows `Find duplicates by index` on top of `Starter`.
- The rail shows no worktrees under the project.

**Next up:** A2A 1: Hello, A2A.

## Screenshot list

Full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | `main-shell` after `npm install`; project in the rail | `Starter` commit, `added` line |
| `02-worktrees-created.webp` | Rail with `Worktrees (2)` expanded; `git worktree list` | three worktree lines |
| `03-scan-red.webp` | `try-scan`'s pair; watcher red | `Role: Lead Developer`, `Tests  6 failed` |
| `04-scan-working.webp` | `try-scan`'s `lead-dev` mid-work | Working badge |
| `05-index-red.webp` | `try-index`'s pair; watcher red; rail with four terminals | `Tests  6 failed`, two terminals per worktree |
| `06-index-working.webp` | `try-index`'s `lead-dev` mid-work | two Working badges in the rail |
| `07-flip-experiments.webp` | `try-scan`'s pair, both green; the clip's poster | `Tests  6 passed`, Idle badges |
| `08-diff-inspector.webp` | Drawer filtered to `try-index` | `dedupe.ts`, `lead-dev` |
| `09-compare.webp` | `main-shell` compare table (pane crop) | `FAIL` and `PASS` rows |
| `10-merged.webp` | Commits and `Fast-forward` (pane crop) | `Fast-forward`, `src/dedupe.ts` |
| `11-cleaned-up.webp` | Branches deleted, one worktree, `main` row (pane crop) | `[main]`, `PASS` |

**Clip:** step 7, `07-flip-experiments.mp4`. One rail click swaps the stage between the two experiments: Quay's own motion, well under ten seconds, with no streaming terminal output. Caption: "Clicking try-scan in the rail swaps the stage from try-index's two panes to try-scan's two panes. Both watchers show 6 passed."

**Fixture:** one whole run with five terminals (two Claude casts with their bridge traffic, three PowerShell casts), markers 01 to 11. The Diff Inspector fills from replayed bridge tool events; to confirm when capturing that the replay carries the tool input the drawer reads. The fixture's project path must hold the `.worktrees` folders the run created.

## Code this tutorial depends on

- Already fix-first: the launch prompt (so `lead-dev` opens with `Role: Lead Developer`), terminal creation order (so `lead-dev` is on the left), swallowing the `Ctrl+B` prefix, the plugin hint.
- Today's features it uses as they are: the New Git Worktree dialog, worktree rows in the rail with their trash icon, launching a swarm into the active folder, the Diff Inspector's file filter.
- New gaps, raised as open questions 4 and 5 rather than worked around silently.

## Open questions, in order

1. **No per-agent worktrees, and one folder on stage at a time.** Today a swarm lands in one folder, and the stage shows only the active folder's terminals. This draft launches Dev & Watcher once per worktree and teaches flipping in the rail. The alternative is to promote "Per-agent worktrees for Swarm" to the fix-first list: a launcher option that gives each agent its own new worktree, plus a stage that can show terminals from more than one folder. Proposed: write it on today's features. The map's trigger for that fog entry was agents editing the same files, and worktrees remove that by design here.
2. **The Diff Inspector can't compare branches.** It is a newest-first log of Edit and Write calls, filterable by terminal and by path, and it keeps only the newest 500 or so bridge events across all terminals. Proposed: use it to read each agent's edits (step 8) and let the starter's compare script do the measured comparison in a Quay pane (step 9). No branch-compare view joins the fix-first list. The shortcuts page calls `Ctrl+B D` "Git Diff" and "visual git diff", which is drift to fix in the docs.
3. **Two terminals named `lead-dev`, two named `build-watcher`.** Launching the same preset twice duplicates names. It is harmless here: the rail groups them under each worktree and nobody uses the bus. But the A2A router resolves a name to the first match, and the drawer's terminal dropdown shows `lead-dev` twice. Proposed: accept it, filter the drawer by folder, and note on the A2A outlines never to launch one preset twice. The alternative is renaming each pair by double-clicking in the rail, which adds a step.
4. **Removing a dirty worktree fails silently.** The trash icon closes the worktree's terminals first, then runs `git worktree remove` without force. With uncommitted changes git refuses, and the error only reaches the developer console, leaving a worktree with no terminals. The draft dodges it by committing both experiments in step 10. Proposed: join the fix-first list. Check for changes before closing anything, show git's error in Quay, and offer **Remove anyway**. With that fix, step 10 needn't commit the loser.
5. **`Ctrl+B W` nests inside the selected worktree.** The dialog targets the active folder, so with a worktree selected the new one lands in `.worktrees/<a>/.worktrees/<b>`. The rail's own "New Git Worktree for" button on each project row already targets the project. Proposed: join the fix-first list, resolving the shortcut to the root project, as Quay already does when it starts an Archon run from a worktree. Until then, step 2's first action and its If not cover it.
6. **Worktrees live inside the project, and the docs say otherwise.** Quay puts them in `.worktrees/<branch>` under the project. So the starter must gitignore `.worktrees/` and exclude it from Vitest and `tsc`, or the main folder's `npm test` runs every experiment's tests too. Each worktree also needs its own `npm ci`, which the watcher line does. The git-worktrees feature page says worktrees go next to the repository, calls the dialog "Create Git Worktree" and the checkbox "Launch Agent in Worktree". Proposed: bake the exclusions into this starter only, and fix the feature page with the fix-first docs work.
7. **A rigged experiment.** The outcome is fixed by design, so Must match can name the winner and the Paste prompts can name the branch, since fixed prompts can't carry run-specific text. The alternative is an open-ended contest the learner judges, which breaks fixed prompts from step 10 on. Proposed: rigged, and the page says so in one line.
8. **`git init -b main` in step 1.** The New Git Worktree dialog's base defaults to `main`, but Git for Windows names the first branch `master` unless the learner configured otherwise. Proposed: make `git init -b main` the standard step 1 line for all twenty tutorials, not just this one.
9. **Clip.** Step 7, the rail click that flips the stage between experiments. Proposed: yes. The fallback is no clip, since Swarm 1 already has the swarm-launch clip.
10. **Level and length.** Advanced: three shells and two agents across two folders, a merge and a clean-up. Eleven step cards, one more than Swarm 2. Proposed: Advanced, eleven steps; Next up is A2A 1.
