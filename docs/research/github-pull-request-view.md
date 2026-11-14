# GitHub's pull request view, November 2026

Research for the Quay shell redesign. It records what GitHub's pull request page looks like and
does, which parts are newly released and which are still classic, and which API calls a desktop
client needs to copy the first cut of it. Checked on 2026-11-14.

## How to read this note

Every claim carries one of these labels:

- **Text** means GitHub wrote it in a changelog post, a docs page, an API reference or a staff
  post, and the link is given.
- **Screenshot** means it is read from an image GitHub published in the linked post. Labels and
  positions are as drawn in that image. GitHub may have changed them since.
- **Schema** means it was read from the live GraphQL schema by introspection on the check date.
- **Inference** means it is a conclusion drawn here and not stated by GitHub.

Sources are GitHub Changelog, GitHub Docs, the GitHub CLI manual and GitHub Community
discussions opened by GitHub staff. The accounts quoted as staff are marked `site_admin` by
the GitHub users API. No third-party write-ups were used. Remarks by other users in those
discussions are marked as user reports.

## Short answer

- The pull request page is in the middle of a staged redesign. Each tab has moved on its own
  schedule, so "the new pull request view" is several releases, not one.
- The newest piece is the **Overview page**, an opt-in public preview announced on
  2026-11-05. It replaces the Conversation tab. It moves a compact merge box, called the
  readiness summary, to the top of the page, puts comments under it newest first with the
  comment box above them, and moves other timeline activity into a summary in the right
  sidebar.
- The **Files changed** page is the new experience by default since 2026-01-22. It has a
  resizable file tree on the left and docked side panels for the description, comments, alerts
  and merge status. GitHub's posts still call it a preview. No general availability post was
  found.
- A **Merge status** button sits in the header of every pull request page since 2026-03-05
  (public preview). It opens a side panel with approvals, checks, blockers and the merge
  button.
- The **merge box** on the classic Conversation page was itself redesigned and reached general
  availability on 2025-03-04. Checks are grouped by status with failing checks first.
- No changelog post announces a redesign of the **Commits** or **Checks** tabs. They are
  treated here as classic.

## What is new and what is classic

| Part | Status on 2026-11-14 | Dates | Source |
| --- | --- | --- | --- |
| Overview page (replaces the Conversation tab) | Public preview, opt-in | Announced 2026-11-05. Staff said rollout would finish by Monday 2026-11-09. | [Changelog 2026-11-05][cl-overview], [discussion 212186][disc-overview] |
| Conversation tab (classic overview) | Default for anyone who has not opted in | Not dated | [Pull requests reference][docs-prs] still names the tab **Conversation** |
| Merge status button and panel in the header | Public preview | 2026-03-05 | [Changelog 2026-03-05][cl-merge-status] |
| Merge box on the Conversation page ("improved merge experience") | Generally available | Preview 2024-12-03, on by default 2025-02-12, GA 2025-03-04, grouping preference 2025-04-03 | [Preview][cl-merge-preview], [default][cl-merge-default], [GA][cl-merge-ga], [April update][cl-merge-april] |
| Files changed, new experience | Default for all users, still labelled preview, classic opt-out offered | Preview 2025-06-26, default 2026-01-22 | [Preview][cl-files-preview], [default][cl-files-default] |
| Files changed docked panels (Overview, Comments, Alerts, Merge status) | Rolling out, no preview or GA label | Overview panel 2025-11-20, Comments panel 2026-02-19, all panels 2026-03-19 | [Panels][cl-panels], [Overview panel][cl-overview-panel], [Comments panel][cl-comments-panel] |
| Saved whitespace preference, full-width new and deleted files in split view | Released, no label | 2026-10-22 | [Changelog 2026-10-22][cl-whitespace] |
| Stacked pull requests (stack shown in the header and merge box) | Generally available | 2026-10-06 | [Changelog 2026-10-06][cl-stacks] |
| Commits tab | Classic. No redesign post found. | Not dated | Inference |
| Checks tab | Classic. No redesign post found. | Not dated | Inference |

Two points of detail on the table:

- GitHub has not published a general availability post for the new Files changed page. The
  [feedback discussion][disc-files] it links from every update is still titled as preview
  feedback. The classic opt-out was "still available" on 2026-01-22 (Text). Whether it is still
  offered today was not confirmed.
- The [Pull requests reference][docs-prs] lists a fifth tab, **Findings**, for "automated code
  review results, such as code scanning alerts" (Text). No changelog post about that tab was
  found and it is absent from every published screenshot. Inference: it appears only when a
  pull request has findings.

## Overview page (public preview)

Source for this section: [Changelog 2026-11-05][cl-overview] and its three images, unless
another link is given.

### Regions, top to bottom

The capture GitHub published is about 1,460 px wide. The main column takes roughly two thirds
of the width and a right sidebar takes the rest (Screenshot).

