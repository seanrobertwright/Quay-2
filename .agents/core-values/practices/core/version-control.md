# Version control and code review

> **Load when:** running Git commands beyond a plain status or diff; staging,
> committing, branching, merging, rebasing, cherry-picking, reverting, or force
> pushing; writing a commit message, PR title, or PR description; reviewing a
> diff or responding to review comments; undoing or recovering work; tagging a
> release; or editing `.gitignore`, `.gitattributes`, hooks, or branch policy.
> **See also:** [Specifying intent for AI coding agents](../core/working-with-ai-agents.md),
> [Engineering process](../core/engineering-process.md),
> [Debugging](../core/debugging.md),
> [Refactoring and legacy code](../core/refactoring-and-legacy-code.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Application and API security](../security/application-security.md),
> [Accessibility](../frontend/accessibility.md),
> [Unit, integration, and TDD](../testing/testing.md)

## Top rules

1. **Make each commit and each PR one logical change, small enough to review
   in one sitting.** Small, single-concern changes review fast, bisect cleanly,
   and revert without taking unrelated work with them. *[Pro Git ch. 5, Commit
   Guidelines; SE@Google ch. 9, Write Small Changes]*
2. **Never rewrite commits that others may have fetched.** No rebase, amend,
   squash, or plain force push on a shared branch; rewriting swaps commits for
   look-alikes and leaves collaborators with duplicates. *[Pro Git ch. 3, The
   Perils of Rebasing; ch. 7, Rewriting History]*
3. **Confirm before any command that destroys uncommitted work.** `reset
   --hard`, `restore <path>`, `checkout -- <path>`, and `clean -f` overwrite
   or delete changes Git never stored, so the reflog cannot bring them back;
   stash or make a temporary commit instead when unsure. *[Pro Git ch. 2, Undoing Things; ch. 7, Reset
   Demystified]*
4. **Read the staged diff before every commit.** Check `git status` and `git
   diff --staged`; never `commit -a` or `add .` blindly, because that sweeps in
   unrelated edits, generated files, and secrets. *[Pro Git ch. 2, Skipping the
   Staging Area]*
5. **Write messages and PR descriptions that say what changed and why.** A
   short imperative summary line, a blank line, then the motivation; the PR
   description must cover the whole diff. *[Pro Git ch. 5, Commit Guidelines;
   ch. 6, Creating a Pull Request; SE@Google ch. 9, Write Good Change
   Descriptions; Review lessons §1 Claims audit]*
6. **Audit every claim the diff touches before opening or updating a PR.**
   Comments, docstrings, READMEs, design docs, and the PR text must agree with
   the code as it now stands. *[Review lessons §1 Claims audit]*
7. **After fixing a finding, grep for the same pattern and fix every sibling in
   the same commit.** The same defect usually sits in several handlers.
   *[Review lessons §3 Sibling sweep]*
8. **Work on short-lived branches off current main, and integrate upstream and
   rerun tests before pushing.** Long-lived branches bundle many changes and
   make regressions hard to isolate. *[SE@Google ch. 16, (Nearly) No Long-Lived
   Branches; Pro Git ch. 5, Private Small Team]*
9. **When a commit breaks trunk, revert it first and fix forward afterwards.**
   A revert restores a known-good state in seconds; on pushed history, revert
   rather than reset. *[SE@Google ch. 23, Failure management; Pro Git ch. 7,
   Undoing Merges]*
10. **Treat a committed secret as leaked: rotate it first, scrub history
    second.** Every existing clone and fork still holds the old objects.
    *[Pro Git ch. 7, Removing a File from Every Commit]*

## Staging and committing

- **Split mixed work before committing.** Use partial staging (`git add
  --patch`) so each issue gets its own commit that can be reverted or
  cherry-picked alone. *[Pro Git ch. 5, Commit Guidelines]*
- **Keep a bug-fix change to the fix plus the regression test that would have
  caught it.** Bundled clean-up makes the fix bigger and harder to revert.
  *[SE@Google ch. 9, Bug Fixes and Rollbacks]*
- **Run `git diff --check` before committing.** Trailing whitespace and
  similar errors become noise in everyone else's diffs and merges. *[Pro Git
  ch. 5, Commit Guidelines; ch. 8, Formatting and Whitespace]*
