# Swarm 1: Must-may-agent-output fixture

::: glance
- **Time**
- **Tokens**
- **Agents** 1 × Claude
- **Level** Starter
:::

**You'll learn:** nothing; this page is a slot-check fixture.

::: before
## Before you start
- Quay 2 is installed.
:::

::: step

## 1. Get the starter project

::: do
1. Unzip the starter project and add it in Quay.
:::

::: see
![The project in the rail.](./01-shot.webp)
:::

:::

::: step

## 2. Ask the agent

::: paste `asker`
```text
Say hello.
```
:::

::: see
![The agent says hello, but nothing says what must match and what may differ.](./02-shot.webp)
:::

:::

::: step

## 3. Check it worked

::: do
1. Run `npm test`.
:::

::: see
![Every test passes.](./03-shot.webp)
:::

::: done
- ✅ Every test passes.
:::

:::

::: next
[Swarm 2: TDD Swarm kata](/tutorials/swarm/tdd-swarm-kata/)
:::
