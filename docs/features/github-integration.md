# GitHub Companion & Dependency Triage

The **GitHub Companion Drawer** (`Ctrl+B I`) provides a keyboard-driven interface to triage issues, inspect pull requests, and resolve dependency blockers directly from Quay 2.

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
- Any issue blocked by an open issue displays a prominent red badge:  
  `BLOCKED by #102`
- If an issue is blocked by multiple issues across repositories, hovering over the badge lists all blocker numbers, titles, and repository names.
- Closed blockers are automatically ignored so you immediately know when an issue becomes unblocked.

---

## Filter Chips & Search

- **State Filter**: Switch between `Open` and `Closed` issues with one click.
- **Label Filters**: Instant filter chips populated with your repository's native labels (`bug`, `enhancement`, `priority`, etc.).
- **Live Search**: Instant client-side search filtering by issue title, number, author, or description.

---

## 1-Click Agent Dispatch

Inside any issue card:
- **"Implement with Claude"**: Creates a fresh worktree, branches from `master`, and spawns a Claude Code terminal pre-loaded with the issue description and requirements.
- **"Implement with Archon"**: Triggers an Archon SDD workflow to author specifications, tests, and code against the issue.
- **"Open in Browser"**: Launches the official GitHub issue page in your default browser.