1. **Compact title bar.** A slim bar under the repository navigation. Left: the number, the
   title in small bold type and a copy button. Right: a **Merge status** button with a status
   icon, a green **Submit review** split button, then two icon buttons (Screenshot). What the
   two icon buttons do is not stated. Inference: they open the docked comments panel and
   toggle the sidebar.
2. **Title block.** The title in large type with an edit pencil. At the far right: a preview
   menu pill, a code button and a notifications bell (Screenshot). The preview menu is how you
   return to the classic overview (Text).
3. **State line.** A green **Open** pill with a caret, the author avatar and "opened 2 days
   ago", the base branch chip with a caret, an arrow, the head branch chip with a copy button,
   then the added and removed line counts with the five-square diffstat (Screenshot). "You can
   also mark a draft ready for review or close a pull request from the header, with available
   actions depending on your permissions" (Text). Inference: the caret on the state pill is
   that menu.
4. **Tabs.** **Overview**, **Commits**, **Checks**, **Files changed**, each with an icon and a
   count pill except Overview. The selected tab has an underline (Screenshot).
5. **Readiness summary.** The redesigned merge box, at the top of the main column. See the
   next heading.
6. **Description.** The pull request body rendered as plain page content with its own
   headings and an edit pencil at the right (Screenshot). A user in the feedback thread
   reported the body had lost its comment box and later struck that remark out, so the frame
   may have been restored after the image was made ([discussion 212186][disc-overview]).
7. **Comments.** A **Comments** heading, filters, the comment box, then the items. See
   "Comments section" below.
8. **Right sidebar.** An activity summary, then Reviewers, Assignees, Labels, Projects and
   Milestone, each with a gear button (Screenshot).

### Readiness summary

GitHub's description: the merge box shows "the same information in less than half the space"
and has these jobs, in this order (Text):

- "Explore the supporting signals: A compact view of checks, comments, and approvals."
- "Address what's blocking: Take action to move the pull request forward, such as updating
  your branch."
- "See if it's ready to merge: Check merge readiness and merge when requirements are met."

"Start with the summary, then follow the detail that matters to your next step (e.g., get to
failing checks, see who still needs to approve, or open the relevant comments)" (Text).

As drawn (Screenshot):

- One bordered card with two rows. GitHub's own annotation gives its size as 785 by 130 px,
  against 753 by 469 px for the classic merge box.
- **Top row.** A round status icon, a bold headline ("Approval required") and one line of
  explanation ("Request another approving review before this can merge."). At the right, an
  **Update branch** split button and a **Merge pull request** split button. The merge button
  is greyed out while merging is blocked.
- **Bottom row.** Equal-width cells divided by vertical rules: **Checks**, **Comments** with
  "2 unresolved", and **Approvals** with "1 still required". Each cell has a thin segmented
  progress bar under its label: green for the satisfied share, grey for the outstanding share,
  amber for unresolved comments. The Checks cell ends in a chevron. The other two end in a
  diagonal arrow.
- GitHub's comparison image maps the classic "All checks have passed" row to the Checks cell,
  the classic **Update branch** button to the new one, and the classic **Merge pull request**
  button to the new one.

Not stated by GitHub: what opens when a cell is clicked. Inference from the icons and from the
March panel described below: the Checks chevron expands or opens the checks list, and the
arrows jump to the comments and to the reviewers.

Reported by users in the feedback thread and not confirmed by staff: the headline reads
"Checks failing" while checks are only in progress, and the card can go blank after switching
merge method ([discussion 212186][disc-overview]).

### Comments section

As drawn (Screenshot), with the callouts GitHub numbered in its image:

- A **Comments** heading on the left.
- On the same line at the right, a segmented filter: **All**, **Unresolved** with a count,
  **Mine**. "Filter for unresolved conversations or comments you wrote" (Text).
- After a divider, a filter icon button and a sort icon button. The sort menu holds **Newest
  first** and **Oldest first**, with newest first ticked. "Sort comments from newest to oldest
  instead of starting with the earliest discussion" (Text).
- The comment box sits directly under the heading, above the items. It has **Write** and
  **Preview** tabs, a formatting toolbar, the placeholder "Leave a comment" and a footer line
  "Paste, drop, or click to add files".
- Under the box, right-aligned: **Close pull request**, then a green **Comment** button.
- Below that, the items, newest first. Commit rows sit on a vertical rail with an avatar, the
  commit message, the short SHA and a copy button. Comments and reviews are bordered cards
  with an avatar, the author, a one-line action ("recommended approval 20 hours ago") and a
  kebab menu.

So the classic single timeline is split. Comments, reviews and commits stay in the main
column. Other events move to the sidebar summary. Users in the feedback thread say force
pushes, title changes and "mentioned this pull request" events are no longer inline, and a
staff member asked which of those people miss ([discussion 212186][disc-overview]). GitHub has
not published the exact list of event types kept inline.

### Sidebar activity summary

"Catch up on activity: Use the summary in the upper-right to find review comments, review
requests, and other updates" (Text).