- **Never bypass hooks with `--no-verify`.** A failing hook is a gate; fix the
  cause, and never downgrade a correctness lint rule globally to get past it.
  *[Pro Git ch. 8, Git Hooks; Review lessons §4 Cheap gates]*
- **Carry a pre-commit grep that fails on the U+FFFD replacement character and
  on personal identifiers (usernames, home-directory paths, personal email).**
  Encoding round-trips and pasted paths leak both into tracked files. *[Review
  lessons §4 Cheap gates]*
- **Keep large binaries out of history; use Git LFS for binary assets and a
  file-size check in pre-commit or on the server.** Every clone downloads
  every version forever, and removal later needs a destructive rewrite. The
  book covers only removal after the fact; LFS and size checks are the
  current way to prevent it. *[Pro Git ch. 10, Removing Objects]*
- **Update the message when an amend changes content materially.** Use
  `--no-edit` only for trivial fix-ups, and amend only unpushed commits. *[Pro
  Git ch. 7, Changing the Last Commit]*
- **Commit or stash before switching branches, merging, or rebasing.** A clean
  tree makes `merge --abort` reliable. *[Pro Git ch. 3, Basic Branching; ch. 7,
  Aborting a Merge]*

## Commit messages and change descriptions

- **Use the subject-body format: an imperative summary of about 50
  characters, a blank line, then a body wrapped near 72 columns.** Tools treat
  the first line as the subject and history entry. Follow the repository's
  convention (Conventional Commits, ticket keys) when it has one. *[Pro Git
  ch. 5, Commit Guidelines; SE@Google ch. 9, Write Good Change Descriptions]*
- **Explain the motivation and how behavior differs from before.** "Fix bug"
  tells a later reader running blame nothing. *[Pro Git ch. 5, Commit
  Guidelines; SE@Google ch. 9, Write Good Change Descriptions]*
- **Record decisions made in review in the description or a code comment.**
  Review threads are not where future readers look. *[SE@Google ch. 9, Write
  Good Change Descriptions]*
- **Write the PR title and description to commit-message standard when the
  repository squash-merges.** They become the permanent commit message. The
  book predates squash-merge as a host default; the rule extends its PR
  guidance. *[Pro Git ch. 5, Commit Guidelines; ch. 6, Creating a Pull
  Request]*
- **Rewrite the PR description or split the PR when scope grows.** A
  description that covers half the diff misleads the reviewer. *[Review
  lessons §1 Claims audit]*
- **Leave no placeholders, hand-typed counts, or `file:line` citations in
  PR text or docs.** Placeholders ship unfilled, typed counts go stale, and
  line numbers drift on the next edit; cite symbol names and compute counts.
  *[Review lessons §1 Claims audit]*

## Branching and integration

- **Do each feature or fix on its own topic branch cut from current upstream
  main, and delete it once merged.** It isolates the change for review and can
  be dropped if rejected. *[Pro Git ch. 3, Topic Branches; ch. 5, Forked Public
  Project]*
- **Start an unrelated second change from main, not from the branch you just
  submitted.** Independent topics must be revisable or rejectable on their own.
  *[Pro Git ch. 5, Forked Public Project]*
- **Name branches after the work, namespaced by owner in shared
  repositories.** Descriptive names make abandoned work easy to find. *[Pro Git
  ch. 5, Working in Topic Branches]*
- **Land unfinished work on trunk behind a flag instead of on a parallel
  branch.** Dependants never have to choose between branches; see
  [CI/CD](../devops/ci-cd.md) for flag rollout. *[SE@Google ch. 16, Dev
  Branches]*
- **Fetch, inspect, then integrate.** Run `git fetch`, read what arrived (`git
  log --no-merges HEAD..origin/main`), then merge or rebase; set `pull.rebase`
  or `pull.ff only` deliberately so a bare pull never makes a surprise merge.
  *[Pro Git ch. 3, Pulling; ch. 5, Private Small Team]*
- **Review what a branch introduces with a three-dot diff (`main...topic`).**
  A two-dot diff against a main that moved on shows main's new work as
  deletions. *[Pro Git ch. 5, Determining What Is Introduced]*

