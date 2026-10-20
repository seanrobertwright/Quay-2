# Swarm 1: Paste-one-prompt fixture

::: step

## 1. Get the starter project

::: do
1. Unzip the starter project and add it in Quay.
:::

::: see
The project in the rail.
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
The agent answers.
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
The agent answers.
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
The agent answers.
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
Every test passes.
:::

::: done
- ✅ Every test passes.
:::

:::
