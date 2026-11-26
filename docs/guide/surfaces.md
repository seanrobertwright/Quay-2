# Agent Surfaces

A **surface** is one piece of UI that an agent describes to Quay through a tool call. Quay draws it with its own components beside the agent's terminal, and your answer goes back to that agent.

[Surfaces](../features/agent-support.md#surfaces) in Supported Agent CLIs lists the CLIs that can show them. Antigravity can once you [connect it](#connect-antigravity); the others need no setup.

---

## What an Agent Can Show

| Kind | Tool | What it is | Where it shows |
| :--- | :--- | :--- | :--- |
| **Question** | `quay_ask` | Up to four questions, each with a text box and, when the agent gives them, options, and one **Send** | The companion's **Surface** view |
| **Review** | `quay_review` | A text to read, items to keep or drop, a comment and three verdicts | A stage tab |
| **Board** | `quay_board` | How a long run stands: steps, progress and stats | A line on the terminal's pane |
| **Raw surface** | `quay_surface` | Anything else, as A2UI 1.0 messages in Quay's own catalog of components. Quay labels it **Surface** | Where the agent asks: the Surface view, a stage tab or a line on the pane |

An agent has two more tools. `quay_surface_guide` returns how to write a raw surface, and `quay_surface_read` returns where one of the terminal's surfaces stands. [The surface tools](../features/a2a-orchestration.md#the-surface-tools) lists what each one takes.

Quay checks each call before it draws anything. A call with something wrong in it is rejected whole, and you see nothing of it.

### A Question

- With one question, its options and text box show at once. With more, all are listed and one is open; **Next** opens the one after it.
- An option may carry **agent's pick**, the agent's recommendation. Nothing is picked for you.
- **Send** is held until you have opened every question and answered it. A question you may pick several options of can be sent with none.

### A Review

- The text and the decision stand side by side, or one under the other on a narrow stage.
- Untick an item to drop it. The approve button then says so, for example **Approve without 2 items**.
- **Request changes** is held until you write a comment. The three buttons' words are Quay's, not the agent's.

### A Board

- The line shows the board's title, the current step, how far it is and a clock. A running board with no update for two minutes says when it had its last.
- Click the line to open the board over the terminal, which keeps its size. Click it again to fold it.
- A board asks for nothing. The newest finished one keeps its line, and the rest fold under **finished earlier**.

### A Raw Surface

A raw surface in the companion has a control in its header, **Open as a stage tab**. The same control there, **Send back to the companion**, brings it back.

---

## How Your Answer Reaches the Agent

1. The agent's call waits up to 100 seconds. An answer in that time is the call's result, and the agent carries on in the same turn.
2. After that, the surface stays up and you can still answer. The answer is typed into the terminal as one line, `[Quay surface "<title>" (<id>)]: <answer>`, the way a message on the [A2A bus](../features/a2a-orchestration.md#how-a-message-is-delivered) is.
3. The wait also ends early when the agent's call is cancelled or its connection closes, when the terminal's own turn ends, and, in a Codex terminal, when you press `Esc`. You can still answer then, too.

A surface takes one answer, and one more each time its agent reopens it. If the agent changed it after you last saw it, your answer isn't sent: Quay draws the new one and asks you to check it and send again.

The **×** in a surface's header dismisses it, as closing its stage tab does. An agent whose surface still asks is told that you dismissed it. One whose surface asks nothing is told only if it sends something for that surface again.

---

## How You See That One Waits

- **Companion:** when a question of the selected terminal arrives, the companion shows the **Surface** view. While the Activity or Run view shows a card you haven't decided, it stays there, and **Surface** on the view switch gets an amber dot. Once the last question settles, the companion returns to the view it showed before. Selecting a terminal with a question opens the Surface view, or Activity if a permission request waits too.
- **Several questions:** the oldest is open and the others are lines with how long each has waited. Click a line to open it.
- **Stage tab:** a review's tab pulses and never takes the stage by itself.
- **Projects panel:** the terminal's row has a chip for each live surface, oldest first. Past three, the ones that ask come first, and those after the third fold into one chip, such as **+2**, which opens the first of them. An amber dot sits on the CLI's icon while one asks.
- **Pane title:** a button such as **1 question for you** counts the terminal's asking surfaces, reviews included, and opens the oldest.
- **Agents panel:** an asking surface is a row under **Waiting on you**. It counts on the **Agents** icon, and `Ctrl+Shift+B Q` finds its terminal.

The terminal keeps its own status beside all of these, so you still see that it is working. Surfaces raise no toast.

---

## The Frame

Quay draws a **frame** around every surface. What the agent wrote is clipped to the box inside it. A board's line is Quay's own, and opens the board in its frame.

- **The header bar** shows an icon for the kind of surface, the CLI's icon, the terminal's name and the CLI's name. The dismiss and move controls are there.
- **The line under the header** is Quay's: that the surface was answered, done, failed, ended, withdrawn or reopened, and when.
- **The foot** shows where a link leads, in full, while the pointer or the focus is on it. It is also where Quay says why a click did nothing. A web link in the text has its host beside it as well.

---

## The Quay Mark

Quay asks for decisions too, on its own cards: a permission request in the Activity view, and each decision in the Run view. These are **Quay cards**, never surfaces, and they carry the **Quay mark**: an edge and glow in your accent colour, and a **QUAY** badge in the card's title line. In a lens, the badge stands alone.

Quay never draws the mark on an agent surface. Quay's lint keeps the module that holds Quay's catalog, whose components draw a surface's content, from importing the code that draws cards, and nothing in the catalog draws the mark. An agent can write the word QUAY, as it can write any other text, and it can show a picture of a Quay card, with the mark in the picture. Both stay inside a frame that names the agent's terminal. Keyboard focus also rings a control in the accent colour, in a surface as anywhere else in Quay. So look for the badge, and for where it is: **what is inside a frame is the agent's.** A button there only sends your answer to that agent or does what [its click may do](#what-a-surface-may-do). It can't approve a permission request.

**What the mark proves.** On a card outside any frame, that Quay drew the card.

**What it doesn't prove.** That the CLI itself raised the permission request. The processes in a terminal hold that terminal's token, so an agent can post a request in its own terminal's name. The answer goes back to whoever posted it, so the agent gains no approval, with one exception: **Allow for session** then covers that tool for that terminal. A request in another terminal's name is refused.

On a Quay card, text that Quay didn't write is set apart in a labelled box, such as **fix-75 says**, and shown as plain text with no links.

---

## What a Surface May Do

Showing a surface runs nothing and makes no network request. All that Quay reads for it is its images, from this computer. Nothing opens, is copied or changes the selected terminal unless you click.

| On your click | What happens |
| :--- | :--- |
| A web link or button | Your browser opens it. Only `http` and `https` addresses open |
| A file link or button | The file manager shows the file in its folder, or the diff view opens in the Topos lens when the file has uncommitted changes. While Topos's conflict resolver is open, the file waits until you close it, and a Topos notification says so. In the lens, `Esc` goes back from the diff to the graph, then closes the lens. The file's own program never starts |
| A button that shows a terminal | Quay selects that terminal, in the same project only |
| A button that copies | The text goes to the clipboard |

This is the same under **Skip Permissions** and **Interactive Approvals**. A surface can never run a command or prompt another terminal. All its buttons can send is your answer, to its own agent.

- **Paths** are read relative to the terminal's working directory, or absolute. Quay refuses a network path before it touches it: `\\host\share`, a mapped network drive, or a symbolic link that leads to one.
- **Images** are local PNG, JPEG, GIF or WebP files. Quay shows a small box in place of any other, with its description, the reason and its address.

---

## A Surface's Life

| What happens | What you see |
| :--- | :--- |
| You answer, or a board is done or failed | It locks, with your answer or the board as it ended |
| The agent takes back a surface that still asks | It locks as **Withdrawn** |
| The terminal exits first, or is relaunched | It locks as **Ended** |
| The agent updates a raw surface you answered | It reopens, with **Reopened by the agent** and your earlier answer |
| You close the terminal | All its surfaces go |
| Quay restarts | There are none |

Locked surfaces fold under **Earlier**: beneath the questions in the Surface view, and in a menu on the stage tab bar once you leave their tabs. The fold in the Surface view has **Dismiss all**.

What you type and haven't sent is kept while you switch terminals, move a raw surface or reload the window. On a surface that ended or was withdrawn, the text you typed stays, with **Copy**. None of this is written to disk.

### Limits

| What | Limit |
| --- | --- |
| Live surfaces of one terminal | 4 in the Surface view, 4 in stage tabs and 4 on its pane |
| Locked surfaces of one terminal | 10; past that, the one that locked or changed longest ago goes |
| Components in a surface | 500 |
| Components drawn at once | 2,000, at first with 100 rows of each list, and by each press of **Show more** |
| Components with every row drawn | 10,000 |
| Data in a surface, and what you typed in it and haven't sent | 256 kB each |
| Images in a surface | 12, each up to 10 MB |

A component is counted each time it is drawn, so a list inside a list counts for each of its rows. An option, a step and a tab count as one each, and so does every 250 characters of a text that comes from the surface's data or is drawn more than once. Markdown with many list items or links, wherever it comes from, many bindings and calls in one component, long ids and paths, and rows with much data count for more than one too; the guide that agents read says by how much, and a rejected call says which of them it was.

A call past a limit is rejected, never cut short, and the agent is told why. What you pick or type in a raw surface can make a list in it longer too. Quay doesn't take it when the surface would then be past what it may have drawn, and says so at the foot of the frame. Where an agent's update leaves no room for something you put in, Quay leaves only that out, says so at the foot of the frame, and puts it back when a later update has room for it, unless you put something else in its place. When four questions wait, the Surface view says that it is the most one terminal may have. Moving a raw surface to a stage tab doesn't change which limit it counts against.

---

## The Surface Record

Quay keeps a record of what became of each surface, without its content. It is one file a day, `surfaces.<date>.jsonl`, in `%LOCALAPPDATA%\Quay2\surfaces`. A day's file is kept for 30 days, and a day starts at midnight UTC. **Open logs folder** in the command palette shows the `logs` folder, which `surfaces` is beside. Quay has no viewer for it.

Each line of the file is one event in JSON: `shown`, `updated` (at most one a minute for a surface), `answered`, `dismissed`, `deleted`, `withdrawn`, `ended`, `function fired` or `rejected`.

| On | The line holds |
| :--- | :--- |
| Every event | The time, the event, the terminal's id and name, the CLI, the tool, and the surface's id, title and place, as far as they are known |
| `answered` | The option labels you chose, the verdict, or the name of the button's action. Never what you typed |
| `function fired` | What you clicked did, and its target: the address, the path or the terminal. Never the text that was copied, or a target's part that you typed |
| `rejected` | Each error's code and place in the call, and how many calls of that tool in a row were rejected. Never the call's content |

A title is the agent's own words, and for a question it is the first question.

---

## Connect Antigravity

Claude Code, Codex, OpenCode and PiG get Quay's tools when Quay starts them. Antigravity reads its MCP servers from its own configuration file only, so Quay asks first:

1. Press `Ctrl+Shift+B T` to open the **Project** panel, and find **Antigravity** in its **Quay · every project** group. Click it.
2. Read the file's path, `.gemini\config\mcp_config.json` in your home folder, and the exact entry Quay would add.
3. Click **Connect**. Quay adds that entry and changes nothing else in the file.
4. Relaunch any Antigravity terminal that is already open.

**Remove**, in the same place, takes the entry out again. Quay writes to the file only when you press one of these buttons, and leaves a file it can't parse as it is. The entry starts Quay's relay in every Antigravity session; outside Quay, the relay has no tools.

If the entry is gone when Quay next starts, or starts a relay that isn't this Quay's, a warning under the stage tab bar offers **Connect again**.

### When a Terminal Can't Show Surfaces

If a terminal's CLI hasn't connected to Quay's MCP server 60 seconds after it was launched, its pane's title gets an info button, **Why this terminal can't show surfaces**. It gives the reason and the remedy, such as **Connect Antigravity in Settings**, which opens the row above. A connected Antigravity gets its 60 seconds from its first prompt, because it starts its servers then. The button goes once the CLI connects.