As drawn (Screenshot): a heading "Activity (since you last interacted)" with a filter icon,
then one row per kind of event, each with an icon, a label and a count pill: Commits,
Approvals, Review comments, Comments, Review requests, Copilot events. A **View all activity**
link closes the list. Under it, the Reviewers list shows one row per reviewer with a state
icon at the right.

### Opting in and out

To join, select the **Try the Overview page** button in the header. Its label starts with a
sparkle emoji. "You can use the same menu to return to the classic overview during the
preview" (Text). GitHub calls the preview "very much a starting point, not the finished pull
request experience" (Text).

## Merge status button and panel

"We are rolling out the pull request merge status at the top of every pull request page."
"Click to open the details so you can quickly identify blockers, missing approvals, and get
your pull request ready to merge" ([Changelog 2026-03-05][cl-merge-status], Text). The docs now
say the merge status "appears in the pull request header and in the merge box"
([Pull requests reference][docs-prs], Text).

As drawn in the March image (Screenshot):

- A status button at the right of the title, reading "Unable to merge" with a red icon.
- Clicking it opens a panel docked to the right edge, titled **Merge status**, with a close
  button. The page content stays visible beside it.
- The panel stacks the same sections as the merge box:
  - "Changes approved", with "1 approving review by reviewers with write access." and an
    expandable "1 approval" list naming each reviewer.
  - "All checks have passed", with "5 successful checks" and the list of checks. Each row has
    a result icon, the app avatar, the check name, a result line such as "Successful in 54s",
    and a kebab menu.
  - "Merging is blocked", with the reason "All comments must be resolved."
  - An **Enable auto-merge** split button.
  - "You can also merge this with the command line. View command line instructions."
  - "Still in progress? Convert to draft".

This panel is the closest thing GitHub ships to a narrow pull request column: it carries
approvals, checks, blockers and the merge action in a single strip (Inference).

## Merge box in detail

### Sections of the generally available merge box

From the images in the [preview post][cl-merge-preview], the [April update][cl-merge-april] and
the classic half of the [Overview comparison][cl-overview] (Screenshot). The box is a stack of
rows. Each row has a round status icon, a bold headline, one line of detail and, where it
expands, a chevron at the right.

- **Reviews.** "Review required", with "At least 1 approving review is required by reviewers
  with write access." Expands to approvals and pending reviews.
- **Checks.** A ring icon coloured by the mix of results, a headline such as "Some checks were
  not successful" or "All checks have passed", and a count line such as "2 failing, 3 pending,
  13 successful checks". Expands to the checks list.
- **Conflicts.** "No conflicts with base branch", with "Merging can be performed
  automatically."
- **Branch freshness.** "This branch is out-of-date with the base branch", with an **Update
  branch** split button at the right.
- **Blocked.** "Merging is blocked", with the reason.
- **Footer.** The merge split button, then "You can also merge this with the command line.
  View command line instructions."

### Checks list and failing checks

- "Checks are now grouped by status with failing checks prioritized at the top of the list"
  ([preview post][cl-merge-preview], Text).
- Checks use natural ordering inside a group ([default post][cl-merge-default], Text).
- A gear at the top right of the list switches between **Group by status**, the default, and
  **No grouping** ([April update][cl-merge-april], Text).
- Group headings read "2 failing checks", "3 pending checks", "1 skipped check", "1 neutral
  check", "13 successful checks", each with its own expand chevron (Screenshot).
- In GitHub's launch image the failing and pending groups are open and the successful group
  is closed (Screenshot). GitHub does not state the default open state in text.
- A check row has a result icon (red cross, amber dot, grey skipped mark, green tick), the app
  avatar, the check name and a detail line such as "Successful in 47s" or "Skipped 1 hour
  ago". Status check durations are shown ([default post][cl-merge-default], Text). A truncated
  name shows a tooltip, and "Started 2s ago" updates live ([April update][cl-merge-april],
  Text).
- Each row ends in a chevron or a kebab menu, depending on the image (Screenshot). Where the
  row link leads is not stated. Inference: to the check's page on the Checks tab.
- Errors from commit metadata rules, such as a non-compliant commit message, are shown at
  merge time and can be corrected and retried ([preview post][cl-merge-preview], Text).

Check results a client must be able to draw, from the [Status checks reference][docs-checks]
(Text): statuses `queued`, `in_progress`, `pending`, `waiting`, `requested`, `expected`,
`completed` and `startup_failure`, and conclusions `success`, `failure`, `neutral`,
`cancelled`, `skipped`, `timed_out`, `action_required` and `stale`. "A job that is skipped
will report its status as Success. It will not prevent a pull request from merging, even if it
is a required check."

### Merge methods

From [Merging a pull request][docs-merge] and [Pull request merges][docs-merges-ref] (Text).

| Method | Button, then confirm button | What it does |
| --- | --- | --- |
| Merge commit | **Merge pull request**, or **Create a merge commit** in the dropdown, then **Confirm merge** | Adds all commits plus a merge commit, using `--no-ff` |
| Squash | **Squash and merge**, then **Confirm squash and merge** | Combines all commits into one commit on the base branch |
| Rebase | **Rebase and merge**, then **Confirm rebase and merge** | Adds each commit onto the base branch with no merge commit. Always creates new commit SHAs. |

