# AGENTS.md

Follow the best-practices library at
[.agents/core-values/AGENTS.md](.agents/core-values/AGENTS.md).
Load the practice files it routes to before starting each task. This
project's own instructions and conventions take precedence over the library.

The library is vendored from
<https://github.com/seanrobertwright/core-values> at commit `b549136`. To
update it, copy `AGENTS.md`, `README.md`, `SOURCES.md`, `CONTRIBUTING.md`,
`.gitattributes`, and `practices/` from a newer checkout over
`.agents/core-values/`. It is a plain copy, not a git submodule, so it works
in every worktree without a submodule init.

## Running and debugging Tauri apps

Use the `agent-tauri` skill to run, attach to, inspect, or debug Quay or any
other Tauri app. Load it before you launch the app, take a screenshot, click
through the UI, call an IPC command, or read the app's logs. Do not write an
ad hoc Playwright or CDP script for a task the skill covers.
