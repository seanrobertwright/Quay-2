# LLM applications

> **Load when:** writing or reviewing code that calls an LLM API or SDK:
> scoping an AI feature, prompts, structured output, tool calling, agents, RAG
> and embeddings, context and memory, retries, prompt injection, MCP, tracing,
> or showing AI output to users. Evals and serving cost have their own files.
> **See also:** [LLM evaluation](../llm/llm-evaluation.md), [LLM inference and serving](../llm/inference-and-serving.md),
> [Finetuning and training data](../llm/finetuning-and-data.md), [Machine learning systems](../ml/ml-systems.md),
> [Specifying intent for AI coding agents](../core/working-with-ai-agents.md), [Testing](../testing/testing.md),
> [Application security](../security/application-security.md), [Search](../data/search-elasticsearch.md),
> [Observability](../operations/observability-and-reliability.md), [Cloud architecture](../cloud/cloud-architecture.md)

## Top rules

1. **Pin a snapshot model ID, never a moving alias.** An alias changes behavior
   without review. *[Claude Docs: Model IDs and versioning; Gemini Docs:
   Models; OpenAI Docs: Prompt engineering]*
2. **Gate every model or prompt change on a task-specific eval set run in CI.**
   How to build one: [LLM evaluation](../llm/llm-evaluation.md). *[Claude Docs:
   Define success criteria and build evaluations; AIE ch. 4, Evaluation Criteria]*
3. **Treat every model response as untrusted input: check the stop reason, then
   parse it with a schema parser at the boundary.** *[Claude Docs: Structured
   outputs; Claude Docs: Stop reasons and fallback; Review lessons]*
4. **Encode model output for its sink.** Escape for HTML, bind as a SQL
   parameter, and never pass it to a shell or `eval`. *[OWASP LLM: LLM05
   Improper Output Handling; Review lessons]*
5. **Authorize every tool call in code, as the end user, with the tenant from
   the session.** Model arguments are a request, not a permission. *[OWASP LLM:
   LLM06 Excessive Agency; Review lessons]*
6. **Assume prompt injection sometimes succeeds and limit what it can reach.**
   Delimit untrusted content, grant least privilege, and gate consequential
   actions on human approval. *[OWASP LLM: LLM01 Prompt Injection; Claude Docs:
   Mitigate jailbreaks and prompt injections]*
7. **Use the simplest design that passes the evals, and bound every loop.**
   *[Effective Agents: When (and when not) to use agents; OWASP LLM: LLM10
   Unbounded Consumption]*
8. **Give every model call a timeout, retry only transient errors at one layer
   with backoff, and define a fallback.** *[Claude Docs: Claude API errors;
   Claude Docs: Rate limits; Review lessons]*
9. **Keep secrets out of prompts, and PII out of prompts and logs unless the
   feature needs it.** *[OWASP LLM: LLM07 System Prompt Leakage; OWASP LLM:
   LLM02 Sensitive Information Disclosure]*
10. **Record model ID, prompt name and version, token usage, stop reason, and
    provider request ID on every call.** *[OTel GenAI: Client inference; Claude
    Docs: Claude API errors]*

## Planning and use-case evaluation

- **Set each feature's quality bar from whether it is critical or complementary
  and reactive or proactive.** Unrequested output needs a higher bar. *[AIE ch.
  1, Use Case Evaluation]*
- **Write a usefulness threshold (business metric, quality, latency, cost)
  before launch, and automate in stages: AI drafts for humans first.** *[AIE
  ch. 1, Setting Expectations; AIE ch. 1, Use Case Evaluation]*
- **Add components only when a need appears (context, guardrails, router,
  caches, then agent loops and write actions), with observability from the
  start.** *[AIE ch. 10, AI Engineering Architecture]*

## Models and versioning

- **Pin a stable snapshot ID (dated or fixed dateless) and any sampling
  settings the model accepts in configuration, never "latest" or
  experimental.** *[Claude Docs: Model IDs and versioning; Gemini Docs: Models;
  AIE ch. 2, The Probabilistic Nature of AI]*
- **Treat a model change as a release: full evals, cost and latency comparison,
  recounted token budgets, prompt rework, and a plan made before the pinned
  model's retirement date.** Tokenizers change between generations. *[Claude
  Docs: Token counting; Claude Docs: Models overview; AIE ch. 1, Maintenance]*