- The method is chosen from the dropdown half of the split button. The button label then
  changes to the chosen method (Text).
- Only methods the repository allows are offered. Squash and rebase each need a repository
  setting (Text).
- After the first click the box asks for a commit message, with a default filled in, and
  offers an author email dropdown when the account has more than one verified address. The
  email selector is not offered for rebase merges (Text).
- A draft pull request cannot be merged. The merge box shows **Ready for review**
  ([Changing the stage of a pull request][docs-stage], Text).
- With a merge queue on the base branch the options differ
  ([merge queue docs][docs-merge-queue], Text). That is out of the first cut.

### Auto-merge

From [Automatically merging a pull request][docs-automerge] (Text).

- The option "is shown only on pull requests that cannot be merged immediately", for example
  while a required review or a required check is outstanding. It must also be allowed in the
  repository settings.
- Flow: pick a method in the dropdown, click **Enable auto-merge**, fill in the commit message
  for merge or squash, then click **Confirm auto-merge**.
- To cancel, click **Disable auto-merge** in the merge box.
- Auto-merge is switched off automatically "if someone without write permissions pushes new
  changes to the head branch or switches the base branch".

### Delete branch

- After a merge the docs say "Optionally, delete the branch" ([Merging a pull
  request][docs-merge], Text).
- "Near the bottom of the pull request, click **Delete branch**. This button isn't displayed if
  there's currently an open pull request for this branch." A **Restore branch** button takes
  its place afterwards ([Deleting and restoring branches][docs-delete-branch], Text).
- A repository can delete head branches automatically after merge with the **Automatically
  delete head branches** setting ([docs][docs-autodelete], Text).
- When a head branch is deleted after merge, GitHub retargets open pull requests based on it
  to the merged pull request's base ([Merging a pull request][docs-merge], Text).
- Where **Delete branch** sits on the new Overview page is not shown in any source.

### Close without merging

- Classic: "At the bottom of the pull request, below the comment box, click **Close pull
  request**" ([Closing a pull request][docs-close], Text).
- Overview preview: the same button sits beside **Comment** under the comment box, which is
  now near the top (Screenshot), and closing is also offered from the header (Text).

## Files changed page (new experience)

Sources: [default post][cl-files-default], [preview post][cl-files-preview], [panels
post][cl-panels], [commit review post][cl-files-commits], [feedback discussion][disc-files].

### Layout

As drawn in the January image (Screenshot):

- **Header.** The title and number, with a preview menu pill, an **Edit** button and a
  **Code** button at the right. Under it the state pill and "wants to merge 8 commits into
  `main` from `feature/…`" with a copy button.
- **Tabs.** Conversation, Commits, Checks, Files changed, drawn as boxed tabs with count
  pills. The pull request diffstat sits at the right end of the tab row.
- **Toolbar.** Left: a button that shows or hides the file tree, then an **All commits**
  dropdown. Right: a viewed counter with a progress ring ("3 / 12 viewed"), an Overview icon
  button, a **Comments** button with a count, an **Alerts** button with a count, a green
  **Submit review** split button and a settings gear.
- **Left column, file tree.** About a fifth of the page width in the image. From the top: an
  optional "Groups by Copilot" block that can be collapsed, a "Filter files…" search field
  with a filter menu button beside it, then the tree.
- **Right column, diffs.** One card per file, stacked.

When the page is scrolled, a compact header replaces the full one: the tree toggle, the state
pill, the title and number on one line, and the commit filter and "wants to merge" line under
it (Screenshot, from the [Comments panel post][cl-comments-panel]). GitHub's posts refer to
"sticky headers" on this page and to a sticky file diff header
([default post][cl-files-default], [February update][cl-files-feb], Text).

### File tree

- Resizable by dragging ([preview post][cl-files-preview], Text).
- Folders sort before files at the same level ([July update][cl-files-july], Text).
- Rows carry "indicators showing the files with comments, errors, and warnings"
  ([default post][cl-files-default], Text).
- File filters "apply to both the tree and the diffs". A blue dot on the filter button shows a
  filter is active, and the menu has **Clear filters** ([preview post][cl-files-preview],
  [commit review post][cl-files-commits], Text).
- Picking a collapsed file in the tree expands it ([July update][cl-files-july], Text).
- Folder rows have a chevron and a folder icon. File rows have a file icon tinted by change
  type (Screenshot).
- Not documented: whether the tree hides itself below some window width, and its default
  width.

### File cards and diffs

- Header row: a collapse chevron, the path in monospace, a copy button, an expand-all button,
  the file's added and removed counts with the diffstat squares, a **Viewed** checkbox button,
  a comment button and a kebab menu (Screenshot).
- The file header is sticky while its diff scrolls ([February update][cl-files-feb], Text).
- Marking a file **Viewed** collapses it. It is unmarked again if the file changes
  ([Reviewing proposed changes][docs-review], Text).
