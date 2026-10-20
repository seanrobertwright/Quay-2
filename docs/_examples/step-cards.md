# Swarm 1: Step-card example

<!-- Example tutorial page for the step-card containers. `pnpm docs:dev` serves it at
     /Quay-2/_examples/step-cards; `pnpm docs:build` leaves it out of the site. It is not a
     tutorial: it shows the page shape and every container, and the slot check tests read it
     as the page that follows every rule. -->

Two agents pass one message, so you can see every slot a step card has.

<div class="tutorial-glance">
  <div><span class="tutorial-glance__label">Time</span><span class="tutorial-glance__value">~10 min</span></div>
  <div><span class="tutorial-glance__label">Tokens</span><span class="tutorial-glance__value">~15k</span></div>
  <div><span class="tutorial-glance__label">Agents</span><span class="tutorial-glance__value">2 × Claude</span></div>
  <div><span class="tutorial-glance__label">Level</span><span class="tutorial-glance__value">Starter</span></div>
</div>

**You'll learn:** how a step card's slots read, from Do to You're done when.

## Before you start

<div class="tutorial-checklist">
  <label><input type="checkbox"> <span><strong>Quay 2</strong> is installed (<a href="/Quay-2/guide/installation">Installation & Setup</a>).</span></label>
  <label><input type="checkbox"> <span><strong>Claude Code</strong> is signed in. <code>claude --version</code></span></label>
  <label><input type="checkbox"> <span>You are using the <strong>starter project</strong>, because agents run in Skip mode and edit files without asking.</span></label>
</div>

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
A single PowerShell pane: the Starter commit, then `npm install` finished.
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
`asker` on the left, `answerer` on the right, both at Claude Code's prompt.
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
The message in Mission Control's trail, and `answerer` replying `144`.
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
`asker` quotes the reply.
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

<a class="tutorial-next" href="/Quay-2/tutorials/swarm/tdd-swarm-kata/">
  <small>Next up · Swarm 2</small>
  <strong>TDD Swarm kata →</strong>
  <span>The next tutorial in series order. A2A 10's card links back to the Tutorials landing page.</span>
</a>