## Opening and updating pull requests

- **Open PRs early and iterate by pushing commits to the same branch.** The
  review history and the reasons behind each change stay visible. *[Pro Git
  ch. 6, Creating a Pull Request; Iterating on a Pull Request]*
- **After pushing review fixes, re-request review or post a comment saying
  what changed.** The book notes that added commits trigger no notification;
  current hosts still rely on an explicit re-request to put the PR back in a
  reviewer's queue. *[Pro Git ch. 6, Iterating on a Pull Request]*
- **Resolve conflicts on your own branch so the maintainer gets a clean
  merge.** Merge main in or rebase onto it, following the repository's
  convention. *[Pro Git ch. 6, Keeping up with Upstream]*
- **Address every review comment, if only to disagree with a reason, and do
  not resolve a thread until both sides have spoken.** If a reviewer cannot
  follow correct code, improve the structure or comments. *[SE@Google ch. 9,
  Be Polite and Professional]*
- **For public projects, push topic branches to your fork, never merge them
  into your own main.** Your main keeps tracking upstream untouched. *[Pro Git
  ch. 5, Forked Public Project]*
- **Follow each project's documented contribution process.** Read README and
  CONTRIBUTING first; projects differ on sign-off, patch format, and PR shape.
  *[Pro Git ch. 5, Public Project over Email; ch. 6, README and CONTRIBUTING]*

## Reviewing code

- **Automate formatting and mechanical rules in presubmit; never spend review
  comments on style.** A formatter diff should fail the check and print the
  fix command. *[SE@Google ch. 8, Code Formatters; ch. 9, Automate Where
  Possible]*
- **Accept the author's approach when it is valid, and ask before assuming.**
  Propose an alternative only when the current one is deficient. *[SE@Google
  ch. 9, Be Polite and Professional]*
- **Give all feedback in one pass.** New unrelated issues in each round waste
  the author's iterations. *[SE@Google ch. 9, Be Polite and Professional]*
- **Require one qualified approval by default; give any extra reviewer a
  distinct aspect to check.** The first approval carries most of the value.
  *[SE@Google ch. 9, Keep Reviewers to a Minimum]*
- **Do not reopen settled design in review.** For new code, check that it
  matches the agreed design, that every API entry point has a test, and that it
  has an owner. *[SE@Google ch. 9, Greenfield Code Reviews]*
- **Ask for the regression test on every bug fix.** *[SE@Google ch. 9, Bug
  Fixes and Rollbacks]*
- **On large-scale or generated changes, comment only on what is specific to
  your code.** Raise tool concerns separately so one change does not block the
  rest. *[SE@Google ch. 9, Refactorings and Large-Scale Changes]*
- **Check every claim in the diff against the code.** Docstrings promising
  ordering, "never throws", "at most one", or a write order are contracts.
  *[Review lessons §1 Claims audit]*
- **On any data-access change, check that each query, update, and delete
  carries the tenant column, and that "only one" rules are enforced by the
  database.** An id alone or an in-process guard is not enough; detail lives
  in [data modeling](../data/data-modeling.md). *[Review lessons §2 Four
  invariants]*
- **Run the security checklist on diffs touching HTTP handlers, HTML output,
  CI, or secrets.** Escaping, link-scheme allowlists, scoped CORS, CSP,
  outbound timeouts, and minimal CI permissions are in [application
  security](../security/application-security.md) and
  [CI/CD](../devops/ci-cd.md). *[Review lessons §5 Security checklist]*
- **Run the accessibility and scale checks on UI diffs.** Labels, roles,
  generated ids, stable keys, list caps, and stale-response guards are in
  [accessibility](../frontend/accessibility.md) and [components and
  state](../frontend/components-and-state.md). *[Review lessons §6
  Accessibility and scale]*
- **Keep deployment and runtime configuration in version control and review
  its changes like code.** Config pushes cause many major outages; versioned
  config can be blamed, tested, and rolled back. *[SE@Google ch. 14, Configuration issues; ch. 24, Conclusion]*

## Rewriting history and force pushing