- Unified and split views switch without a page reload. The setting lives under the gear
  ([default post][cl-files-default], Text). The unified or split choice carries across pull
  requests ([Reviewing proposed changes][docs-review], Text).
- In split view, new and deleted files span both columns ([Changelog
  2026-10-22][cl-whitespace], Text).
- Whitespace: a saved preference of **Always show**, **Always hide** or **Hide for this diff
  only**. When hidden, a **Hide whitespace** chip appears beside **All commits**
  ([Changelog 2026-10-22][cl-whitespace], Text).
- Other gear options: **Minimize comments** and **Compact line height**
  ([preview post][cl-files-preview], Text).
- Images get 2-up, swipe and onion-skin comparison. Markdown and SVG toggle between source and
  rich preview ([July update][cl-files-july], Text).
- A hunk header row shows the `@@` range with an expand control at its left (Screenshot).
- The commit filter reviews all commits, a range or a single commit without leaving the page
  ([commit review post][cl-files-commits], Text).
- A **Refresh** control pulls in newly pushed changes without a full reload
  ([default post][cl-files-default], Text).
- URLs moved to a `/changes` path. Old `/files` and `/commits/:sha` links redirect
  ([commit review post][cl-files-commits], Text).

### Docked panels

"Docked panels … let you review code with key pull request context open side-by-side:
overview, comments, alerts, and merge status" ([discussion 190095][disc-panels], Text).

| Panel | Opened by | Shows |
| --- | --- | --- |
| Overview | The Overview button in the toolbar | The pull request description |
| Comments | The **Comments** button in the toolbar | Review comments and general comments, with a box to add a comment |
| Alerts | The **Alerts** button in the toolbar | Code scanning alerts for the changes |
| Merge status | The **Merge status** button in the header | Blockers, approvals, checks and the merge action |

The Comments panel as drawn (Screenshot, [Comments panel post][cl-comments-panel]): docked at
the right, taking roughly two fifths of the page. A title and a close button. A segmented
switch between **Review** and **Conversation** with counts. A "Filter comments" search field
and a **Filter** menu. Comment cards with avatar, author, time, body, a reaction button and
**Quote Reply**. At the bottom an "Add a comment" block that collapses, with **Write**,
**Preview** and **Hybrid** tabs and a green **Comment** button.

### Limits

From the [feedback discussion][disc-files] (Text): 1,000 files in single file mode or 3,000 in
the experimental virtualized mode, 40 comments in the page with up to 350 in the Comments
panel, 20 replies per comment, 50 alerts. Very large pull requests switch to a single file
mode with previous and next file buttons in the toolbar ([September update][cl-files-sept],
Text).

## Commits and Checks tabs

- **Commits** "shows how the pull request branch changed over time"
  ([Pull requests reference][docs-prs], Text). The only recent change found is a limited
  preview that shows who pushed each commit ([Changelog 2026-10-12][cl-push-attribution],
  Text). No layout detail was confirmed from a primary source.
- **Checks** "helps you understand which validations ran and why a check passed or failed". It
  has a dropdown to pick the commit, and it "is populated for pull requests only if you set up
  checks, not commit statuses" ([Status checks reference][docs-checks], Text).
- When a check points at a line, its annotation also shows on the Files changed tab
  ([Status checks reference][docs-checks], Text).

## Keyboard shortcuts

Documented shortcuts that apply inside a pull request, from [Keyboard
shortcuts][docs-shortcuts] unless another link is given (Text).

| Keys | Action | Where |
| --- | --- | --- |
| `Ctrl+Enter` (`Command+Enter` on Mac) | Submit a comment | Any comment box |
| `Ctrl+Shift+P` | Toggle the Write and Preview tabs | Any comment box |
| `R` | Quote the selected text in a reply | Conversation |
| `Q` | Request a reviewer | Pull request |
| `A`, `L`, `M` | Set assignee, label, milestone | Pull request |
| `C` | Open the commit filter, when single-key shortcuts are enabled ([commit review post][cl-files-commits]) | Files changed |
| `T` | Focus the file filter and show the file tree if hidden ([commit review post][cl-files-commits]) | Files changed |
| `I` | Toggle minimized comments ([preview post][cl-files-preview]) | Files changed |
| `P`, `N` | Previous and next commit ([default post][cl-files-default]) | Files changed |
| `Ctrl+Shift+Enter` | Submit a review comment | Files changed |
| `Shift+J`, `Shift+K` | Move between pull requests in a stack ([stacks post][cl-stacks]) | Pull request |
| `G` then `P` | Go to the repository's pull requests | Repository |

No shortcut is documented for merging, for switching pull request tabs, or for anything on the
new Overview page.

## API and CLI for a desktop client

One row per action in the first cut. REST paths are relative to `https://api.github.com`.

