# AIWS and Praxis

AIWS is the standard for governed, human-approved, budget-limited AI workflows. Praxis is the engine that executes them. This glossary holds the terms the two share; it is a vocabulary, not a specification.

## Language

### Execution

**Work order**:
The durable assignment a human gives the engine. The same thing the SDKs call a mission.
_Avoid_: Mission (in engine text), job, project

**Run**:
One governed execution of a work order under a fixed definition revision, which belongs to that run alone. A run created from a workflow template also pins the template revision it came from.
_Avoid_: Session, execution, instance

**Workflow template**:
A named coding plan that the host operator keeps in the host's private configuration and the host reviews, with no work-order or run identities of its own. Its file in the host's template directory holds the bare template and nothing else, so a template copied from a repository is exactly what the host reviews. Each run of it is a new work order, created by the host with fresh identities; neither a client nor an agent can change what the template holds.
_Avoid_: Recipe, preset, workflow (on its own, for this meaning)

**Template revision**:
One numbered version of a workflow template's content. The host gives the next number whenever it finds the content changed at startup, so the numbers only increase and restoring earlier content gives a new revision. A run keeps the template revision it was created from when the template changes or is removed.
_Avoid_: Definition revision (which belongs to one run), template version

**Template review digest**:
The digest a client reads from a workflow template's detail: it covers the template's name, revision and content, its plan without identities and its readiness binding, so it changes when the agent's manifest does. It proves only that the client saw a current review; a human approves a run later, against the run's own binding review.
_Avoid_: Review digest (on its own: that is a run's authoring review digest, which covers the identities)

**Template association**:
The immutable record, written when a run is created from a workflow template, of the template's name and revision, its digest and the template review digest the creation request carried. It is how a run, its inspect details, the operator view and the template's run list name the template, and it survives the template's edits and removal. It is not the run's governing contract, which stays the run's own plan.
_Avoid_: Template link, template contract

**Pending creation**:
A run creation request the `praxis` CLI has saved in its profile, before sending it, and keeps until the host gives a definite answer. While it is kept, the next `praxis run` of that template resends it unchanged, so a lost answer never creates a second run.
_Avoid_: Retry token, request id (on its own: the id is only one field of it)

**Node**:
One unit of a workflow definition that an agent can be bound to. Every task of a definition revision is a node, including an inserted preparation task. The coding composite node is split into stage nodes; until that split lands, the coding stages share its one node.
_Avoid_: Step, stage (as a synonym), task (which is a scheduler record)

**Stage node**:
One of the three nodes the coding composite node splits into: implementation, validation and correction. A correction ordinal is an instance of the correction node, not a node of its own.
_Avoid_: Stage (which names the interpreter's phase, not the node), phase node

**Node assignment**:
The engine record that one node is bound to one agent: the agent id, the capability digest and the assignment's own identity. Each node has exactly one current node assignment; two nodes bound to the same agent are two node assignments. Agent replacement creates a successor node assignment and keeps the old one as history. Built since M10 slice 4 for the one node of a coding run bound under readiness 2.0.0, made when the run is created.
_Avoid_: Assignment (on its own, in text that could mean a work order), binding (which is the human act, not the record)

**Stage handoff**:
The engine-generated record that one node's completed deliverable is the input of the next node, identified by the producer task, the consumer task and the artifact digest. It moves artifact identity only, never document bytes, a provider conversation, a login or a credential. The consumer's agent acknowledges it before claiming the work.
_Avoid_: Context transfer, session handoff, handoff (unqualified, which the SDKs use for the handoff-v1 wire)

**Attempt**:
One dispatched try at a node's work, with its own reservation, worker and evidence.

**Effect outcome**:
What authoritative evidence establishes about whether an attempt's action applied: SUCCEEDED or FAILED, or UNKNOWN whenever the evidence cannot establish it. A timeout, signal, restart or thrown error never proves the action did not happen, and only reconciliation or a human decision resolves UNKNOWN. A reported outcome is never rewritten: a held result keeps its outcome. The logical operation's effect status is recorded beside it, and only proof moves it to CONFIRMED_APPLIED or CONFIRMED_NOT_APPLIED. `STANDARD.md` §4 defines the StepAttempt and Side effect it describes; E-02 names the values.
_Avoid_: Result (which is the attempt's deliverable), status (on its own), exit code

**Hold**:
A durable gate, separate from execution state, that stops new work in its scope until its recorded blockers clear. It names an owner, a reason, the affected members and the intervention decisions allowed to resolve it; reading, truthful settlement, reconciliation and cancellation stay possible under it. Several holds can apply at once and releasing one leaves the rest in force. Releasing a hold never adds budget, resets a count or reopens work. Under handoff-v1 an exhausted loop or attempt bound opens one; under finite-v1 that exhaustion is terminal FAILED instead. `STANDARD.md` §4 has no hold object: it gates the Tasks and Runs §4 defines, and handoff-v1 HS-01 specifies it.
_Avoid_: Pause (which a human sets and lifts by resuming, with no blockers), block, suspension (which is a work order's state)

**Handoff**:
The handoff-v1 record by which a producer node passes an identified result, and the responsibility to consume it, to each recipient: an immutable manifest referenced by its digest, delivered once per recipient and acknowledged before the consumer is admitted. It grants no authority, is no evidence that an external action succeeded, and a summary of it is never control state. `STANDARD.md` §4 has no handoff object: the manifest names §4 Artifacts and a Checkpoint. In engine text, the record between two stage nodes is a stage handoff.
_Avoid_: Context handoff (`STANDARD.md` X-02's term for what a replaced participant must keep), transfer, summary

**Unresolved responsibility**:
An attempt whose outcome no authoritative evidence has yet established: one that is UNKNOWN, or one authorized before the host's current epoch that has no SUCCEEDED or FAILED delivery. Only reconciliation or a human decision resolves it. Restart review and finalising a cancellation refuse while a run carries it, and under the Praxis CLI spec so does starting a new run of the same workflow template.
_Avoid_: Pending attempt, in-flight attempt (an attempt authorized in the current epoch is simply running)

**Process-tree stop**:
How the local worker stops an attempt at its time limit or at its host meter's stop: every process the attempt started, not only the first. It is proven when the mechanism reaches by construction every descendant that stayed in the attempt's group or job (a POSIX process group, which a process leaves by calling `setsid` or `setpgid`, or the job object of the Windows native helper), and not proven when it walks live parent links (`taskkill /T` on Windows without the helper), which misses a descendant whose parent has already exited. The attempt's evidence records which applied. A process-tree stop is a signal, never proof that the attempt's effects did not happen.
_Avoid_: Kill (on its own), termination proof

**Attempt environment**:
The environment variables a worker gives one attempt's process, built from nothing in three layers: the platform baseline, variables the agent's adapter or the engine sets on purpose, and credentials delivered by the host credential provider. The platform baseline is the only part copied from the host's own environment; no other host variable passes through, by name or otherwise. In effect since M10 slice 3 for every attempt the local worker runs, which every engine-shipped adapter uses.
_Avoid_: Worker environment, inherited environment

**Platform baseline**:
The named host variables every attempt keeps: `PATH`, `HOME`, `USERPROFILE`, `SYSTEMROOT`, `TEMP`, `TMP`, `TMPDIR`, `LANG`, `LANGUAGE` and `LC_*`, plus on Windows the variables Node's process launcher supplies to every child (`HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN`, `USERNAME`, `WINDIR`).
_Avoid_: Allowlist (for the whole attempt environment), safe variables

**Ambient variable**:
A host environment variable outside the platform baseline. No attempt receives one; before M10 slice 3 every attempt received every ambient variable.

**Upgrade preflight**:
The read-only report that lists each active run and the ambient variables it does not receive under the attempt environment rule, flagging variables its commands reference and credential-like names. It had to exist before the rule shipped.

### Agents and models

**Agent**:
The installed thing Praxis binds to a node and dispatches work to. It is identified by an agent id and pinned by a capability digest. Praxis never acts as an agent itself.
_Avoid_: Worker (which is the engine process that runs an attempt), bot, assistant

**Subscription CLI agent**:
An agent that is a third-party command-line tool whose authentication is a user login the tool keeps in the agent's login directory.
_Avoid_: Subscription, CLI, local agent

**Login directory**:
The host-owned directory, one per agent, that a subscription CLI agent's tool is pointed at. It holds the agent's reviewed tool configuration, and in it a human signs in through the tool's own login flow, after which the tool keeps and refreshes that login. The host holds the directory and never reads, copies or delivers the login itself. At most one attempt at a time holds it, from the attempt's commit until it settles or is recorded stopped; a second attempt of the same agent waits, which is scheduling, not a hold. Retiring it runs the tool's own logout and deletes it, never while an attempt holds it; a retired login directory is never held, set up or signed in again.
_Avoid_: Auth file, token store, config dir

**Agent setup**:
The host operation that prepares a catalog agent for binding: for a subscription CLI agent it creates the login directory, writes the reviewed configuration, has the account holder sign in through the tool's own flow and checks the result with the status probe. It needs the installation-scoped `agent-setup` permission, which is separate from approving runs, and its counterpart is retiring the login directory. An agent that has not been set up cannot be bound.
_Avoid_: Onboarding, install, login (on its own)

**API-key agent**:
An agent that reaches a provider through an API credential delivered to it per attempt by the host credential provider.
_Avoid_: API agent, direct agent

**Credential reference**:
The nonsecret name a host credential provider resolves to the credential an API-key agent receives for one attempt. Together with its credential scope it is that agent's credential source and reviewed material; the secret it resolves to, and that secret's rotation, are not. A subscription CLI agent has no credential reference: its credential source is the credential scope of the login in its login directory.
_Avoid_: Key, secret, key id

**Credential admission slot**:
The step of dispatch admission that, before an attempt commits, acquires an API-key agent's credential from the host credential provider and checks its availability, expiry and revocation, its scope against the reviewed credential scope, and its remaining lifetime, which must outlast the attempt's maximum duration plus the credential lifetime margin. A different scope refuses dispatch with `READINESS_BLOCKED`. Any other failure holds the node `CREDENTIAL_REQUIRED` before commit, with no attempt counted and no reservation made. The handle it acquires is redeemed into the secret only as the worker builds the attempt environment, and released when the attempt ends.
_Avoid_: Credential check (on its own), key fetch

**Credential lease**:
The durable, nonsecret record that an attempt holds a credential handle: the provider, the credential reference, the provider's opaque handle id, the attempt and whether the credential belongs to that attempt alone. It is written with the attempt's commit and closed by the attempt's release record; each attempt has at most one. A lease still open when the engine starts belongs to a process that stopped, so the engine releases its handle through its provider, revoking a per-attempt credential, before any new dispatch and after it deletes every per-attempt directory still recorded; a lease whose provider is not installed stays open until a start that has it. A handle acquired but never committed, or acquired by a Recheck, has no lease.
_Avoid_: Handle record, credential session

**Per-attempt directory**:
The uniquely named directory, readable only by the host's OS user, in which an adapter keeps one attempt's delivered credential files and helper state, such as the key behind Claude Code's `apiKeyHelper` and the settings file that names it. The engine names it under the adapter's attempt root and records it with the attempt's commit until it is deleted. The secret is written there at spawn, and the engine deletes the directory when the attempt ends, on UNKNOWN, and at the next start for one a stopped process left or one it could not delete, whatever adapters that start has.
_Avoid_: Temp directory, key folder

**Credential lifetime margin**:
The time a delivered credential must stay valid beyond the attempt's maximum duration, measured from when the credential admission slot asks the provider: 60 seconds, the same slack by which the attempt's scheduler claim and worker lease outlast that duration. A delivery form that renews during the attempt is exempt; none the engine delivers does.
_Avoid_: Grace period, buffer

**Credential scope**:
The nonsecret description of what a credential reaches: provider, endpoint, account boundary such as a workspace, project or organisation, and granted actions. For a subscription CLI agent it describes the login: provider, endpoint, login method and account boundary. Each field is marked confirmed, recorded or, for a login only, tool-enforced, so the reviewer sees how it is known. A credential whose scope differs from the reviewed one belongs to a different agent; reconnection cannot restore it.
_Avoid_: Key scope, permissions

**Provider**:
The organisation or service that serves a model, such as Anthropic, OpenAI or a local inference server.
_Avoid_: Vendor, backend, platform

**Model**:
The specific large language model a provider serves, named by the provider's identifier. A model is an attribute of an agent's capability manifest, never a thing Praxis binds on its own.
_Avoid_: LLM (in specs), engine (which means Praxis), tier

**Primary model**:
The one model an agent is dispatched with. An agent whose model set is non-empty has exactly one; an agent with an empty model set has none.
_Avoid_: Main model, default model

**Model set**:
The closed list of provider and model pairs an agent's own harness may invoke: its primary model plus any others, each with a stated purpose. Every entry is a pinned identifier. An agent binding covers the model set and nothing outside it. Within the set the agent may use any member; a model reached through a tool call is a tool effect, not a member. The set may be empty: that is the agent's reviewed declaration that its own harness makes no model request, and such an agent carries no model requirements.
_Avoid_: Allowlist, model pool, fallback list

**Pinned identifier**:
A provider's name for one fixed model snapshot, which the provider does not re-point. A hosted identifier is pinned only when the provider's own documentation says so; a local server's name is pinned only by an operator pin. Only pinned identifiers registered in the model register may enter a model set.
_Avoid_: Alias (which a provider may re-point), version, stable name (which a provider may still re-point)

**Delisting**:
Removing an agent from the agent catalog, or an identifier from new choice in the model register. It affects new bindings and replacements only; runs already bound keep their reviewed binding.
_Avoid_: Retirement (which is the provider's), withdrawal

**Withdrawal**:
Revoking an identifier's pinned status in the model register because it turned out to be re-pointable or its operator pin no longer holds. Unlike delisting, it holds every node whose model set contains the identifier until a human replaces the agent or reverses the withdrawal.
_Avoid_: Delisting, retirement, ban

**Operator pin**:
The pairing, in the model register, of a local server's operator-chosen model name with a weights identity, such as a model digest or a repository commit, that the host observes from its own files. A changed weights identity is a changed agent.
_Avoid_: Local alias, tag

**Requested model**:
The identifier an agent sends in a model request.

**Served model**:
The identifier a provider reports as having answered a request. It is the provider's unsigned assertion, and it outranks the requested model when the two differ.
_Avoid_: Actual model, real model

**Model confinement**:
The host-observed condition in which a bound agent's own harness can request only members of its model set. It is verified before dispatch and says nothing about the served model.
_Avoid_: Model lock (which is one tool's feature), model verification

**Model-relevant configuration**:
The settings that decide which provider and model an agent's requests go to, including the tool version, provider endpoint and credential source. It is reviewed material.
_Avoid_: Model config, settings

**Nested model use**:
Any model request a bound agent makes alongside its primary model on another member of its model set, such as a subagent or auxiliary call.
_Avoid_: Sub-model, secondary model

**Fallback**:
The substitution of another model for the primary model when a request is refused or fails. A fallback runs instead of the primary model, so it is never nested model use and the model set does not permit it. Model unavailability never triggers one: the node holds instead.
_Avoid_: Failover, downgrade, reroute (which is a provider-side substitution)

**Model-set violation**:
An attempt whose model usage report shows a requested or served model outside the bound agent's model set, each marked SERVED or REQUESTED as the report says. Its result is held and feeds neither validation nor acceptance, while the attempt keeps its outcome and its consumption settles; a human discards it, which lets the stage run a fresh attempt, or admits it with a written reason, after which it is marked "admitted with violation". Admitting never widens the model set. A reported credential source other than the reviewed one holds the result in the same way, and one hold lists every violation the attempt has. Built since M10 slice 4 for the model set, and in M10 slice 6 for a login's reported credential source.
_Avoid_: Model mismatch, drift

**Model unavailability**:
The provider's refusal to serve a bound agent's primary model at all: the identifier is retired or unknown, the request is rate-limited or overloaded, or the account has reached a plan or spend limit. It is never a fallback trigger and never a model-set violation; the node holds with the cause and a human chooses retry, agent replacement or cancel. A served tier other than the requested one is not unavailability.
_Avoid_: Outage, model failure, fallback condition

**Availability notice**:
The host's record that a credential scope's account boundary, or a provider and model identifier, is known to be unavailable, with the cause, the time observed and the reported reset time if any. It holds every affected node before an attempt commits, so siblings do not each burn an attempt, and it lapses at its reset time or when a human clears it. A notice on an identifier, whether retired, past its retirement date or withdrawn, has no reset time and never lapses on its own.
_Avoid_: Cooldown, backoff, circuit breaker

**Model usage report**:
The per-attempt evidence record listing each provider and model the agent was observed to use, marked as requested or served, with token counts in fixed categories, the served tier and rate modifiers where the tool reports them, and the kinds of call it does not cover. The usage reporter installed with the harness marks it COMPLETE only when the tool emitted its final result for a run that ended on its own; otherwise it is INCOMPLETE and no automatic path settles it below the exposure allowance; only a human with authoritative external evidence may settle an attempt below its allowance, whatever its report's completeness. It is the input to cost conversion, never a ledger dimension of its own. Built since M10 slice 4: the usage reporter installed with a harness makes it from the attempt's redacted output, Claude Code's from `stream-json`, and the attempt's evidence keeps it.
_Avoid_: Usage stats, telemetry, cost report

**Capability manifest**:
The reviewed record describing a selected agent: its id, model set, model-relevant configuration, how its model usage report is produced, implementation digest, declared capabilities and named gaps. The implementation digest covers the adapter code and tool binary only; everything else a reviewer judges is in the manifest itself.
_Avoid_: Agent config, profile

**Named gap**:
A limit of an agent that the reviewer must see, recorded in its capability manifest, such as plan overage that may be billed without review or consumption not bounded during the attempt. Every named gap follows from the agent's model-relevant configuration and from how its model usage report is produced, and a manifest that names different gaps is refused.
_Avoid_: Caveat, known issue, warning

**Capability digest**:
The hash of a capability manifest that an assignment, binding and approval pin. A changed digest is a changed agent.

**Agent catalog**:
The installation's list of agents a human may bind to a node, each with its capability manifest. Listing an agent grants it nothing; only an agent binding does.
_Avoid_: Model catalog, agent registry, model list

**Agent picker**:
The authoring read model listing the agents the agent catalog offers for a draft plan: each is selectable, or stays listed with the reasons of the first check that refuses it. An agent delisted from the catalog is not listed. Selecting an agent grants it nothing until a human approves the binding.
_Avoid_: Agent list, model picker

**Model register**:
The installation's host data about provider and model identifiers: whether each is a pinned identifier and why, its retirement date if known, and its prices, which make up the price table. Every change is appended by a human, never overwritten. Only a registered pinned identifier may enter a model set. It is not behind any capability digest, so changing it never changes an agent.
_Avoid_: Model catalog, price list, model registry

**Agent binding**:
The human-approved association of one agent, by capability digest, with one node of a definition revision. Nodes of one run may bind different agents; binding the same agent to every node is the plain case.
_Avoid_: Model selection, assignment (which is the engine record created by binding or replacement)

**Graph binding**:
The Praxis document (`aiws-graph-binding/1`) that says what each dispatched node of one finite-v1 graph revision runs: an agent with its commands, or a protocol operation, with exposure and limits. It targets one graph by id, revision and digest, and is immutable per revision. A graph revision may have several; a run attaches one. Published `PROVISIONAL`; Praxis does not accept one yet.
_Avoid_: Protocol binding (a registered MCP or A2A endpoint), widened TASK config

**Readiness binding**:
The immutable record of the capability digest and the requirements one node assignment was approved against. Its requirements are that node's minimums, not a merge across nodes. Agent replacement creates the successor's binding and keeps the old one as history.
_Avoid_: Pinned run

**Legacy run**:
A run bound under readiness 1.0.0 before the readiness 2.0.0 upgrade. It keeps its reviewed binding and 1.0.0 semantics until it ends and is never converted; agent replacement (built since M10 slice 7) is its route onto a 2.0.0 binding, and the 1.0.0 binding stays as history. New work always binds under 2.0.0.
_Avoid_: Unpinned run (a run with no readiness binding at all)

**Agent replacement**:
The governed, human-approved exchange of the bound agent on a set of nodes for one successor that differs in agent id or capability digest, at a settled stage boundary. One proposal names the nodes and one successor; each named node gets a successor node assignment and readiness binding, and unnamed nodes are untouched. The only way a node's model set or a node assignment's readiness binding changes. The same agent id with a new capability digest is a successor; the identical pair is restore, not replacement. Built since M10 slice 7 for a coding run's one node, behind the activation bar.
_Avoid_: Fallback, switch, swap

**Activation bar**:
What a successor must pass before an agent replacement commits, evaluated from a fresh host snapshot: readiness READY against the successor's binding, with every confinement condition VERIFIED and the manifest digest matching, and the binding-time credential checks. A failure refuses the activation and consumes nothing.
_Avoid_: Readiness check (which also runs at dispatch)

**Replacement stepper**:
The resumable sequence by which a human replaces the agent of a node held after an attempt: reconcile, choose the successor and its figures, review and activate, then the successor's acknowledgment and the stage approval in either order. Each step is its own prepared governed command with its own confirmation. The Replace exit on the hold card starts it, once per hold. Its progress is read from each step's own record, so after any interruption it resumes at the step reached. Built since M10 slice 7 for a hold after an attempt that reconciliation clears.
_Avoid_: Wizard, combined replacement command

### Authority

**Grant**:
A permission record naming its issuer, subject, scope, permitted actions and resources, validity period, revocation state and, when delegated, its parent grant. A delegated grant is never broader than its parent, and delegation never extends expiry or creates a fresh budget. Discovering a capability or holding a reservation grants nothing, and only a human approves a change to an agent's grants, a reduction included. The AuthorityGrant of `STANDARD.md` §4.
_Avoid_: Permission (for the record), token, role

**Approval**:
An eligible approver's attributable decision authorizing one specific action, or an explicitly bounded set of actions, bound by a fingerprint or other immutable reference to the exact action and material it covers, with an expiry and a use limit. It creates no authority beyond what it names, and denial, silence, expiry or a model's statement is never one. In Praxis the approver is always a verified human. The Approval of `STANDARD.md` §4.
_Avoid_: Sign-off, confirmation, acceptance (which decides on an outcome, after the work)

**Reviewed material**:
Any record whose digest is part of an approval subject, so that changing it invalidates the approval. Every entry of a model set is reviewed material, and so is the agent's model-relevant configuration.
_Avoid_: Config, setting

**Binding review**:
The read model of what a stage approval covers on a bound run: each node's binding, a summary of each distinct bound agent, each node's readiness, the cost figures and the account crossings. The CLI preview and the web view render the same binding review, so a human approves exactly what it shows. Built since M10 slice 4 for a run with a node assignment, and in the host's authoring preview for a draft.
_Avoid_: Preview (on its own), approval screen

**Approval window**:
The span from a human decision that releases work (an approval, a correction re-approval, a resume after a pause or a restart, or a hold exit that returns the run to READY) to the first dispatch that decision releases. Sixty minutes by default; a host policy may shorten it, never lengthen it. It is independent of the approving session and keeps advancing during a pause. Later stages of the same approved material run with no approval clock. A window that closes with nothing dispatched lapses: the run returns to AWAITING_APPROVAL with reason `APPROVAL_LAPSED`, which is not a hold, and everything else the decision recorded stays.
_Avoid_: Approval expiry, approval lifetime

**Contracted read model**:
A host read model or profile message that a decision-free client session can read, with a schema and fixtures in the engine spec that an outside client can rely on. Every contracted record names its format, and the engine's own tests check what each route emits against the schema in strict mode. Its stability is Provisional or Stable.
_Avoid_: Public API, wire record (wire 1.1.0 records are contracted by the wire schema)

**Provisional**:
The stability of a contracted read model that has a schema and the strict-mode engine test but no promise across commits. The workflow catalog starts Provisional.

**Stable**:
The stability of a contracted read model whose changes within a format version are additive only; anything else needs the next format version, served beside the old one.

**Hold card**:
The read model of one open hold on a node: its reason and cause in plain words, what it consumed, any reported reset time, the next clock expiry and the exits a human may take, each prepared as a governed command. The CLI and the web view render the same hold card. Built since M10 slice 3 for the `CREDENTIAL_REQUIRED` hold, whose Recheck exit is prepared, and since slice 4 for the `PRICE_REQUIRED` hold, whose Add price exit opens the register's price sheet pre-filled with the missing keys, and for the `EXPOSURE_EXCEEDED` hold of a priced overrun and the `BINDING_VIOLATION` hold, whose Raise limits, Discard and Admit exits are prepared. Since slice 6 a login directory's `CREDENTIAL_REQUIRED` hold card shows the sign-in command and prepares Reconnect, the same `RECONNECT` exit as Recheck, which re-runs the status probe and the scope check. The card is built for the human reading it: each exit is marked available or not, and one whose command needs a permission they lack names whom to ask.
_Avoid_: Alert, error banner

### Verification and acceptance

**Verification**:
An attributable assessment of one criterion, by a named assessor and method, against identified evidence, with a verdict of PASS, FAIL or INCONCLUSIVE. Evidence that is unavailable gives INCONCLUSIVE, never PASS, and agent self-report, a tool result, a digest or a signature is never a PASS on its own. It is not acceptance. The VerificationRecord of `STANDARD.md` §4.
_Avoid_: Validation (on its own: in Praxis that names the coding stage that runs the checks), check, review

**Acceptance**:
An accountable authority's attributable decision to accept, reject or defer an assessed outcome, against a pinned verification revision and the acceptance policy. It is separate from verification and from approval, and accepting a deviation never turns a failed mandatory criterion into PASS. A run is verified successful only with a current PASS for every mandatory criterion, acceptance currently ACCEPTED for that verification and no material effect UNKNOWN. The AcceptanceRecord of `STANDARD.md` §4.
_Avoid_: Approval (which authorizes an action before it runs), sign-off, completion (which is the execution state)

### Accounting

**Ledger**:
The one durable limits ledger that owns a whole work-order tree's accounting: its scopes (work order, run, branch and node), their bounds of cost, time and attempts in one fixed integer cost unit, and every reservation, dispatch, stop and settlement. Reaching any bound blocks new work in that scope and in its dependents and descendants. Only an authenticated human changes a bound, through a ledger adjustment, and separate mission databases summed together are not a ledger. `STANDARD.md` §4 has no ledger object: it is how a §4 Mission is the cumulative resource-accounting container, under B-02, and limits-v1 specifies it.
_Avoid_: Budget (on its own), limits database

**Reservation**:
The ledger's charge, made before any preparation or dispatch, of an attempt's maximum cost and active time to its leaf scope and every ancestor in one transaction; making it consumes one attempt for good. Only a reservation never dispatched may be released. A dispatched or UNKNOWN one keeps its whole exposure until authoritative evidence stops or settles it, and settlement releases only the unused cost. A reservation is not a grant. `STANDARD.md` §4 has no reservation object: it is the budget reservation E-03 requires before a StepAttempt dispatches.
_Avoid_: Hold (which is a gate), allocation (which `STANDARD.md` B-02 uses for a scope's share of the envelope)

**Cost conversion**:
The host's pricing of an attempt's model usage report into the ledger's cost unit at settlement, using the price table version pinned at reservation. The exact products are summed for the whole attempt and rounded up once. The usage reporter normalises token counts and never prices them; a tool's own cost estimate is evidence only. Built since M10 slice 4: a COMPLETE report settles at its converted cost; an INCOMPLETE or missing report, or a line the pinned version does not price, settles at the full exposure allowance.
_Avoid_: Billing, cost reporting

**Price table**:
Versioned host data, identified by digest, giving prices in the ledger's unit per million tokens of each category, or per request for server tools, keyed by provider, pinned model identifier, served tier and rate modifier. It is not reviewed material: a price change invalidates no approval. A rate modifier the tool does not report is priced at its most expensive value.
_Avoid_: Rate card, pricing config

**List-price equivalent**:
The settlement basis of consumption that carries no per-token charge, such as a subscription CLI agent's use of its plan: priced at the provider's API list price through the same price table, and marked as such so a reader can tell it from billed rates. Plan windows stay outside the ledger. Built in M10 slice 6 for a login held in a login directory.
_Avoid_: Notional cost, estimated cost

**Exposure allowance**:
The human-declared maximum cost one attempt of a node may consume, stated in the definition beside the node's binding and reserved whole by every attempt. It is the maximum cost exposure of B-02 for consumption that cannot be strictly bounded, and changes only through a definition revision. A node whose agent has an empty model set declares its cost not applicable instead, with a justification, and reserves zero. In the engine built so far no revision changes it (its limits digest covers it), and a node with an empty model set may also make no declaration, which reserves zero too.
_Avoid_: Budget (unqualified), max cost (which names the scope bound)

**Overrun**:
The amount by which an attempt's priced cost, its true cost, exceeds its reservation. It is recorded on the attempt at once and is never capped, absorbed or charged to a sibling: the node holds, the attempt does not settle and its result feeds nothing until a human raises the bounds of the scopes from its node to the root through the ledger adjustment, and then it settles at its true cost. Built since M10 slice 4.
_Avoid_: Overspend, budget breach

**Ledger adjustment**:
The human-only change of a scope's bounds in the limits ledger, made by an authenticated human with an evidence reference and recorded with the bound it replaced. It keeps all consumption, reservations, start times and history, and refuses a bound below the scope's exposure. No agent, rule or automatic process makes one. Raising limits after an overrun is one.
_Avoid_: Limit override, top-up

**Stop threshold**:
The human-declared running cost, no greater than the exposure allowance, at which an attempt is stopped. A host meter enforces it where the tool streams usage, the tool's own budget switch backs it up, and a tool with neither carries a disclosed gap. A stop by the host is an UNKNOWN outcome. Enforced by the host meter since M10 slice 5 for Claude Code 2.1.287 with a delivered key.
_Avoid_: Soft limit, budget cap

**Host meter**:
The host's enforcement of a node's stop threshold while an attempt runs. A usage meter installed with the agent's harness reads the usage the tool streams in the attempt's redacted output; the host prices it at the price table version the reservation pinned, by the same conversion and rounding as settlement, and stops the attempt once the running cost reaches the stop threshold, a line that version does not price counting as reaching it. The stopped attempt is UNKNOWN and keeps its reservation whole. Applies only where the reviewed manifest declares it and the host installed the meter; built since M10 slice 5.
_Avoid_: Budget watcher, cost monitor

### Storage

**Engine database**:
The one database that holds all of an installation's durable engine state, every feature's records included. Backup and restore capture it whole, so nothing that must agree with it after a restore lives anywhere else.
_Avoid_: State file, a feature's own database

**Storage worker**:
The one part of a running engine that connects to its engine database. Every other part of the engine reaches the database by sending the storage worker a request, so blocking database work never runs where control requests are served. Until the dynamic control profile is routed through it, that profile also connects directly.
_Avoid_: Database thread, writer (on its own)

**Clock-asserted write**:
A storage write that compares its time with the engine clock's high-water mark, such as a dispatch or a worker's acknowledgement of one. It carries its own clock reading, taken as its request is sent; the storage worker records that reading and then runs the write against it, so no clock observation made in between, such as a polling control request, can make it stale. Its caller never supplies its time. The dynamic control profile still supplies one until it is routed through the storage worker.
_Avoid_: Timed write, dispatch-time check

**Engine database lock**:
The lock a running engine holds on its engine database for as long as it has the database open. Anything else that connects to that database, such as a maintenance tool or a single-repository example, takes the same lock first, so it can never run beside a live engine; only a test may connect without it. It is distinct from the installation writer lock, which keeps a second launcher off the whole installation. Not built yet: today only the deployment launcher takes a lock, and that lock is the installation writer lock.
_Avoid_: Writer lock (on its own), owner lock

**Maintenance tool**:
Administrative code a host runs against an engine database while no engine runs on it, holding that database's engine database lock throughout: backup, restore inspection and activation, and artifact retention. The lock keeps the engine away from the database only; the host still keeps anything outside the engine away from the installation's files for as long as the tool runs. Never started by an agent or a control request.
_Avoid_: Offline job, admin script

**Owner-only**:
Usable by the installation's OS user alone. A directory is owner-only when, on Windows, its access list is protected from inheritance and holds one direct rule, full control for that user, and on POSIX when that user owns it with mode 0700; a file that carries trust is owner-only when every rule names that user alone, or on POSIX when that user owns it with no group or other access. The host and the CLI make a directory owner-only only when they create it, and refuse an existing one with broader access rather than change it. On Windows the check reads the access list, not the owner.
_Avoid_: Private (on its own), locked down, secured

### Host access

**Browser origin**:
The one HTTPS origin where a host serves its web view and human sign-in; passkeys and browser sessions are bound to it.
_Avoid_: Host URL, localhost URL

**Control address**:
The loopback IP origin where non-browser clients reach the host's control API.
_Avoid_: API origin, endpoint

**Owner enrollment**:
The one-time act that makes the first verified human the installation's owner, through the installation's enrollment adapter. Exactly one enrollment can win, nothing is granted until it commits, and a lost response is resolved by the owner logging in, never by reopening setup.
_Avoid_: Registration, sign-up, onboarding

**Enrollment adapter**:
The owner enrollment mechanism an installation is fixed to at its first enrollment attempt: the passkey adapter for a host that runs as the owner's own OS user under `praxis serve`, or the Windows native owner setup for a service deployment with its own service identity. The installation refuses the other one.
_Avoid_: Identity provider (which also covers login)

**Local request file**:
The owner-only file in the installation's `identity` directory through which `praxis setup` or `praxis login` proves to the host that it runs as the installation's OS user, before setup or a login begins. It holds a one-use random value, and the host deletes it when it checks it.
_Avoid_: Setup request file, setup token, setup link, login token

**CLI session**:
A session the owner grants to the `praxis` CLI by confirming it in the browser. It acts in the owner's name but carries no human verification, so it can start runs and read, and never decides; the engine treats its holder as possibly an agent, whoever is typing. Its session kind is `AGENT`, and the engine refuses it every action outside its scope with `HUMAN_REQUIRED` before the identity adapter is asked.
_Avoid_: API token, agent session, human session

**Simulated identity**:
An identity adapter that signs anyone in as the owner without proof, and declares itself simulated. A host using one is not a human gate: nothing decided on it is a human decision. Only tests and the `praxis` example use one, and the deployment launcher refuses one.
_Avoid_: Test login, demo identity, fake auth

**Connection descriptor**:
The owner-only file the host writes to its `identity` directory on each start, holding its control address, browser origin and certificate, never a key. During a certificate rollover it also holds the next certificate, and it keeps the most recent rollover statement until the next rollover replaces it. The CLI pins the host from it and follows a rollover only through it.
_Avoid_: Connection file, discovery file

**Certificate rollover**:
The host's planned move from its generated leaf certificate to a new leaf with a new key. The next leaf is prepared 60 days before the current one's `NotAfter`, advertised so that the owner can trust it early, and served from 14 days before. A rollover statement signed by the current key lets a CLI move its pin without logging in again. Replacing the certificate without that statement, as `praxis serve --new-certificate` does, is re-enrollment, not rollover.
_Avoid_: Renewal (every renewal changes the key), certificate refresh

**Decision window**:
The 5-minute fresh verification window following a passkey ceremony during which a human session can authorize elevated decision actions (approvals, resume, hold exits). Once lapsed, an in-browser passkey ceremony is required before a decision can be committed.
_Avoid_: Session timeout, approval window (which applies to work order dispatches)

**Passkey allowlist**:
The compiled set of hardware-backed authenticator root certificates and Windows Hello TPM AAGUIDs verified from the FIDO Alliance Metadata Service (MDS3), under schema `praxis-passkey-allowlist/1`. Authenticators failing allowlist qualification are refused with `PASSKEY_NOT_QUALIFIED`.
_Avoid_: Key whitelist, approved keys list
