# How an agent is taught to write valid A2UI 1.0

Research note for ticket #686 (map #682). Researched 2026-11-23.

**Gist:** The A2UI project no longer asks a model to write wire JSON against the schema. Its agent SDK generates a prompt (or a `SKILL.md`) from the catalog, has the model write a compact notation called Express inside `<a2ui>` tags, then compiles and validates that on the host and sends any error text back for a retry. Google publishes about 96 to 98% first-attempt validity on Gemini Flash models; there is no published project figure for Claude or GPT, and no agent SDK for Rust.

Marks: **W** = well supported, read in the primary source. **T** = tentative: source not read in full, sources conflict, or my inference.

## Sources read

| Short name | What | Where |
| :-- | :-- | :-- |
| Repo | `google/A2UI` at commit `5ff1b05f` (2026-11-20), cloned and read locally. Its own links name the repository `a2ui-project/a2ui`. | <https://github.com/google/A2UI> |
| Spec | v1.0 protocol specification, section "Usage pattern: the prompt-generate-validate loop" | <https://a2ui.org/specification/v1.0-a2ui/> (repo: `specification/v1_0/docs/a2ui_protocol.md`) |
| Agent guide | "How to Integrate A2UI into an Agent" | repo: `docs/site/src/content/docs/guides/agent-integration.mdx` |
| Formats page | "Inference Formats" | repo: `docs/site/src/content/docs/concepts/inference-formats.mdx` |
| Python guide | Python agent SDK development guide | repo: `python/a2ui_agent/agent_development.md` |
| Skill blueprint | Skill generator feature blueprint | repo: `blueprints/features/skill_generator.blueprint.md`, `python/a2ui_agent/src/a2ui/skill/` |
| ADK toolset | `SendA2uiToClientToolset` source | repo: `python/a2ui_adk/src/a2ui/adk/send_a2ui_to_client_toolset.py` |
| Eval | Evaluation framework: `README.md`, `DESIGN.md`, `TRIAGE.md`, strategies, committed baselines | repo: `eval/` |
| Macros guide | "Using Macros" | repo: `docs/site/src/content/docs/guides/macros.mdx` |
| MCP guide | "Serve A2UI Layouts from an MCP Server" | repo: `docs/site/src/content/docs/guides/a2ui-over-mcp.mdx` |
| Blog, formats | "Fast, reliable A2UI, with swappable inference formats", 2026-10-27 | <https://developers.googleblog.com/fast-reliable-a2ui/> |
| Blog, 1.0 | "A2UI 1.0: Build delightful, fast, reliable, agentic experiences", 2026-11-11 | <https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/> |
| CopilotKit | CopilotKit A2UI docs: overview, fixed schema, dynamic schema | <https://docs.copilotkit.ai/generative-ui/a2ui> |
| VGV benchmark | Very Good Ventures, "Benchmarking LLMs for GenUI" (2026-07-23) and its results table | <https://verygood.ventures/blog/benchmarking-llms-for-gen-ui/>, <https://verygood.ventures/resources/genui-benchmarks/> |
| VGV layers | Very Good Ventures, "Hallucinations in Generative UI: A Four-Layer Defense" (2026-07-31) | <https://verygood.ventures/blog/generative-ui-hallucinations-four-layer-defense/> |
| Love | Brian Love, "Google A2UI: Fixed Schemas, Dynamic Schemas, and a Safe Fallback Strategy" (2026-03-18) | <https://dev.to/blove/google-a2ui-fixed-schemas-dynamic-schemas-and-a-safe-fallback-strategy-284f> |

The two blog posts and the third-party pages were read through a fetch-and-summarise tool, not as raw text, so quotations from them are less certain than quotations from the repo.

## 1. How the project says to get a model to emit A2UI

### The specification: schema and examples in the prompt, then validate

**W.** The spec describes a three-step loop. The prompt holds the UI request, "the A2UI JSON schema, including the component catalog", and "examples of valid A2UI JSON". The model generates. The host validates, and "if it is invalid, the errors can be reported back to the LLM in a subsequent prompt, allowing it to self-correct." (Spec, "Usage pattern".)

### The agent SDK: a generated prompt and a compact notation, not raw JSON

**W.** The current guidance replaces hand-built prompts with the agent SDK, which exists for TypeScript (`@a2ui/agent`), Python (`a2ui-agent-sdk`) and Dart. Swift and Kotlin are renderer-only. (Agent guide.) The flow is:

1. Build an `A2uiGenerator` from one or more catalogs.
2. Per request, create a processor and append its `promptSnippet` to the agent's own system prompt.
3. The model writes its UI as a block in its ordinary text reply, between sentinel tags.
4. The SDK's parser extracts the block, compiles it to wire messages and validates every message.

**W.** The model does not write wire JSON by default. The default "inference format" is **Express**, a positional notation in `<a2ui>...</a2ui>` tags that the host compiles to A2UI JSON. **Direct JSON** (`<a2ui-json>...</a2ui-json>`) is the alternative, kept for legacy payloads, debugging and fine-tuned models. (Formats page; Python source `processor/generator.py` defaults to `ExpressFormatFactory`.) The Formats page gives three reasons: raw wire JSON is "roughly three times longer" to write, full JSON Schemas in the prompt cost "roughly twice as many input tokens", and nested braces and hand-written component ids "increase syntax and reference errors, especially on smaller, faster models."

An Express block for a card with two lines of text and a button:

```text
<a2ui>
$/flight/number = "NH 105"
root = Card(Column([
  Text($/flight/number),
  Button(Text("Board now"), action=Event("check_in", {flight: $/flight/number}))
]))
</a2ui>
```

The compiler assigns the component ids, flattens the tree and folds the data assignments into `createSurface.dataModel`. (Formats page.)

**T (sources conflict).** The Python guide says in one place that Direct JSON is the default and that Express cannot stream. The Python source and the Agent guide make Express the default, and the Agent guide and the TypeScript known-gaps file say Express streams. I take the Python guide to be stale on this point.

### What the generated prompt contains