- **Keep monitoring quality on an unchanged model ID, and hash the prompt
  template to catch unreviewed edits.** Serving changes and silent provider
  updates shift behavior. *[Claude Docs: Model IDs and versioning; AIE ch. 10,
  Drift detection]*

## Prompt design

- **Keep prompts in the repo as code: typed inputs, review, tests, the normal
  deploy path, a name and version, with target model, sampling settings, and
  schemas alongside.** OpenAI is retiring its hosted prompt objects. *[OpenAI
  Docs: Prompt engineering; AIE ch. 5, Organize and Version Prompts]*
- **Put role, rules, and output contract (named keys, no preamble) in the
  system or developer message and end-user text in the user turn.** *[OpenAI
  Docs: Prompt engineering; Claude Docs: Prompting best practices; AIE ch. 5,
  Specify the output format]*
- **Match the model's chat template exactly when building raw prompts, and
  print the final assembled prompt.** A wrong template degrades output
  silently. *[AIE ch. 5, System Prompt and User Prompt]*
- **Start minimal, give each instruction its reason, spell out edge cases and
  what to do when unsure, and add rules only for failures the evals show.**
  *[Claude Docs: Prompting best practices; Context Eng: The anatomy of
  effective context; AIE ch. 5, Write Clear and Explicit Instructions]*
- **Use a few diverse examples in their own tags, separate instructions,
  context, and input with consistent tags, and put long documents first.**
  *[Claude Docs: Prompting best practices; OpenAI Docs: Prompt engineering]*
- **Set reasoning depth with the effort or thinking setting, not a hand-written
  step-by-step plan; ask for visible chain-of-thought only when thinking is
  off** (updated from older chain-of-thought advice). *[Claude Docs: Prompting
  best practices; AIE ch. 5, Give the Model Time to Think]*
- **Deliver untrusted strings JSON-encoded inside tool results, and keep your
  own instructions out of tool results.** The model treats tool-result text as
  data. *[Claude Docs: Mitigate jailbreaks and prompt injections]*
- **Get fixed formats from structured outputs or strict tools, not a prefilled
  assistant turn.** Claude 4.6 and later return a 400 on prefill, and some
  newer models reject forced `tool_choice` (updated from older advice).
  *[Claude Docs: Prompting best practices; Claude Docs: Claude API errors]*

## Structured output and response validation

- **Use the provider's schema-constrained output or strict tool mode, with the
  schema generated from your typed models.** On Claude the parameter is
  `output_config.format`; the beta `output_format` is deprecated. *[OpenAI
  Docs: Structured model outputs; Claude Docs: Structured outputs]*
- **Check the stop reason, then validate again with your own parser, rejecting
  NaN, empty strings, malformed IDs, and out-of-range values.** Without a
  schema mode, also repair the model's recurring format errors. *[Claude Docs:
  Structured outputs; AIE ch. 2, Structured Outputs; Review lessons]*
- **Compare enums case-insensitively, ignore property order, and never branch
  on free text around a structured block.** *[Claude Docs: Structured outputs;
  Claude Docs: Define tools]*
- **Tell the model what to return when the input cannot yield a valid answer,
  and give the schema a field for it.** Otherwise it invents values. *[OpenAI
  Docs: Structured model outputs]*

## Tool use and function calling

- **Describe each tool for a new hire (purpose, when not to use it, each
  parameter, limits, an example), and split complex tools before reaching for a
  bigger model.** *[Claude Docs: Define tools; Writing Tools:
  Prompt-engineering your tool descriptions; AIE ch. 6, Plan generation]*
- **Keep tools few, distinct, and namespaced, drop any whose removal does not
  hurt the evals, and make invalid calls unrepresentable with enums, required
  fields, and strict mode.** Add a calculator or sandboxed code tool for work
  the model is weak at. *[OpenAI Docs: Function calling; Writing Tools:
  Namespacing your tools; AIE ch. 6, Tool selection]*
- **Never ask the model for values the code knows.** User, tenant, and record
  IDs come from the session. *[OpenAI Docs: Function calling; Review lessons]*
- **Parse every argument at the handler and run the same authorization and
  tenant-scoped queries as the equivalent HTTP endpoint.** *[OWASP LLM: LLM06
  Excessive Agency; Review lessons]*
- **Make side-effecting tools idempotent, with the key enforced by a unique
  constraint.** The model retries after an error result, and transport retries
  replay requests. *[Claude Docs: Handle tool calls; Review lessons]*
- **Handle zero, one, or many calls per turn; return each result by call ID,
  and errors as error-flagged results that say what to try next.** *[OpenAI
  Docs: Function calling; Claude Docs: Handle tool calls]*