| Action | REST | GraphQL | GitHub CLI |
| --- | --- | --- | --- |
| Read the pull request and its merge state | [`GET /repos/{owner}/{repo}/pulls/{pull_number}`][rest-get-pr] | [`PullRequest`][gql-pr] fields `mergeable`, `mergeStateStatus`, `reviewDecision`, `autoMergeRequest`, `isDraft` | [`gh pr view --json`][cli-view] |
| List timeline events | [`GET /repos/{owner}/{repo}/issues/{issue_number}/timeline`][rest-timeline] | `PullRequest.timelineItems`, union [`PullRequestTimelineItems`][gql-timeline] | [`gh api`][cli-api] |
| List comments | [`GET /repos/{owner}/{repo}/issues/{issue_number}/comments`][rest-list-comments] | `PullRequest.comments` | [`gh pr view --comments`][cli-view] |
| Add a comment | [`POST /repos/{owner}/{repo}/issues/{issue_number}/comments`][rest-create-comment] | [`addComment`][gql-add-comment] | [`gh pr comment`][cli-comment] |
| Read check runs | [`GET /repos/{owner}/{repo}/commits/{ref}/check-runs`][rest-check-runs] | [`StatusCheckRollup`][gql-rollup] on the head commit, via `PullRequest.statusCheckRollup` | [`gh pr checks`][cli-checks] |
| Read commit statuses | [`GET /repos/{owner}/{repo}/commits/{ref}/status`][rest-status] | Same rollup, [`StatusContext`][gql-status-context] entries | [`gh pr checks`][cli-checks] |
| Read why a check failed | [`GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations`][rest-annotations], and for Actions [`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`][rest-job-logs] | [`CheckRun`][gql-check-run] fields `title`, `summary`, `text`, `annotations` | [`gh run view --log-failed`][cli-run-view] |
| Read the file list | [`GET /repos/{owner}/{repo}/pulls/{pull_number}/files`][rest-files] | `PullRequest.files` | [`gh pr diff --name-only`][cli-diff] |
| Read the diff | [`GET /repos/{owner}/{repo}/pulls/{pull_number}`][rest-get-pr] with the `application/vnd.github.diff` media type | Not offered as text | [`gh pr diff`][cli-diff] |
| Merge with a method | [`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async`][rest-merge-async], then poll [`GET …/merge-async/{uuid}`][rest-merge-async-result]. Older: [`PUT …/merge`][rest-merge] | [`mergePullRequest`][gql-merge] | [`gh pr merge`][cli-merge] with `--merge`, `--squash` or `--rebase` |
| Enable or disable auto-merge | None found | [`enablePullRequestAutoMerge`][gql-automerge], `disablePullRequestAutoMerge` | [`gh pr merge --auto`][cli-merge], `--disable-auto` |
| Update the branch from base | [`PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch`][rest-update-branch] | `updatePullRequestBranch` | [`gh pr update-branch`][cli-update-branch] |
| Delete the head branch | [`DELETE /repos/{owner}/{repo}/git/refs/{ref}`][rest-delete-ref] with `heads/` and the branch name | [`deleteRef`][gql-delete-ref] | [`gh pr merge --delete-branch`][cli-merge] |
| Close without merging | [`PATCH /repos/{owner}/{repo}/pulls/{pull_number}`][rest-update-pr] with `state` set to `closed` | [`closePullRequest`][gql-close] | [`gh pr close`][cli-close] |
| Mark a draft ready | None found | `markPullRequestReadyForReview` | [`gh pr ready`][cli-ready] |

Facts that shape the client (Text unless marked):

- **Merging.** The async merge API became generally available on 2026-10-01 and "is now the
  recommended path for programmatically merging pull requests instead of the synchronous REST
  endpoint or GraphQL mutations" ([Changelog 2026-10-01][cl-async-merge]). Its body takes
  `merge_method` (`merge`, `squash`, `rebase`), `merge_action` (`default`, `direct_merge`,
  `merge_queue`), `sha`, `commit_title`, `commit_message` and `bypass_rules`. The poll returns
  `pending`, `merged`, `enqueued` or `failed`, and results are kept for 24 hours
  ([REST reference][rest-merge-async]). The synchronous endpoint "does not support stacked
  pull requests or merging with a merge queue" ([REST reference][rest-merge]).
- **Blocked states.** GraphQL `mergeStateStatus` is one of `CLEAN`, `UNSTABLE`, `BLOCKED`,
  `BEHIND`, `DIRTY`, `HAS_HOOKS` or `UNKNOWN`. `mergeable` is `MERGEABLE`, `CONFLICTING` or
  `UNKNOWN`. `reviewDecision` is `APPROVED`, `CHANGES_REQUESTED` or `REVIEW_REQUIRED` (Schema).
  The REST `mergeable` field is `null` while GitHub computes it, and the request must be
  repeated ([REST reference][rest-get-pr]). No endpoint returns the merge box's sentence, such
  as "All comments must be resolved". The client has to compose it (Inference).
- **Permissions to act.** `PullRequest` exposes `viewerCanClose`, `viewerCanEnableAutoMerge`,
  `viewerCanDisableAutoMerge`, `viewerCanUpdateBranch`, `viewerCanMergeAsAdmin` and
  `viewerCanDeleteHeadRef` for showing or hiding buttons (Schema).