**W.** The prompt is assembled from three parts, each derived from the catalog at run time: base rules (grammar and sentinel tags; for Direct JSON also the envelope and common-types schemas), catalog instructions (component and function signatures for Express, JSON Schemas for Direct JSON, plus the catalog's own `instructions` text), and examples. (Skill blueprint; Python source `inference_formats/direct_json/prompt_generator.py`.)

**W.** Worked examples are supported and expected. They are supplied once as wire JSON, validated against the catalog when the processor is created, and rewritten into whichever format is active. The basic catalog carries two inline examples in its `instructions` field and ships 43 example files in `catalogs/basic/v1/examples/`. (Agent guide, "Customize catalogs, examples, and inference formats"; Python guide; repo.)

### Skills: the same text as a `SKILL.md`

**W.** `SkillGenerator` (Python and TypeScript) turns the same prompt into skill files: one `a2ui` skill, or a modular set of `a2ui-core` (the notation) plus one `a2ui-<catalog>` per catalog. The blueprint gives the target paths `.agents/skills/a2ui-core/SKILL.md` and `.agents/skills/a2ui-<catalog>/SKILL.md` and names "Anthropic API with Skills" and "Model Context Protocol agent sandboxes" among the intended hosts. The monolithic skill's body is exactly the prompt snippet. (Skill blueprint; `conformance/agent/skill.yaml`.) Google's formats blog describes this as "a2ui-core plus one skill per catalog". (Blog, formats.)

**W.** The eval suite has a `skill_mode` strategy that tests this path: the system prompt lists the skills in a few lines and the model gets a `read_a2ui_skill(skill_name)` tool to load them before writing. (Repo: `eval/a2ui_eval/strategies/skill_mode.py`.) **T:** I found no published result for `skill_mode`; it runs only when named.

**W.** The repo's own `skills/a2ui/SKILL.md` is a different thing. It teaches a coding agent to build an A2UI integration, and its main instruction is "do not write A2UI code from memory" because "your training data is likely outdated". It does not teach payload generation.

### A tool the agent calls

**W.** The Google ADK integration offers `SendA2uiToClientToolset`. The tool takes a single **string** argument, `a2ui_payload`, described as "the A2UI block to send to the client, in the A2UI format that the system instructions describe". The catalog is not in the tool's input schema. The toolset adds the format rules, catalog and examples to the system instructions, and adds one line telling the model to pass the block in the tool argument instead of writing it in the reply. The tool compiles and validates the string and returns either the validated messages or an error string. (ADK toolset source; Python guide, "Runtime Validation".)

**T.** CopilotKit injects a `render_a2ui` tool that the model calls "with the surface components and data". Its docs do not show the tool's input schema, so I cannot say whether the catalog is expressed there. (CopilotKit.)

**T (absence).** I found no project guidance to put the A2UI schema or catalog into a tool's input schema, nor to use schema-constrained decoding. The only structured-output mention is Gemini's JSON-only mode (`responseMimeType: "application/json"`) with Direct JSON and `wrapped: false`. (Agent guide, "Parse JSON-only model output".)

### A generator the agent delegates to

**W.** The eval suite's `subagent_tool` strategy gives the outer model one tool, `a2ui_specialist(input: str)`, and a second model call with the full A2UI prompt writes the payload, with its own validation retries. It is one of the three "production strategies" the suite runs by default, alongside `direct` and `express`. (Eval README; `eval/a2ui_eval/strategies/subagent_tool.py`.) CopilotKit's `generate_a2ui` tool follows the same shape: it "runs a secondary LLM, a subagent, that designs the full A2UI surface". (CopilotKit.)

### No model at all

**W.** "Regulated or deterministic workflows can also construct wire messages directly in server code (driven by a classifier, state machine, or macro) and send the resulting JSON to the renderer without an LLM compilation step." (Formats page.)

## 2. Size of the 1.0 schema and the basic catalog

Measured on the files at the commit above. All are ASCII, so bytes equal characters. Tokens are estimated at four characters per token; real tokenisers differ.

### What a model would need to write raw wire JSON

| File | Bytes | Est. tokens | Minified chars | Est. tokens |
| :-- | --: | --: | --: | --: |
| `specification/v1_0/json/agent_to_renderer.json` (envelope) | 9,188 | 2,300 | 6,567 | 1,640 |
| `specification/v1_0/json/common_types.json` | 13,502 | 3,380 | 9,147 | 2,290 |
| `catalogs/basic/v1/catalog.json` (18 components, 14 functions) | 43,173 | 10,790 | 27,585 | 6,900 |
| **Total** | **65,863** | **16,470** | **43,299** | **10,820** |

Inside the minified basic catalog: components 13,196 characters, functions 9,293, the `instructions` text 3,071.

Not needed by the writing agent, for reference: `renderer_to_agent.json` 5,814 bytes (about 1,450 tokens), `catalog_definition.json` 10,295 bytes (about 2,570 tokens).

**W.** These measurements agree with the project's own figures. Its benchmark reports a median of 10,980 input tokens per request for Direct JSON on the basic catalog, and the committed baseline reports 12,522; both include the test's own instructions. (Formats page; `eval/baselines/direct_json/run_meta.json`.)

### Smaller forms the project offers

| Form | Measured size | Source |
| :-- | :-- | :-- |
| Express prompt for the whole basic v1 catalog (golden file `express_basic_monolithic.skill.md`) | 23,507 bytes, about 5,800 tokens | repo: `conformance/test_data/skills/` |
| Modular: `a2ui-core` (notation only) | 4,960 bytes, about 1,220 tokens | same |
| Modular: `a2ui-basic` (signatures, catalog rules, two examples) | 18,692 bytes, about 4,600 tokens | same |
| Minimal catalog: Text, Row, Column, Button, TextField and one function | 6,573 bytes, about 1,640 tokens as JSON | repo: `catalogs/minimal/v0_9/catalog.json` |

- **W.** Express roughly halves the prompt: published median input 6,000 tokens against 10,980 for Direct JSON, and median output 297 tokens against 807. (Formats page.)
- **W.** The minimal catalog exists only for protocol v0.9. There is no v1.0 minimal catalog in the repo.
- **W.** Pruning is the documented way to shrink further: `ComponentPruningTransformer(["Card", "Column", "Text", "Button"])` on the catalog, function pruning, and `allowed_messages` to drop message types from the envelope schema. (Agent guide; Python guide.)
- **W.** A custom catalog replaces the basic one outright: "To use your own catalog, simply include it in the prompt in place of the basic catalog." (Spec, "The Basic Catalog".)
- **T (my estimate).** A question-card subset of nine components (Text, Row, Column, Card, Button, TextField, CheckBox, ChoicePicker, Divider) sums to 6,532 characters of Express signatures, about 1,630 tokens. With `a2ui-core` that is about 2,900 tokens before functions and examples. I summed entries in the golden file; I did not run the SDK to generate a pruned prompt.
- **T.** A cut made by the optimiser run that shortened signature descriptions reduced input by 46% but dropped validity from 100% to 75% on its sample, and was reverted. Descriptions in the prompt appear to be load-bearing. (Repo: `eval/iterative_format_optimizer/history_summary.md`, atom run 014. This is the experimental Atom format, not Express.)

## 3. Validation and retry

### What is checked

**W.** The SDK validates on the agent side, before anything reaches the renderer, and "validation always runs; there is no option to skip it". Checks cover message schemas, component properties against the catalog, and surface topology: unknown component, missing `root`, dangling child id, cycles. A response parsed whole is applied all or nothing; on failure the SDK "rolls back `RendererState` and raises an `A2uiError`". (Agent guide, "Non-streaming generation and validation retry"; Python guide.)

**W.** Before validating, the parser repairs common model slips: it strips Markdown code fences, heals trailing commas, closes strings still being written, and recovers a block whose opening tag the model dropped. (Python guide; Formats page; TypeScript `KNOWN_GAPS.md`.)

**W.** Validation is against state. With no state passed, each response is checked against an empty renderer, so "a response that updates a surface it did not create is rejected". An agent that updates a surface across turns must keep one `RendererState` per conversation. (Python guide, "Chat and Canvas UIs".) This matters for a live status board.

### The recommended loop

**W.** The Agent guide's reference loop buffers the whole response, allows `maxRetries = 2` (three attempts in all), and on failure re-prompts with four parts:

```text
<the original user prompt>

Your previous response:
<the failed output, verbatim>

Validation failed: <error message>

Fix the A2UI output so every component and ID matches the catalog.
```

**W.** The eval harness uses a shorter version as a follow-up user turn: "Validation failed: {error}. Fix the A2UI payload and reply with the complete corrected payload only." Its specialist variant says "Your previous response was rejected: {error}" and asks for "the complete, corrected payload enclosed in" the tags. The harness default is zero retries. (Repo: `eval/a2ui_eval/strategies/format.py`, `subagent_tool.py`.)

**W.** When the payload arrives as a tool call, the error goes back as the tool result: "Failed to call A2UI tool {name}: {error}". On success the ADK tool suppresses the follow-up model call. (ADK toolset source.)

**W.** For streamed output the client has already drawn part of the surface when a block fails. The guide says to flush the partial results, open a new stream on the same state, and "either repair existing surfaces in place (`surface("id", update=true)`) or send `deleteSurface` before regenerating". (Agent guide.)

### The error text

**W.** The spec defines a standard validation error so "the LLM can understand and correct the error": `code` (`VALIDATION_FAILED`, `UNALLOWED_PARENT` or `UNALLOWED_CHILD`), `surfaceId`, `path` (a JSON pointer such as `/components/0/text`) and `message` ("a short one-sentence description"). The spec's example message is "Expected stringOrPath, got integer". The same shape is the `error` message a renderer sends to an agent. (Spec, "Standard validation error format"; `specification/v1_0/json/renderer_to_agent.json`.)

**W.** Express compiler errors name the offending thing and carry a separate hint listing what is allowed, for example "Property 'x' is not a valid property of component 'Button'." with the hint "Component 'Button' accepts properties: ...". (Repo: `python/a2ui_agent/src/a2ui/inference_formats/express/errors.py`.) **T:** the hint is a separate attribute; I did not confirm that it is included in the string the retry prompt quotes.

**T.** Outside the project, advice on retry caps varies: VGV describes one retry, then failing the request "rather than shipping broken output to the client"; Love suggests about five, then falling back to a fixed layout. Neither gives data. (VGV layers; Love.)

## 4. How often models get it right, and what goes wrong

### Published by the project

**W (as published; not reproduced).** The docs benchmark: 54 samples (`core_v1_0`), `gemini-3.8-flash`, temperature 0, basic catalog. (Formats page.)

| Format | Thinking | Pass@1 | Pass@2 | Judge quality |
| :-- | :-- | :-- | :-- | :-- |
| Direct JSON | off | 98.1% (53/54) | 98.1% | 97.2% |
| Express | off | 98.1% (53/54) | 98.1% | 97.2% |
| Direct JSON | unbounded | 98.1% (53/54) | 98.1% | 98.1% |
| Express | unbounded | 98.1% (53/54) | 98.1% | 98.1% |

Pass@1 equals Pass@2 in every row: the one retry did not rescue the one failing sample.

**W (file contents).** The baselines committed in the repo, on the older `gemini-3.5-flash` with 51 samples, are lower and less even. "Schema" is the share passing validation; "quality" also requires the judge's approval.

| Format | Thinking budget | Schema valid | Quality |
| :-- | :-- | --: | --: |
| Direct JSON | 0 | 96.1% | 92.2% |
| Direct JSON | 1,795 | 100% | 93.1% |
| Direct JSON | unbounded (5 runs) | 96.9% | 93.1% |
| Express | 0 | 96.1% | 89.2% |
| Express | 1,795 | 90.2% | 86.3% |
| Express | unbounded (5 runs) | 87.8% | 84.5% |
| Elemental (experimental, HTML-like) | 0 | 92.2% | 89.2% |
| Atom (experimental, S-expressions) | 0 | 21.6% | 16.7% |

(Repo: `eval/baselines/`, `eval/iterative_format_optimizer/baselines/`.) **T:** the gap between these files and the docs table is unexplained in what I read; the model differs and the Express prompt was tuned in between. The Atom row shows how badly an unfamiliar notation can fail with thinking off.

**W.** Limits on this evidence: only Gemini models run in CI; OpenAI and Anthropic are "run on demand"; the datasets are encrypted in the repo "to prevent base model contamination", so the prompts cannot be inspected. (Eval README; Eval DESIGN.) **T (absence):** I found no project-published result for any Claude or GPT model.

### What goes wrong most

**W.** The project's triage guide for eval failures lists, in its own order (Eval TRIAGE):

1. Schema errors: missing required fields; extra fields, which "often happens when the model uses properties from a different version of the protocol or catalog"; type mismatches.
2. Topology errors: no `root` component, dangling child references, circular references.
3. Valid but wrong: a `Column` where a `List` was asked for, missing components, wrong nesting. Validation cannot catch these; only the judge does.
4. Tag omission: the model writes prose, ASCII art or an apology instead of a tagged block. The guide calls this "usually a model capability or context window issue" and suggests checking whether "the system prompt is too long" or a more specific example is needed.

**W.** The Express prompt hard-codes guards against observed slips, which shows what its authors saw: do not replace the opening tag with a Markdown fence; `action` parameters are "strictly required" and need a dummy `Event("click")` if none is described; arguments marked static must not be data bindings. (Repo: `conformance/test_data/skills/express_core.skill.md`.)

**W.** In the committed Direct JSON baseline, the two validation failures were the two samples that use non-basic catalogs (`restaurantFinder`, `rizzCharts`), and the harness adds an explicit note telling the model never to "invent a custom or placeholder `catalogId`". (Repo: `eval/baselines/direct_json/run_meta.json`, `subagent_tool.py`.)

### Third-party measurement

**T.** VGV benchmarks models on generating A2UI through Flutter's GenUI: three turns, five repetitions, so 15 turns per model. The table (dated 2026-09-03) shows 0.0% "structural hallucinations" for all 33 model configurations, including `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-sonnet-5`, `claude-opus-4-8` and several GPT-5 models. The accompanying post reports earlier failures: one Gemini model "sent its component list as a bare array" on 6 of 15 turns, and items arrived missing required properties, such as a slider without a value or a radio card without options. It also notes that the GenUI library hides bad items by silently re-asking the model, so they validated separately. (VGV benchmark.) Tentative because the sample is tiny, the A2UI version and prompt are not stated, and a search summary of the same page showed a 40% row that the page I fetched did not.

**T.** VGV's second post argues that schema validation catches only one of four failure classes: unrenderable output, the wrong but valid component, fabricated data in the right component, and compliance with a request the app should refuse. Its examples are illustrative, not measured. (VGV layers.)

## 5. A simpler tool in front of A2UI

Nobody I found has published exactly "ask a question with these options, expanded to A2UI on the host". Four documented patterns come close.

### Fixed layout, tool carries only data (CopilotKit "Fixed Schema")

**W.** The developer authors the component tree once; the agent gets an ordinary tool such as `display_flight(origin, destination, airline, price)`; the tool returns `create_surface`, `update_components` (the stored tree) and `update_data_model` (the four values). "Your agent owns a data-only tool and no subagent is injected." (CopilotKit, fixed schema.)

- Gained, as stated: "faster, cheaper, and the UI is deterministic"; no second model call; no drift in the layout the model produces; layout changes are JSON edits.
- Lost, as stated: it fits only surfaces that can be predicted in advance; anything that must adapt per prompt needs the dynamic path; more setup per surface.

### Layout once as a resource, tool returns only data (A2UI over MCP)

**W.** The project's own MCP guide publishes the layout as an `a2ui://` resource (`application/a2ui+json`) and has the tool return only an `updateDataModel` message. The tool's input schema is plain domain arguments (`cookingStyle`, `protein`). "Instead of repeating the component tree on every tool invocation, the server sends the layout once." The tool result also carries a plain-text summary for hosts with no renderer. (MCP guide.)

### Macros: one call that expands on the host

**W.** In the Python SDK a `@macro` function defines a composite component. The model writes one call, such as `FlightCard("OS 87", ...)`, and `MacroExpander` expands it into catalog components before the renderer sees anything. Stated gains: fewer output tokens and lower latency, consistent layout "because your server code constructs the component hierarchy", server-side data lookup from an identifier, and new components shipped without a client release. (Macros guide.) Lost or limited: Python only at present; the model still writes Express, so the notation must still be taught. **T:** the second point is my reading.

### Delegate to a specialist model

**W.** `a2ui_specialist` in the eval suite and `generate_a2ui` in CopilotKit hide A2UI from the main agent entirely: it sends a plain-language request and a second model writes the payload. Gained: the main agent's context holds no A2UI material. Lost: a second model call per surface, and CopilotKit's version "waits for the full `components` array before emitting anything". (Eval README; CopilotKit, dynamic schema.) **T:** no figures compare the specialist's validity with direct generation in what I read.

### Related practice

- **W.** Google's Gemini Notebook uses A2UI cards to gather choices before generating a deck, which is the questions-and-decisions job. The post does not say how the cards are produced. (Blog, 1.0.)
- **T.** Love recommends fixed layouts "by default" for predictable flows, and generation only for the long tail with a fallback to the fixed layout. Opinion, no data. (Love.)

## What this means for Quay

All **T**: these are my inferences from the findings above, offered for the decisions the map still has open.

1. **The SDK's main path does not fit a CLI as it stands.** It assumes the host owns the system prompt and reads the model's text reply. Quay owns neither for a coding CLI. The two documented paths that survive are a tool that takes the block as one string and validates it, and a skill file the agent loads on demand.
2. **Teaching by tool description is expensive at full size.** The whole basic catalog costs about 5,800 tokens in Express and about 10,800 as minified schema. A pruned question-card subset is nearer 2,900. A skill read on demand costs nothing until used, and `SkillGenerator` already emits the files.
3. **For the questions-and-decisions job, a fixed-layout tool avoids the teaching problem.** A tool such as "ask a question with these options" needs no A2UI knowledge in the agent, cannot produce an invalid surface, and matches a pattern both CopilotKit and the project's MCP guide document. The cost is that each such tool covers one shape of surface.
4. **Validation errors belong in the tool result.** That is what the ADK tool does, and it lets the CLI's own loop do the retry. The spec's error shape (`code`, `surfaceId`, `path`, one-sentence `message`) is the text to return, with a cap of about two retries.
5. **There is no Rust agent SDK.** Prompt generation, the Express compiler and the validator exist in TypeScript, Python and Dart. Quay's server is Rust, so validation would run in the TypeScript front end, in a sidecar, or be reimplemented. This needs its own decision.
6. **Expect version bleed.** The most cited schema failure is properties from another protocol or catalog version. Models that later learn A2UI from training data will have seen 0.8 and 0.9 as well as 1.0, so validation stays necessary even when models "know" the standard.
7. **Reliability on the CLIs' models is unmeasured.** The published 96 to 98% is Gemini Flash with the SDK's prompt in the system message. Quay would need its own small eval; the project's harness accepts `anthropic/` and `openai/` models and has a `skill_mode` strategy close to how a CLI would load the instructions.

## Not established

- The exact size of the Direct JSON prompt the SDK generates for the basic v1 catalog. I measured the source files and read the published medians but did not run the SDK.
- Whether any Express `help` hint reaches the retry text.
- The input schema of CopilotKit's `render_a2ui` tool.
- Any validity figure for Claude Code, Codex or other coding CLIs writing A2UI or Express.
- Results for the eval suite's `skill_mode` and `subagent_tool` strategies.
