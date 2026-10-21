# Quay Tutorials

The language of the Swarm and A2A tutorial series: step-by-step, screenshot-led
walkthroughs that teach Quay's Swarm launcher and A2A bus.

## Language

**Tutorial**:
One step-by-step walkthrough in the series, from getting its starter project to its check-it-worked step.
_Avoid_: Lesson, guide, walkthrough

**Starter project**:
The folder a learner copies onto their machine in a tutorial's first step and opens in Quay as their project. Every tutorial has one.
_Avoid_: Sample repo, template, scaffold, fixture

**Check-it-worked step**:
A tutorial's last step, where the learner confirms the agents reached the tutorial's goal.
_Avoid_: Verification step, final test

**Check suite**:
Tests a tutorial keeps from its agents and hands to the learner only at the check-it-worked step. Only some tutorials have one.
_Avoid_: Hidden tests, regression suite, answer key

**Fixture**:
Scripted Quay state used only to capture screenshots and never handed to a learner: a settings or spend folder, or a recording of one terminal's whole run of a tutorial, played back in place of a live agent.
_Avoid_: Starter, sample data, mock, replay data

**Step marker**:
The named point in a fixture's recording where one step of the tutorial begins. Its name is the name of that step's screenshot, and the step card's You should see slot shows it.
_Avoid_: Timestamp, checkpoint, bookmark

**Step card**:
One numbered step of a tutorial as it appears on the page: a card whose content sits in named slots, always in the same order. Every step is a step card, including the check-it-worked step.
_Avoid_: Step block, step box, section

**Slot**:
A named part of a step card that holds one kind of content. A step card fills only the slots its step needs.
_Avoid_: Field, part, region

### Slots

In the order they appear on a step card.

**Do**:
The slot listing the actions the learner takes in Quay, numbered. Every step card has Do, Paste, or both.
_Avoid_: Instructions, actions

**Paste**:
The slot holding one copy-paste prompt, a single line, and naming the pane it goes into.
_Avoid_: Prompt box, snippet, code block

**You should see**:
The slot holding the step's screenshot, captioned with what it shows. Every step card has one.
_Avoid_: Expected output, result, screenshot slot

**Clip**:
A short, silent recording of Quay in motion that a step card may show in You should see alongside its screenshot, when the lesson is a sequence a still can't show. A tutorial has at most one, and it runs at real speed for ten seconds or less.
_Avoid_: GIF, video, animation, screencast

**Must match**:
The slot listing what the learner's run must share with the screenshot. It always comes with May differ, and every step card whose screenshot shows agent output has the pair.
_Avoid_: Expected result, success criteria

**May differ**:
The slot listing what can vary between the learner's run and the screenshot, such as an agent's wording or how long it takes. It always comes with Must match.
_Avoid_: Your output will differ, caveats

**If not**:
A collapsible fix in a step card, headed by the symptom the learner sees when the step goes wrong. A step card can have any number of them, including none.
_Avoid_: Troubleshooting, FAQ, gotcha

**You're done when**:
The slot listing what must be true for the tutorial to count as finished. Only the check-it-worked step has it, and there it is required.
_Avoid_: Pass criteria, success criteria, definition of done

### The Swarm launcher

**Role prompt**:
The text a swarm's author writes for one agent, saying who it is, what it owns, what it leaves to teammates and how it works. Built-in presets carry one per agent; a custom swarm's is optional.
_Avoid_: System prompt, persona, instructions

**Team briefing**:
The part of a launch prompt that Quay generates at launch: each teammate's session name and role, and the `quay_*` tools for agents that have them. Never written by hand.
_Avoid_: Roster, context block, preamble

**Launch prompt**:
Everything an agent CLI receives as its first turn when a swarm launches: a role line, the role prompt, the team briefing and the instruction to confirm its role and wait. Passed on the command line, never typed into the terminal.
_Avoid_: Initial prompt, kickoff prompt, seed prompt

**Built-in preset**:
A swarm that ships with Quay and appears in the launcher for every user. Its agents, layout and role prompts live in the code, and the docs list them from there.
_Avoid_: Default swarm, stock preset, template

**Custom swarm**:
A swarm the user assembles in the launcher's builder and can save on their own machine. It appears only in their launcher.
_Avoid_: User preset, saved swarm, personal preset