- **Checks.** A check run carries `status`, `conclusion`, `started_at`, `completed_at`,
  `details_url`, `html_url`, the app, and an `output` with `title`, `summary`, `text` and
  `annotations_count` ([REST reference][rest-check-runs]). Check runs and commit statuses are
  separate lists, so a complete checks list reads both, or reads the GraphQL rollup once
  (Inference from the two references). `gh pr checks --json` adds a `bucket` of `pass`,
  `fail`, `pending`, `skipping` or `cancel`, and `--required` narrows to required checks
  ([CLI manual][cli-checks]).
- **Files.** The file list returns `filename`, `status`, `additions`, `deletions`, `changes`,
  `patch` and `previous_filename` per file, paged at up to 100 a page, with "a maximum of 3000
  files" ([REST reference][rest-files]).
- **Comments.** "Every pull request is an issue", so general comments use the issue comment
  endpoints. The `application/vnd.github.html+json` media type returns rendered HTML in
  `body_html` ([REST reference][rest-list-comments]).
- **Timeline.** The timeline endpoint pages at up to 100 events and mixes comments, commits,
  reviews and state changes ([REST reference][rest-timeline]).
- **Delete branch.** Deleting a ref returns `204`. `422` covers an attempt to delete the
  default branch ([REST reference][rest-delete-ref]).

## Out of the first cut, in brief

- **Line comments.** Added from the Files changed diff by hovering a line. The new page allows
  a comment on any line of a changed file ([default post][cl-files-default], Text). API:
  [review comments][rest-review-comments].
- **Formal reviews.** **Submit review** opens a panel listing pending comments, with
  **Comment**, **Approve** and **Request changes** ([Reviewing proposed changes][docs-review],
  Text). API: [reviews][rest-reviews].
- **Re-running checks.** [Rerequest a check run][rest-rerequest] for app checks, and [re-run
  failed jobs][rest-rerun-failed] for Actions. How the web merge box offers re-runs was not
  confirmed.

## What a 400 px companion can take from this

Everything in this section is inference, offered as input to the prototype.

- GitHub publishes no layout for a column this narrow. The nearest shipped designs are the
  Merge status panel and the Comments panel, which are both single-column strips docked at the
  right.
- The Overview page order maps onto one column without change: state line, readiness summary,
  description, comment box, comments newest first. The sidebar activity summary would have to
  fold into a row or a menu.
- The readiness summary's bottom row of Checks, Comments and Approvals cells is the compact
  signal GitHub chose. In the first cut the Checks cell can expand in place to the grouped
  list with failing checks first, which is what the generally available merge box does.
- The file tree and the diff do not fit side by side at this width. GitHub's own toolbar
  treats the tree as a panel that can be hidden, so a tree that swaps with the diff matches
  the source design.

## Not confirmed from a primary source

- Whether the new Files changed page has been declared generally available, and whether the
  classic opt-out is still offered today.
- Whether the Overview preview has become opt-out or default for anyone since 2026-11-05.
- Which bar is sticky on the Overview page, and its exact contents. The published images show
  a compact bar in more than one form.
- What clicking each cell of the readiness summary opens.
- Whether failing check groups are expanded by default. The images show it. No text says so.
- Where **Delete branch** and **Restore branch** sit on the Overview page after a merge.
- The exact set of timeline events that stay inline on the Overview page.
- The Commits tab layout, and whether the Checks tab has changed.
- When the **Findings** tab appears.
- Any narrow-window behaviour of the pull request page or the file tree.
- Colours, spacing and type sizes. They are read from dark-theme images only.

## Sources

Changelog posts are listed by date in their link text. All were read on 2026-11-14.

