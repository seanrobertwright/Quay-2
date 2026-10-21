# Contributing to Quay 2

We are excited to welcome contributors to Quay 2!

Please refer to the primary [Contributing Guide on GitHub](https://github.com/seanrobertwright/Quay-2/blob/master/CONTRIBUTING.md) for full details on:

- **Vertical Slice Architecture (VSA)** standards
- Setting up the Windows C++ MSVC & Rust toolchain
- Running `pnpm tauri dev`
- Verification suites (`pnpm tsc --noEmit`, `cargo test`)
- Code of conduct and PR submission checklist

---

## Quick Development Commands

```powershell
# 1. Install dependencies
pnpm install

# 2. Run Quay 2 in development mode
pnpm tauri dev

# 3. Run documentation locally
pnpm docs:dev

# 4. After adding a tutorial page, list it in the Tutorials tables of the docs and the README
pnpm docs:tutorials

# 5. Check the docs scripts and the step-card plugin, then build the documentation site
pnpm docs:typecheck
pnpm docs:test
pnpm docs:build

# 6. Before a tutorial's first test run, or when a pull request changes its wording:
#    a fresh-eyes read of the built page by a new agent that sees only the page
pnpm docs:fresh-eyes docs/tutorials/<series>/<slug>/index.md
```
