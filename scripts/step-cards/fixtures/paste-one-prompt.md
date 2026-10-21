# Swarm 1: Paste-one-prompt fixture

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

::: do
1. Unzip the starter project and add it in Quay.
:::

::: see
![The project in the rail.](./01-shot.webp)
:::

:::

::: step

## 2. Paste two prompts

::: paste `asker`
```text
Say hello.
```

```text
Say goodbye.
```
:::

::: see
![The agent answers.](./02-shot.webp)
:::

::: must
- A greeting.
:::

::: may
- The wording.
:::

:::

::: step

## 3. Paste a prompt over two lines

::: paste `asker`
```text
Say hello,
then say goodbye.
```
:::

::: see
![The agent answers.](./03-shot.webp)
:::

::: must
- A greeting.
:::

::: may
- The wording.
:::

:::

::: step

## 4. Paste prose instead of a prompt

::: paste `asker`
Ask the agent to say hello.
:::

::: see
![The agent answers.](./04-shot.webp)
:::

::: must
- A greeting.
:::

::: may
- The wording.
:::

:::

::: step

## 5. Check it worked

::: do
1. Run `npm test`.
:::

::: see
![Every test passes.](./05-shot.webp)
:::

::: done
- ✅ Every test passes.
:::

:::

::: next
[Swarm 2: TDD Swarm kata](/tutorials/swarm/tdd-swarm-kata/)
:::
