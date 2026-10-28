# Tutorials

Step-by-step walkthroughs that teach Quay by doing. The Swarm series launches teams of agents side by side; the A2A series has those agents message each other over the A2A bus. Each tutorial starts from a small starter project and ends when you check that the agents reached its goal.

Every screenshot and clip in these tutorials comes from a real run of that tutorial, recorded and replayed for capture.

<!-- tutorials:start -->
## Swarm

| # | Tutorial | What you'll do |
| --- | --- | --- |
| 1 | [Your first swarm](/tutorials/swarm/first-swarm/) | Launch Dev & Watcher and watch a Claude Code agent build a tip calculator while its tests go green. |
| 2 | [TDD Swarm kata](/tutorials/swarm/tdd-swarm-kata/) | Build a password-strength checker test-first, driving a tester, an implementer and a reviewer one pane at a time. |
| 3 | [Full-Stack Pair: bookmarks app](/tutorials/swarm/full-stack-pair/) | Have two agents build a bookmarks app's API and React UI side by side, then open it in your browser. |
| 4 | [Build and save a custom swarm](/tutorials/swarm/custom-swarm/) | Build a two-agent Docs Squad in the swarm builder, save it, and launch it again after a restart. |
| 5 | [Bug Hunt](/tutorials/swarm/bug-hunt/) | Hand a bug report to four agents that reproduce, trace, patch and verify each bug in turn. |
| 6 | [Red Team / Blue Team: notes app](/tutorials/swarm/red-team-blue-team/) | Pit an attacking agent against a defending one on a notes app, then let the Pre-PR Audit Gate catch what both missed. |
| 7 | [JS to TypeScript migration](/tutorials/swarm/js-to-typescript/) | Have three agents convert a JavaScript project to TypeScript, one folder each, while `tsc --watch` counts the errors down to zero. |
| 8 | [Tri-Agent Council: plan, build, verify](/tutorials/swarm/tri-agent-council/) | Have a planner, a builder and a verifier take a Markdown link checker from spec to verdict. |
| 9 | [Polyglot Trio](/tutorials/swarm/polyglot-trio/) | Have Antigravity plan, Claude Code build and Codex review a CSV-to-JSON converter, passing work over the A2A bus. |
| 10 | [Parallel experiments with worktrees](/tutorials/swarm/parallel-worktrees/) | Try two designs at once in two git worktrees, measure them, merge the winner and throw the loser away. |

## A2A

| # | Tutorial | What you'll do |
| --- | --- | --- |
| 1 | [Hello, A2A](/tutorials/a2a/hello-a2a/) | Send an agent a message from Mission Control, then watch one agent ask another a question and wait for the reply. |
| 2 | [Contract-first handoff](/tutorials/a2a/contract-first-handoff/) | Have two agents agree a notes app's API over the A2A bus before either builds its half. |
| 3 | [Hands-off TDD relay](/tutorials/a2a/tdd-relay/) | Type one prompt and watch a test writer hand failing tests to an implementer, who reports back when they pass. |
| 5 | [Fan-out / fan-in](/tutorials/a2a/fan-out-fan-in/) | Have a lead agent split a static-site generator across three workers at once, then wire their parts together. |
| 6 | [Long jobs: fire, then poll](/tutorials/a2a/fire-then-poll/) | Hand a three-minute benchmark to another agent without waiting, check on it, and collect the result from a file. |
| 10 | [Second opinion from Codex](/tutorials/a2a/second-opinion-codex/) | Have a Claude Code agent ask a Codex agent for a review, then fix every finding it writes down. |
<!-- tutorials:end -->
