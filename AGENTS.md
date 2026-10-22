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