[cl-overview]: https://github.blog/changelog/2026-11-05-new-pull-request-overview-page-in-public-preview/
[cl-merge-status]: https://github.blog/changelog/2026-03-05-quick-access-to-merge-status-in-pull-requests-in-public-preview/
[cl-merge-preview]: https://github.blog/changelog/2024-12-03-improved-pull-request-merge-experience-now-in-public-preview/
[cl-merge-default]: https://github.blog/changelog/2025-02-12-improved-pull-request-merge-experience-enabled-by-default-in-public-preview/
[cl-merge-ga]: https://github.blog/changelog/2025-03-04-improved-pull-request-merge-experience-is-now-generally-available/
[cl-merge-april]: https://github.blog/changelog/2025-04-03-pull-request-merge-experience-march-31-update/
[cl-files-preview]: https://github.blog/changelog/2025-06-26-improved-pull-request-files-changed-experience-now-in-public-preview/
[cl-files-july]: https://github.blog/changelog/2025-07-31-pull-request-files-changed-public-preview-experience-july-31-updates/
[cl-files-sept]: https://github.blog/changelog/2025-09-11-pull-request-files-changed-public-preview-experience-september-11-updates/
[cl-overview-panel]: https://github.blog/changelog/2025-11-20-pull-request-files-changed-public-preview-november-20-updates/
[cl-files-commits]: https://github.blog/changelog/2025-12-11-review-commit-by-commit-improved-filtering-and-more-in-the-pull-request-files-changed-public-preview/
[cl-files-default]: https://github.blog/changelog/2026-01-22-improved-pull-request-files-changed-page-on-by-default/
[cl-files-feb]: https://github.blog/changelog/2026-02-05-improved-pull-request-files-changed-february-5-updates/
[cl-comments-panel]: https://github.blog/changelog/2026-02-19-access-all-pull-request-comments-without-leaving-the-new-files-changed-page/
[cl-panels]: https://github.blog/changelog/2026-03-19-view-code-and-comments-side-by-side-in-pull-request-files-changed-page/
[cl-whitespace]: https://github.blog/changelog/2026-10-22-pull-requests-saved-whitespace-preferences-and-improved-split-view/
[cl-stacks]: https://github.blog/changelog/2026-10-06-stacked-pull-requests-generally-available/
[cl-async-merge]: https://github.blog/changelog/2026-10-01-github-async-merge-api-generally-available/
[cl-push-attribution]: https://github.blog/changelog/2026-10-12-push-attribution-public-preview/
[disc-overview]: https://github.com/orgs/community/discussions/212186
[disc-files]: https://github.com/orgs/community/discussions/163932
[disc-panels]: https://github.com/orgs/community/discussions/190095
[docs-prs]: https://docs.github.com/en/pull-requests/reference/pull-requests
[docs-checks]: https://docs.github.com/en/pull-requests/reference/status-checks
[docs-merges-ref]: https://docs.github.com/en/pull-requests/reference/pull-request-merges
[docs-merge]: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request
[docs-close]: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/closing-a-pull-request
[docs-automerge]: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request
[docs-merge-queue]: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue
[docs-review]: https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request
[docs-stage]: https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-stage-of-a-pull-request
[docs-delete-branch]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/deleting-and-restoring-branches-in-a-pull-request
[docs-autodelete]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches
[docs-shortcuts]: https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts
[rest-get-pr]: https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
[rest-update-pr]: https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request
[rest-files]: https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files
[rest-merge]: https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
[rest-merge-async]: https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously
[rest-merge-async-result]: https://docs.github.com/en/rest/pulls/pulls#get-the-result-of-an-asynchronous-merge
[rest-update-branch]: https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch
[rest-timeline]: https://docs.github.com/en/rest/issues/timeline#list-timeline-events-for-an-issue
[rest-list-comments]: https://docs.github.com/en/rest/issues/comments#list-issue-comments
[rest-create-comment]: https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
[rest-check-runs]: https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference
[rest-annotations]: https://docs.github.com/en/rest/checks/runs#list-check-run-annotations
[rest-rerequest]: https://docs.github.com/en/rest/checks/runs#rerequest-a-check-run
[rest-status]: https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference
[rest-job-logs]: https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run
[rest-rerun-failed]: https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run
[rest-delete-ref]: https://docs.github.com/en/rest/git/refs#delete-a-reference
[rest-review-comments]: https://docs.github.com/en/rest/pulls/comments
[rest-reviews]: https://docs.github.com/en/rest/pulls/reviews
[gql-pr]: https://docs.github.com/en/graphql/reference/pulls#object-pullrequest
[gql-timeline]: https://docs.github.com/en/graphql/reference/pulls#union-pullrequesttimelineitems
[gql-merge]: https://docs.github.com/en/graphql/reference/pulls#mutation-mergepullrequest
[gql-close]: https://docs.github.com/en/graphql/reference/pulls#mutation-closepullrequest
[gql-automerge]: https://docs.github.com/en/graphql/reference/pulls#mutation-enablepullrequestautomerge
[gql-add-comment]: https://docs.github.com/en/graphql/reference/issues#mutation-addcomment
[gql-delete-ref]: https://docs.github.com/en/graphql/reference/git#mutation-deleteref
[gql-rollup]: https://docs.github.com/en/graphql/reference/commits#object-statuscheckrollup
[gql-status-context]: https://docs.github.com/en/graphql/reference/commits#object-statuscontext
[gql-check-run]: https://docs.github.com/en/graphql/reference/checks#object-checkrun
[cli-view]: https://cli.github.com/manual/gh_pr_view
[cli-comment]: https://cli.github.com/manual/gh_pr_comment
[cli-checks]: https://cli.github.com/manual/gh_pr_checks
[cli-diff]: https://cli.github.com/manual/gh_pr_diff
[cli-merge]: https://cli.github.com/manual/gh_pr_merge
[cli-close]: https://cli.github.com/manual/gh_pr_close
[cli-ready]: https://cli.github.com/manual/gh_pr_ready
[cli-update-branch]: https://cli.github.com/manual/gh_pr_update-branch
[cli-run-view]: https://cli.github.com/manual/gh_run_view
[cli-api]: https://cli.github.com/manual/gh_api
