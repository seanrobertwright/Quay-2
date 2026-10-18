# ADR 0005: Quay-Native Factory Engine; Praxis Sidecar Deferred

- **Status**: Accepted
- **Date**: 2026-10-18
- **Supersedes**: [ADR 0001](0001-machina-praxis-supervised-sidecar.md)
- **Amends**: [ADR 0002](0002-dual-protocol-mcp-and-a2a-agent-interface.md), [ADR 0003](0003-two-tier-holdback-validation-pipeline.md), [ADR 0004](0004-factory-station-operator-cockpit.md)

## Context

The first Factory Station build showed hardcoded data: seeded work orders, stage costs, gate verdicts, a fixed sidecar origin and PID label, an invented merge commit, and a mutation-calibration report that never ran anything. Accept, hold resolution and epoch recovery changed labels without touching git or running checks.

Driving the real Praxis engine (`@aiws/engine`) as ADR 0001 describes needs TLS material, an identity adapter, an owner bootstrap, and a translation from work orders into Praxis `CodingPlan`s before Quay can drive its control API. That is several sessions of work. The decision on 2026-10-18 was to make the factory real inside Quay first.

## Decision

Quay's Rust backend (`src-tauri/src/slices/machina/`) runs the factory itself. Nothing on the Factory Station is simulated.

- **State.** `MachinaManager` keeps work orders in memory and writes them to `%LOCALAPPDATA%\Quay2\machina\state.json` after every change. There is no SQLite database and no sidecar process.
- **Epoch.** The epoch counts Quay starts. At startup, work orders that were scaffolding or gating become `INTERRUPTED` and can be resumed.
- **Config.** Each repository describes its gate in `.machina/factory.json` (`setup`, `tier1`, `tier2`, `protectedPaths`, `outOfScope`, `timeoutSec`), parsed by `config::parse_config`. The gate reads it from the main checkout, never from a worktree. `.machina/holdbacks/**` and `.machina/factory.json` are always protected. Its commands run only after the operator approves that exact file. Quay stores the file's SHA-256 per repository when the operator saves or approves it. Scaffold and gate refuse to run setup, Tier 1 or Tier 2 commands from any other version, so a cloned repository or an edited file cannot run commands nobody reviewed.
- **Scaffold.** `git worktree add` creates `machina/wo-<n>` under `.machina/worktrees/` (added to `info/exclude`). The main checkout's `.machina/holdbacks/` is copied to `%LOCALAPPDATA%\Quay2\machina\vault\<id>\files` and pinned with SHA-256. Tracked holdbacks are hidden from the worktree with skip-worktree. Setup commands then run.
- **Author.** The operator launches the author agent in the worktree and sends it a brief. Claude Code authors finish by calling the MCP tool `machina_submit_deliverable`.
- **Gate** (`gate::run_gate`). The gate commits the candidate, then checks every file changed since the base commit against the allowed and protected paths. It runs the pre-PR audit, then the Tier 1 commands. Only when Tier 1 is green does it restore the vault (after re-checking its hash), run the Tier 2 commands, and remove the holdbacks again. Tier 2 output reaches the author only as `HOLDOUT_FAIL:` lines. A failing candidate is `FAIL`; a gate that cannot judge (no Tier 1 checks, timeout, git or audit error) is `INCONCLUSIVE`.
- **Corrections.** Feedback is written to `.machina/feedback/attempt-<n>.md` in the worktree. It is never committed. When the author called the gate over MCP, the verdict is typed into its terminal.
- **Holds** are raised only by real conditions: `SCOPE_DRIFT`, `PROTECTED_PATH_OVERLAP`, `MAX_CORRECTIONS_EXCEEDED`, `GATE_INCONCLUSIVE`, `BUDGET_EXCEEDED`, `AGENT_SUBMITTED`. Only a human resolves them; no MCP tool can.
- **Merge.** Accept squash-merges the gated commit into the base branch in the main checkout. That checkout must be on the base branch with no uncommitted tracked changes. The worktree is then removed and the branch kept.
- **Spend** is priced from Claude Code transcripts for the worktree, using the same pricing as the token meter. Other agents show as unmeasured.
- **Loop.** `PAUSED` keeps queued work orders waiting. `HALTED` cancels running scaffolds and gates, sends Ctrl+C to author terminals, and refuses new work orders.
- **Agent interface.** The MCP tools are `machina_submit_work_order`, `machina_get_work_order` and `machina_submit_deliverable`. The agent card at `/.well-known/agent.json` describes those skills. A work order an agent submits waits on an `AGENT_SUBMITTED` hold; nothing is created or run until a human admits it.

## Consequences

- Removed: credential leases, `CREDENTIAL_REQUIRED` and `PRICE_REQUIRED` holds, the TLS origin, mutation calibration, the `MISSION.md` bootstrap writer, and agent-side hold resolution. They return only with a real implementation.
- Holdbacks are hidden from the worktree, not sandboxed. An agent with unrestricted disk access can still find the vault. Committed holdbacks stay readable through git history; the UI warns about this.
- Budgets only stop Claude Code runs, because no other agent's spend is measured.
- The Praxis sidecar (ADR 0001) remains the target for the governance features listed under "Removed".
