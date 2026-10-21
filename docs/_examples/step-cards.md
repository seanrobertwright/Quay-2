# Swarm 1: Step-card example

<!-- Example tutorial page for the step-card containers. `pnpm docs:dev` serves it at
     /Quay-2/_examples/step-cards; `pnpm docs:build` leaves it out of the site. It is not a
     tutorial: it shows the page shape and every container, and the slot check tests read it
     as the page that follows every rule. Each You should see holds the step's screenshot,
     ./NN-<what>.webp in this folder, and its alt text is the caption. Step 3 also has a clip:
     03-reply.mp4 beside 03-reply.webp plays in place of the still, so its caption says what
     moves. The images and the clip are placeholders. -->

Two agents pass one message, so you can see every slot a step card has.

::: glance
- **Time** ~10 min
- **Tokens** ~15k
- **Agents** 2 × Claude
- **Level** Starter
:::

**You'll learn:** how a step card's slots read, from Do to You're done when.

::: before
## Before you start
- **Quay 2** is installed ([Installation & Setup](/guide/installation)).
- **Claude Code** is signed in. `claude --version`
- You are using the **starter project**, because agents run in Skip mode and edit files without asking.
:::

::: step

## 1. Get the starter project

::: do
1. Download `example.zip` and unzip it into a new, empty folder.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell** and click **Start Terminal**.
:::

::: paste PowerShell pane
```text
git init -b main; git add -A; git commit -m Starter; npm install
```
:::

::: see
![A single PowerShell pane: the Starter commit, then npm install finished.](./01-starter-installed.webp)
:::

::: must
- `git commit` prints `Starter` as the message.
:::

::: may
- The package count and timings.
:::

::: ifnot node or npm is not recognised
Node 24 or later isn't on your PATH. Install it, then close and reopen Quay.
:::

:::

::: step

## 2. Open two Claude Code agents

::: do
1. Press `Ctrl+B N`, choose **Claude**, label it `asker` and click **Start Terminal**.
2. Press `Ctrl+B %`, then `Ctrl+B N` again, and label the second one `answerer`.
:::

::: see
![asker on the left, answerer on the right, both at Claude Code's prompt.](./02-two-agents.webp)
:::

:::

::: step

## 3. Send `answerer` a message from Mission Control

::: paste Mission Control
```text
What is 12 times 12? Answer with just the number, and nothing else, so the reply is easy to check at a glance even when it wraps onto a second line.
```
:::

::: see
![The message moves into Mission Control's trail, then answerer replies 144.](./03-reply.webp)
:::

::: must
- The trail shows `You → answerer`.
- `answerer` replies `144`.
:::

::: may
- How long the reply takes.
:::

::: ifnot the message never reaches answerer
`answerer` isn't a peer yet. Wait until its badge reads Idle, then send again.
:::

::: ifnot answerer asks for permission
That terminal was launched without **Skip**. Launch it again with **Permissions** set to **Skip**.
:::

:::

::: step

## 4. Check it worked

::: paste `asker`
```text
Tell me exactly what answerer replied in Mission Control's trail.
```
:::

::: see
![asker quotes the reply.](./04-asker-quotes.webp)
:::

::: must
- `asker` quotes `144`.
:::

::: may
- The wording around the number.
:::

::: done
- ✅ Mission Control's trail shows the message to `answerer` and its reply.
- ✅ `asker`'s pane quotes a reply of `144`.
:::

:::

::: next
[Swarm 2: TDD Swarm kata](/tutorials/swarm/tdd-swarm-kata/)

The next tutorial in series order. A2A 10's card links back to the Tutorials landing page.
:::
