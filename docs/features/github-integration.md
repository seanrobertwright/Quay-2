# Source Control Panel & Dependency Triage

The **Source control** panel (`Ctrl+Shift+B I`, or the Source control icon on the module bar) lists the repository's pull requests and issues, so you can triage issues, inspect pull requests, and resolve dependency blockers directly from Quay 2. It also opens Topos, the repo-wide Diffs and the Pre-PR Audit.

---

## Native Dependency Resolution & Red `BLOCKED` Badges

In complex engineering projects, issues often depend on upstream prerequisites (e.g. "Database migration #102 must complete before User API #104 can start").

Quay 2 uses GitHub's GraphQL API to automatically resolve issue dependencies:

```graphql
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issue(number: $num) {
      blockedBy(first: 20) {
        nodes {
          number
          title
          state
          repository { nameWithOwner }
        }
      }
    }
  }
}
```

### Visual Blocker Badges
- Any issue blocked by an open issue shows a red tag in the issue list: `Blocked by 1`.
- The companion's Ticket view names each blocker; **Show the blocker** opens it there.
- Closed blockers are automatically ignored so you immediately know when an issue becomes unblocked.

---

## Filters & Search

- **Lists**: **Pull requests** or **Issues**, each with its own state filter.
- **State Filter**: `Open`, or `All` to include closed and merged ones.
- **Label Filter**: issues only, from the labels of the issues loaded so far.
- **Live Search**: filters by title or number, by head branch for pull requests and by label for issues.
- **Paging**: each list loads 50 rows at a time as you scroll, and stops at 500; filter to narrow a longer list.

---

## Opening a Pull Request or Issue in the Companion

Picking a row pins it to the selected terminal's terminal link and opens it in the companion: a pull request in the Pull request view, an issue in the Ticket view. With no terminal selected, the rows cannot be picked and the panel says so.

From the Ticket view, the **Implement** split button starts work on the issue: **Implement**, **Triage** or **New worktree**. A pull request that conflicts with its base has a button beside its row that runs Archon's conflict resolution workflow.