- **Tidy local commits freely with interactive rebase or squash, then treat
  pushed history as final.** *[Pro Git ch. 3, Rebase vs. Merge; ch. 7,
  Rewriting History]*
- **Exclude every pushed commit from an interactive rebase range.** Each
  commit in the range and all descendants get new ids. *[Pro Git ch. 7,
  Changing Multiple Commit Messages]*
- **Force push only your own unshared branch, and only with
  `--force-with-lease --force-if-includes`.** The lease refuses to overwrite
  remote commits you have not seen, and the second flag stops a background
  fetch from silently satisfying the lease; plain `--force` checks nothing
  (updated from the book's `push -f`). *[Pro Git ch. 6, Keeping up with
  Upstream]*
- **If someone force-pushed history you built on, rebase onto their new tip
  rather than merging.** Git drops the rewritten duplicates and replays only
  your work. *[Pro Git ch. 3, Rebase When You Rebase]*
- **Announce any shared-history rewrite and tell every collaborator how to
  resync.** *[Pro Git ch. 3, Rebase When You Rebase; ch. 10, Removing
  Objects]*
- **Use `git filter-repo` (or BFG), not `filter-branch`, for bulk rewrites,
  and run it on a scratch clone first.** The book itself now warns against
  filter-branch. *[Pro Git ch. 7, The Nuclear Option: filter-branch]*

## Destructive commands, undo, and recovery

- **Dry-run `git clean -n` before `-f`, and prefer `git stash --all` when the
  files might matter.** `-x` also deletes ignored files such as local env
  files. *[Pro Git ch. 7, Cleaning your Working Directory]*
- **Delete branches with `-d`; check `git branch --no-merged` before ever
  using `-D`.** The safe form refuses to drop unmerged work. *[Pro Git ch. 3,
  Branch Management]*
- **Recover lost commits from `git reflog` (then `git fsck --full`) and point
  a new branch at them.** Committed work is almost always retrievable; do not
  re-create it by hand. *[Pro Git ch. 10, Data Recovery]*
- **Undo a local merge with reset; undo a pushed merge with `git revert -m
  1`.** Moving refs on shared history loses later commits. *[Pro Git ch. 7,
  Undoing Merges]*
- **Revert the revert before re-merging a branch whose merge was reverted.**
  Otherwise Git treats the old commits as merged and silently omits them.
  *[Pro Git ch. 7, Undoing Merges]*
- **Branch from a tag before changing an old release; never commit on a
  detached HEAD.** Those commits belong to no branch. *[Pro Git ch. 2,
  Checking out Tags]*
- **Use `git restore`, `git restore --staged`, `git switch`, and `git stash
  push`.** They replace the older overloaded `checkout`, `reset HEAD`, and
  `stash save` forms (Git 2.23 and later). *[Pro Git ch. 2, Undoing Things]*

## History as a debugging tool

- **Find regressions with `git bisect run <test>` when the check is
  scriptable, and finish with `git bisect reset`.** Small commits make the
  culprit obvious; see [debugging](../core/debugging.md). *[Pro Git ch. 7,
  Binary Search; SE@Google ch. 9, Write Small Changes]*
- **Search history before guessing.** `git log -S` or `-G` finds when a string
  appeared, `git log -L` follows a function, and `git blame -C` traces moved
  lines. *[Pro Git ch. 7, Git Log Searching; Line Log Search]*

## Repository setup and policy

- **Create `.gitignore` before the first commit, covering build output, logs,
  local env files, and editor files.** Start from a maintained language
  template. *[Pro Git ch. 2, Ignoring Files]*
- **Normalize line endings with a committed `.gitattributes` (for example
  `* text=auto`, explicit `eol` for scripts).** It applies to every clone,
  unlike per-user `core.autocrlf`, which the book uses. *[Pro Git ch. 8,
  Formatting and Whitespace]*
- **Mark unmergeable generated files as `binary` or give them a merge driver
  in `.gitattributes`.** Git stops producing useless diffs and conflict
  markers. *[Pro Git ch. 8, Git Attributes]*
- **Commit lockfiles so every build resolves the same versions; never float on
  "latest".** Upgrade deliberately and let tests prove the new set. The book
  asks for explicit pins; a committed lockfile is the current form of that
  rule. *[SE@Google
  ch. 18, Managing Dependencies; ch. 21, Considerations When Importing]*