- **Paginate, filter, and truncate results by default, and say how to narrow.**
  *[Writing Tools: Optimizing tool responses for token efficiency]*

## Workflows and agents

- **Start with one call plus retrieval and examples; add a gated workflow when
  evals demand it, and an agent only for open-ended tasks.** Errors compound:
  at 95% per step, ten steps succeed about 60% of the time. *[Effective Agents:
  When (and when not) to use agents; AIE ch. 6, Agent Overview]*
- **Split a complex prompt into chained steps behind a small intent router with
  an out-of-scope class, so each step can be tested or run on a cheaper
  model.** *[AIE ch. 5, Break Complex Tasks into Simpler Subtasks; AIE ch. 10,
  Router]*
- **Call the API directly before adopting a framework, then read the prompts it
  generates and count its calls.** Hidden layers hinder debugging. *[Effective
  Agents: When and how to use frameworks; AIE ch. 5, Evaluate Prompt
  Engineering Tools]*
- **Give every agent loop a turn cap, token and spend budgets, a wall-clock
  timeout, and a cap on queued actions.** *[Effective Agents: Agents; OWASP
  LLM: LLM10 Unbounded Consumption]*
- **Validate each plan before running it (known tools, step limit), and check
  the result after each action and at the end.** *[AIE ch. 6, Planning
  overview; AIE ch. 6, Reflection and error correction]*
- **Require human approval for destructive, irreversible, externally visible,
  or financial actions, showing the exact action, and keep read-only tools
  apart from write tools.** *[OWASP LLM: LLM06 Excessive Agency; Claude Docs:
  Prompting best practices; AIE ch. 6, Write actions]*
- **Have sub-agents return condensed summaries, and add agents only when evals
  show the gain.** *[Context Eng: Sub-agent architectures; OpenAI Docs:
  Evaluation best practices]*

## Retrieval-augmented generation and embeddings

- **Measure a BM25 baseline, then combine it with embedding search and rerank,
  weighting recency for time-sensitive corpora.** Embeddings blur exact
  identifiers. *[Contextual Retrieval: Further boosting performance with
  Reranking; AIE ch. 6, Combining retrieval algorithms; AIE ch. 6, Reranking]*
  Retrieval evals: see [LLM evaluation](../llm/llm-evaluation.md).
- **Chunk along document structure with overlap, keep each chunk's identifying
  context (title, entity, date), and tune size by experiment.** *[Contextual
  Retrieval: The context conundrum in traditional RAG; AIE ch. 6, Chunking
  strategy; AIE ch. 6, Contextual retrieval]*
- **Rewrite each follow-up turn into a standalone query before retrieval, and
  mark it unresolvable rather than guess.** *[AIE ch. 6, Query rewriting]*
- **Filter by tenant and caller permissions inside the store query, never after
  it.** *[OWASP LLM: LLM08 Vector and Embedding Weaknesses; Review lessons]*
- **Store source ID, version, and modified time with every chunk, and re-index
  or delete a source's chunks when it changes, is deleted, or narrows its
  permissions; index only validated sources and log retrievals.** A
  permission-aware store is only as current as its last sync. *[NIST 600-1:
  GV-6.1-008; OWASP LLM: LLM08 Vector and Embedding Weaknesses; Review
  lessons]*
- **Never mix embedding models in one index; re-embed into a new index on a
  model change.** Their vector spaces differ. *[Gemini Docs: Embeddings]* See
  [ML systems](../ml/ml-systems.md).
- **Use query and document input types consistently, match the distance metric
  to the model, and renormalize any vector you truncate yourself.** *[Claude
  Docs: Embeddings; Gemini Docs: Embeddings]*

## Context and memory

- **Send the smallest high-signal context; load bulk data just in time and
  compact old tool results.** *[Context Eng: Why context engineering is
  important to building capable agents; Context Eng: Compaction]*
- **Put critical instructions at the start or end of a long prompt, and test
  mid-context recall with facts the model cannot already know.** *[AIE ch. 5,
  Context Length and Context Efficiency]*
- **Summarize old chat history instead of dropping it oldest-first**, which can
  lose the user's goal. *[AIE ch. 6, Memory]*
- Caching, token caps, quotas, streaming, and batching: see [LLM inference and
  serving](../llm/inference-and-serving.md).

## Reliability

