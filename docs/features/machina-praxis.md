# Machina Software Factory Cockpit

**Machina is Quay's local factory.** It runs inside Quay 2 on this machine, with no host, no sign-in and no browser. An agent does each piece of work, a **work order**, in its own git worktree; your project's own checks gate it; and you **Accept** it to squash-merge it into its base branch. Every decision on a work order is made in Quay.

Machina lives in the **Workflows panel** (`Ctrl+Shift+B R`). Its engine strip (`Ctrl+Shift+B F` focuses it) holds the Factory's **Active** or **Paused** switch, **Halt**, which needs a second press, and today's Factory spend. Work orders list under **Needs you** (on hold, awaiting merge, interrupted or failed), **Running** and **Recent**, each row with a segment bar of its stages. Picking one shows its decision in the companion's **Run** view; **Graph and log** opens its stages, gate report and events as the run lens. **New work order** and **Factory config** open in stage tabs from the panel's **Start** or the command palette.

## Machina is not Praxis

[Praxis](./praxis-builder.md) is the AI-WS-SDK's workflow engine, and it runs on a Praxis host. The two engines stay side by side and never mix (ADR 0006 in `.scratch/machina-praxis/adr/`):

| | Machina | Praxis |
| --- | --- | --- |
| Where it runs | In Quay, on this machine | On a Praxis host |
| Sign-in | None | `praxis login` |
| Its words | Work order, hold, Accept | Run, decision |
| Where you decide | In the companion's Run view | In the host's browser page |
| Its surface in Quay | The Workflows panel and the Run view | The Praxis Builder; its runs also list in the Workflows panel |

A Machina work order never becomes a Praxis run. The Workflows panel lists both engines' work side by side, each row marked with its engine, but a Praxis run's decision still opens in the browser.

---

## How a work order moves

```mermaid
flowchart LR
    Admission["Admission"] --> Scaffold["Worktree & vault"]
    Scaffold --> Author["Author agent"]
    Author --> Gate["Gate"]
    Gate -->|fails| Corrections["Corrections"]
    Corrections --> Author
    Gate -->|passes| Accept["Accept: squash-merge"]
```

1. **Admission.** Out-of-scope and protected-path checks, and the work orders it depends on.
2. **Worktree & vault.** Quay creates the branch `machina/wo-<n>` in a git worktree under `.machina/worktrees/`, copies `.machina/holdbacks/` to a vault outside the repository, hides the holdbacks from the worktree and runs the setup commands.
3. **Author agent.** You launch the author agent in the worktree and send it the brief.
4. **Gate.** The gate commits the candidate, checks the changed paths, runs the pre-PR audit and the Tier 1 commands, then, only when Tier 1 is green, the Tier 2 commands with the holdbacks restored. The author sees Tier 2 failures only as `HOLDOUT_FAIL:` lines.
5. **Corrections.** A failed gate goes back to the author, up to the work order's limit.
6. **Accept.** A work order whose gate passed offers **Accept: squash-merge into** its base branch. The main checkout must be on that branch with no uncommitted changes to tracked files.

Each repository describes its gate in `.machina/factory.json`. Its commands run only after you approve that exact file in **Factory config**.

## Holds

A hold stops a work order until you resolve it with one of its options in the companion's Run view. Machina raises one only for a real condition: scope drift, an overlap with a protected path, too many corrections, a gate that couldn't judge, a spent budget, or a work order an agent submitted that waits for you to admit it.

## Where Machina keeps its state

Work orders are kept in `%LOCALAPPDATA%\Quay2\machina\state.json`, and holdback vaults under `%LOCALAPPDATA%\Quay2\machina\vault\`. Machina counts Quay starts as epochs: work cut off by a restart is marked **Interrupted**, lists under **Needs you**, and can be resumed from the Run view.