- **Enforce policy on the server (branch protection, required checks, no force
  push to protected branches); ship client hooks only as early warnings.**
  Client hooks are not cloned and can be skipped. Commit them and point
  `core.hooksPath` at them, or use a hook manager. *[Pro Git ch. 8, Git Hooks;
  An Example Git-Enforced Policy; Server Configuration]*
- **Store credentials in the OS keychain, a credential manager, or SSH keys;
  never the plain-text `store` helper.** *[Pro Git ch. 7, Credential Storage]*
- **Set author identity per repository when it differs from the global one.**
  Fixing identity later rewrites history. *[Pro Git ch. 1, Your Identity]*
- **If the team signs commits, make signing automatic for everyone.** SSH-key
  signing (Git 2.34 and later) is simpler than GPG. *[Pro Git ch. 7, Signing
  Commits; Everyone Must Sign]*
- **Push submodule commits before the superproject commit that references
  them; set `push.recurseSubmodules` to `check`.** *[Pro Git ch. 7, Publishing
  Submodule Changes]*

## Releases and tags

- **Mark releases with annotated, ideally signed, tags and push them by
  name.** A plain push does not send tags. *[Pro Git ch. 2, Tagging; ch. 5,
  Tagging Your Releases]*
- **Derive build identifiers from `git describe`, not invented numbers.**
  *[Pro Git ch. 5, Generating a Build Number]*
- **Use a release branch only to pin shipped code; fix on trunk first, then
  cherry-pick into it, and never merge it back.** Teams that deploy
  continuously can skip release branches. *[SE@Google ch. 16, Release
  Branches]*

## Tensions

- **Merge vs rebase for integration.** Pro Git declines to choose beyond
  "rebase local, never rebase public" and notes most contributors merge
  upstream into PR branches. This library follows the repository's documented
  convention; with none, rebase local work, merge into shared branches, and
  never rewrite pushed commits. *[Pro Git ch. 3, Rebase vs. Merge; ch. 6,
  Keeping up with Upstream]*
- **Long-lived integration branches vs trunk-based development.** Pro Git
  presents develop/next progressive-stability branches favourably; SE@Google
  argues for one trunk with flags. This library defaults to trunk-based work
  with short branches; long-lived integration branches suit only large,
  release-heavy projects that already use them. *[Pro Git ch. 3, Long-Running
  Branches; SE@Google ch. 16, (Nearly) No Long-Lived Branches]*
- **Fix-up commits vs a re-rolled PR.** Pro Git favours adding commits to an
  open PR; squash-merge hosts collapse them anyway. Add commits while review is
  open so reviewers see the delta, and let the merge method decide the final
  shape. *[Pro Git ch. 6, Iterating on a Pull Request]*
- **The size limit vs unavoidable large changes.** SE@Google's figure of
  roughly 200 lines is a guideline. Split by stacking dependent PRs or by
  shipping behind a flag; accept an occasional large change only when it
  cannot be split, and say why in the description. *[SE@Google ch. 9, Write
  Small Changes; ch. 22, Sharding and Submitting]*
- **Pinning vs version ranges.** SE@Google calls ranges a recipe for disaster;
  most ecosystems now allow ranges in the manifest with a committed lockfile.
  The house rule is reproducible builds from source control: ranges are fine
  only with a lockfile. *[SE@Google ch. 18, Managing Dependencies]*

## Sources

- **Pro Git**: Pro Git, 2nd Edition (Scott Chacon and Ben Straub; online
  build 2.1.x). Command forms updated where Git has since changed: `restore`
  and `switch`, `stash push`, `filter-repo`, `--force-with-lease` with
  `--force-if-includes`, SSH signing, `.gitattributes` line endings,
  `core.hooksPath`, Git LFS.
- **SE@Google**: Software Engineering at Google: Lessons Learned from
  Programming Over Time (Titus Winters, Tom Manshreck, Hyrum Wright; O'Reilly,
  1st edition, 2020). Google-internal tool names are omitted; the practices
  carry over.
- **Review lessons**: rules distilled from the maintainer's code-review findings
