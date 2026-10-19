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
Scripted Quay state (sessions, settings, spend figures) used only to capture screenshots, never handed to a learner.
_Avoid_: Starter, sample data

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
\n**Clip**:\nA short, silent recording of Quay in motion that a step card may show in You should see alongside its screenshot, when the lesson is a sequence a still can't show. A tutorial has at most one, and it runs at real speed for ten seconds or less.\n_Avoid_: GIF, video, animation, screencast\n
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

### The A2A bus

**Peer**:
An agent terminal on the A2A bus. Every peer can be sent a message. A peer is either a full peer or a listener. An Archon terminal is not a peer: it runs a workflow and has no prompt for a message to land in.
_Avoid_: Node, participant, member

**Full peer**:
A peer that can send messages, answer a sender who waits for its reply, and show whether it is working or idle.
_Avoid_: A2A-enabled agent, first-class agent

**Listener**:
A peer that can be sent a message but can't answer. A sender who waits on a listener gets no reply.
_Avoid_: Receive-only agent, passive agent, half peer

**Reply**:
A full peer's answer, handed straight back to the sender who waited for it. A reply only carries an answer that is ready before the sender stops waiting.
_Avoid_: Response, return value, turn output

**File mailbox**:
A file one peer writes for another to read, used when a reply can't carry the answer: the peer is a listener, or the work outlasts the wait for a reply.
_Avoid_: Handoff file, drop file, shared file

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