### The A2A bus

**Mission Control**:
The panel where the user sends a peer a message, broadcasts to peers and reads the trail of messages on the A2A bus. It is the panel's one name: its header, the rail tooltip and the command palette all say Mission Control. `Ctrl+B M` opens it and `Esc` closes it.
_Avoid_: A2A Orchestration Bus, Agent-to-Agent (A2A) Bus, A2A panel, operator modal

**Peer**:
An agent terminal on the A2A bus. Every peer can be sent a message. A peer is a full peer, a responder or a listener. An Archon terminal is not a peer: it runs a workflow and has no prompt for a message to land in.
_Avoid_: Node, participant, member

**Full peer**:
A peer that can send messages, answer a sender who waits for its reply, and show whether it is working or idle.
_Avoid_: A2A-enabled agent, first-class agent

**Responder**:
A peer that can answer a sender who waits for its reply and show whether it is working or idle, but can't send messages, so it never starts a conversation. Antigravity is a responder.
_Avoid_: Answer-only agent, semi-peer

**Listener**:
A peer that can be sent a message but can't answer. A sender who waits on a listener gets no reply. A Claude Code peer counts as a listener while Quay hasn't heard from its event-bridge plugin.
_Avoid_: Receive-only agent, passive agent, half peer

**Event-bridge plugin**:
The Claude Code plugin, installed by the learner, that tells Quay what a Claude Code peer is doing. Without it, a Claude Code peer can be sent messages but can't answer them, and Quay can't show whether it is working.
_Avoid_: Mod, claude-mod-events, the bridge

**Plugin hint**:
The one-line notice a Claude Code pane shows when Quay hasn't heard from that pane's event-bridge plugin, giving the install line and how to load it. It goes away the moment the plugin is heard.
_Avoid_: Missing-plugin warning, plugin error, install banner

**Reply**:
A full peer's or a responder's answer, handed straight back to the sender who waited for it. A reply only carries an answer that is ready before the sender stops waiting. When nobody waited, the trail calls the peer's response an answer.
_Avoid_: Response, return value, turn output

**Answer**:
What a peer said in its first turn after a message nobody waited on, a message sent without waiting or a broadcast. Mission Control's trail records it; the sender never sees it.
_Avoid_: Reply (when nobody waited), reaction, response

**File mailbox**:
A file one peer writes for another to read, used when a reply can't carry the answer: the peer is a listener, or the work outlasts the wait for a reply. The sender names the file and its last line when it sends the job. The job is done when the peer is Idle and the agreed last line is in the file; Idle alone only says a turn ended. A listener stays Unknown, so for a listener the last line alone says the job is done.
_Avoid_: Handoff file, drop file, shared file

**Relay**:
A chain of messages sent without waiting, where each peer passes the next step on with a new message.
_Avoid_: Pipeline, handoff chain, daisy chain

**Broadcast**:
One line typed at once into every other peer in the sender's project. Nobody waits on a broadcast, so it gets no reply; each peer's answer shows only in the trail. A broadcast sent from Mission Control reaches every peer in the active project.
_Avoid_: Announcement, alert, notice (except the literal `[Broadcast Notice]:` prefix)

### Testing a tutorial

**Test run**:
One complete pass through a tutorial by a person following only its rendered page, from getting the starter project to the check-it-worked step. A tutorial is published only after a test run passes, and the run measures the Time and Tokens the page shows.
_Avoid_: Dry run, playtest, QA pass

**Fresh-eyes read**:
An agent's reading of a tutorial page before its test run, listing every step that relies on something the page doesn't say. It reads; it never drives Quay.
_Avoid_: Review, lint, proofread

**Test account**:
The Windows user account where test runs happen. It holds only what tutorials' "Before you start" lists tell a learner to install, and Quay's own data is wiped before each run.
_Avoid_: Clean profile, test machine, sandbox

**Run fingerprint**:
A tutorial's identity as far as a test run is concerned: everything that changes what the learner and the agents do (its Do and Paste slots, its starter project and its check suite), and nothing that only changes how the page reads. Every test run is recorded against one fingerprint.
_Avoid_: Version, content hash, revision
