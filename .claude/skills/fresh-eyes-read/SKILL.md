---
name: fresh-eyes-read
description: Run a fresh-eyes read of a built Quay 2 tutorial page, so a new agent that sees only the page reports where a newcomer would get stuck. Use before a tutorial is first published, after a change to its Do or Paste slots, on any pull request that changes a tutorial page's wording, or when asked for a fresh-eyes read of a tutorial.
---

# Fresh-eyes read

A fresh-eyes read covers the maintainer's blind spot: knowing Quay too well to notice what a tutorial page leaves out. A new agent reads only the built page and reports each place a newcomer would get stuck. It reads; it never drives Quay.

## When it runs

- Before a tutorial is first published, and after a change to its Do or Paste slots, its `starter/` or its `check/`.
- On any pull request that changes a tutorial page's wording.

It runs locally, never in CI, so no API key goes into GitHub.

## Run it

From the repo root, with Claude Code signed in:

```sh
pnpm docs:fresh-eyes docs/tutorials/<series>/<slug>/index.md
```

Name several pages to read each one; the site builds once. Add `--model <name>` to choose the reader's model; otherwise it uses the CLI's default model.

`scripts/fresh-eyes/read.ts` does the whole read, and this skill must not do any part of it by hand:

1. It runs `pnpm docs:build`, so the page passes the step-card checks and is read exactly as it will be published.
2. It extracts the built page's text, screenshots and alt text. A clip is shown as its still.
3. It hands only those to a new `claude -p` reader, with `scripts/fresh-eyes/brief.md` as the reader's whole system prompt. The reader runs in a new folder under the system temp folder that holds only what it is given. It has no tools, no user, project or local settings, no MCP servers and no `CLAUDE.md`. It sees no repo and no other tutorial.
4. It checks each finding's quote against the step it names and prints the findings.

Don't hand the page to a subagent of this session instead: a subagent inherits this session's `CLAUDE.md` and can read the repo, which is what the read must not have. Don't edit the brief to suit one page. It is fixed, and changes to it go through a pull request of their own.

## What it reports

Each finding names a step, quotes a line from it, and is one of four kinds:

- a prerequisite missing from "Before you start";
- a control or pane the page doesn't name or show;
- a term the page doesn't explain;
- an action open to two readings.

A quote the script can't find in its step is kept and marked, so check where it belongs.

## Record the findings

The script prints a `### Fresh-eyes findings` section. Put it in the pull request description. When a test run is recorded, it also replaces the `### Fresh-eyes findings` section of that run in `examples/tutorials/<slug>/test-runs.md`, which `pnpm docs:test-run <slug>` adds. Then work through it with the maintainer, and fill in each finding's Outcome: fixed, or dismissed with a reason. A fix that changes a Do or Paste slot changes the run fingerprint.

The script names the folder that holds what the reader was given (`page.md` and the images) and its `findings.md`. Open it when a finding seems to misread the page, to see what the reader saw.