- **Set the SDK client's timeout and retry count explicitly, and set SDK
  retries to zero if another layer retries.** SDKs retry transient errors by
  default. *[Claude Docs: Claude API errors]*
- **Retry rate-limit, overload, and 5xx errors with backoff and `retry-after`
  at one layer; never retry other 4xx errors unchanged or a spend-cap
  rejection.** On Claude a tier spend-cap 429 has no `retry-after` and a spend
  limit you set returns a 400. *[Claude Docs: Claude API errors; Claude Docs:
  Rate limits]*
- **Branch on every stop reason and handle mid-stream errors; on a token-limit
  stop, continue, retry larger, or mark the truncation, never storing it as
  complete.** A refusal returns as success; fall back, never loop. *[Claude
  Docs: Stop reasons and fallback; Claude Docs: Refusals and fallback]*
- **Give each output failure class (malformed, unfaithful, toxic, PII,
  unintended tool call) a policy: retry, repair, block, or hand to a human.**
  Where one sample is unreliable, vote or regenerate until a cheap check
  passes. *[AIE ch. 10, Output guardrails; AIE ch. 2, Test Time Compute]*
- **Define the degraded path and a config switch that turns the feature off.**
  *[OWASP LLM: LLM10 Unbounded Consumption; NIST 600-1: GV-1.7-001]*

## Security

- **Threat-model direct injection (the user) and indirect injection (pages,
  email, files, tool results); label third-party content by source and tell the
  model it is data.** *[OWASP LLM: LLM01 Prompt Injection; Claude Docs:
  Mitigate jailbreaks and prompt injections; AIE ch. 5, Indirect prompt
  injection]*
- **Screen untrusted input and tool output with a cheap classifier that returns
  a structured verdict, count a refusal from the screen as a hit, and red-team
  before release, reporting violation and false-refusal rates together.**
  *[Claude Docs: Mitigate jailbreaks and prompt injections; NIST 600-1:
  MP-5.1-005; AIE ch. 5, Defenses Against Prompt Attacks]*
- **Allowlist `http`, `https`, `mailto`, and relative URLs in rendered links
  and images, and set a strict CSP.** *[OWASP LLM: LLM05 Improper Output
  Handling; Review lessons]*
- **Grant minimal tools and permissions, avoid open-ended shell or fetch tools,
  sandbox generated code, verify package names in it before installing, and
  enforce authorization downstream, never by prompt.** Write the system prompt
  as if it will leak. *[OWASP LLM: LLM06 Excessive Agency; OWASP LLM: LLM07
  System Prompt Leakage; OWASP LLM: LLM09 Misinformation; AIE ch. 5,
  System-level defense]*
- **Redact or mask PII before prompts and logs, scan output for leaks, and send
  only hashed end-user IDs (OpenAI's `safety_identifier`).** *[OWASP LLM: LLM02
  Sensitive Information Disclosure; NIST 600-1: MP-4.1-009; OpenAI Docs: Safety
  best practices; AIE ch. 10, Input guardrails]*
- **In an MCP client, distrust tool descriptions from untrusted servers, get
  consent before tools run, show the exact command before adding a local server
  and sandbox it, request minimal scopes, and block private IPs and unchecked
  redirects on OAuth metadata fetches.** *[MCP: Security and Trust & Safety;
  MCP: Security Best Practices]*
- **In an MCP server that authorizes, verify every request, accept only tokens
  issued for it, never pass client tokens downstream, and key state handles to
  the verified user.** A handle is never authentication. *[MCP: Security Best
  Practices]*

## Observability

- **Emit an OpenTelemetry GenAI span per call with provider, requested and
  responded model, response ID, token counts, and finish reasons, and trace
  each request end to end with step timing, cost, and tool arguments.** Pin the
  instrumentation version; the conventions are in Development status. *[OTel
  GenAI: Client inference; AIE ch. 10, Logs and traces]*
- **Set `gen_ai.prompt.name` and `gen_ai.prompt.version` from the prompt in the
  repo, and add the provider request ID as a custom attribute.** *[OTel GenAI:
  Client inference; Claude Docs: Claude API errors]*
- **Capture prompt and response content only opt-in, redacted, and in
  access-controlled storage.** *[OTel GenAI: Generative client AI spans; OWASP
  LLM: LLM02 Sensitive Information Disclosure]*
- **Alert per feature on format failures, refusals, tokens, latency, and cost,
  sliced by release and prompt version.** *[AIE ch. 10, Metrics; OpenAI Docs:
  Production best practices]*

## Grounding and user-facing output

