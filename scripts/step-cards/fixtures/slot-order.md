# Swarm 1: Slot-order fixture

::: glance
- **Time** ~5 min
- **Tokens** ~5k
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

::: see
![The project in the rail, shown before the Do that gets it there.](./01-shot.webp)
:::

::: do
1. Unzip the starter project and add it in Quay.
:::

:::

::: step

## 2. Run the tests

::: do
1. Run `npm test`.
:::

::: see
![Every test passes.](./02-shot.webp)
:::

::: see
![A second You should see on the same step.](./02-shot.webp)
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

::: ifnot a test fails
Run `npm ci` first.
:::

::: ifnot npm is not recognised
A step can have any number of If nots.
:::

::: done
- ✅ Every test passes.
:::

:::

::: next
[Swarm 2: TDD Swarm kata](/tutorials/swarm/tdd-swarm-kata/)
:::