- **Let the model say it does not know, ask for concise answers, have it quote
  long documents before answering, require a citation per claim, drop
  unsupported claims, and show sources.** *[Claude Docs: Reduce hallucinations;
  NIST 600-1: MS-2.5-003; AIE ch. 2, Hallucination]*
- **Send high-stakes output to human review with the sources at hand.**
  *[OpenAI Docs: Safety best practices; OWASP LLM: LLM09 Misinformation]*
- **Label AI-generated content, disclose AI interaction, and state the
  feature's limits.** *[OWASP LLM: LLM09 Misinformation; NIST 600-1:
  GV-5.1-002]*
- **Let users edit, reject, or report output, route reports to a person, mark
  truncated responses, and get consent before attaching conversation context to
  feedback.** *[OpenAI Docs: Safety best practices; NIST 600-1: GV-3.2-004;
  Claude Docs: Stop reasons and fallback; AIE ch. 10, Feedback Design]* Using
  feedback as eval data: see [LLM evaluation](../llm/llm-evaluation.md).

## Evals and tests

- Eval sets, graders, LLM judges, regression gates, tests around model calls,
  and model selection: see [LLM evaluation](../llm/llm-evaluation.md).

## Tensions

- **Agents vs fixed workflows.** House position: a gated workflow by default;
  an agent only where evals show the workflow fails, with caps and approval
  gates. *[Effective Agents: When (and when not) to use agents]*
- **Long context vs RAG.** House position: a small, stable corpus goes in a
  cached prompt; large, changing, or per-tenant corpora use retrieval, since
  cost grows and recall falls as context fills. *[Contextual Retrieval: A note
  on simply using a longer prompt; AIE ch. 6, RAG]*
- **BM25 first vs hybrid from day one.** House position: hybrid with reranking
  in production, after a measured BM25 baseline. *[AIE ch. 6, Comparing
  retrieval algorithms; Contextual Retrieval: Methodology]*
- **Prompts in the repo vs a prompt catalog.** House position: the repo; a
  catalog with pinned versions only when several services share a prompt.
  *[OpenAI Docs: Prompt engineering; AIE ch. 5, Organize and Version Prompts]*
- **Log everything vs opt-in content capture.** House position: always log
  metadata and tool arguments; full text only opt-in and redacted. *[AIE ch.
  10, Logs and traces; OTel GenAI: Generative client AI spans]*
- **Fine-tuning vs prompting.** House position: prompting, examples, and
  retrieval first; fine-tune when evals plateau and labeled data exists (see
  [Finetuning](../llm/finetuning-and-data.md)). *[Claude Docs: Prompt
  engineering overview; AIE ch. 7, Finetuning and RAG]*

## Sources

- **Claude Docs**: Claude API documentation (Anthropic), cited by page title, <https://platform.claude.com/docs/>
- **Effective Agents**: Building effective agents (Anthropic, December 2024), <https://www.anthropic.com/engineering/building-effective-agents>
- **Context Eng**: Effective context engineering for AI agents (Anthropic, September 2025), <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- **Writing Tools**: Writing effective tools for agents, with agents (Anthropic, September 2025), <https://www.anthropic.com/engineering/writing-tools-for-agents>
- **Contextual Retrieval**: Introducing Contextual Retrieval (Anthropic, September 2024), <https://www.anthropic.com/engineering/contextual-retrieval>
- **OpenAI Docs**: OpenAI API documentation, cited by guide title, <https://developers.openai.com/api/docs/>
- **Gemini Docs**: Gemini API documentation (Google), <https://ai.google.dev/gemini-api/docs>
- **OWASP LLM**: OWASP Top 10 for LLM Applications 2025, cited by risk, <https://genai.owasp.org/llm-top-10/>
- **NIST 600-1**: NIST AI 600-1, AI Risk Management Framework: Generative Artificial Intelligence Profile (July 2024), cited by action ID, <https://doi.org/10.6028/NIST.AI.600-1>
- **OTel GenAI**: OpenTelemetry semantic conventions for generative AI, cited by document title, <https://github.com/open-telemetry/semantic-conventions-genai>
- **MCP**: Model Context Protocol specification 2026-07-28, <https://modelcontextprotocol.io/specification/2026-07-28>, and its Security Best Practices page, <https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices>
- **AIE**: AI Engineering: Building Applications with Foundation Models (Chip Huyen, O'Reilly, 1st ed., 2025)
- **Review lessons**: rules distilled from the maintainer's code-review findings
