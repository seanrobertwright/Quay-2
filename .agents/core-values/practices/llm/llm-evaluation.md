# LLM evaluation

> **Load when:** building or reviewing evals, metrics, judges, eval sets, model
> selection, or regression gates for LLM features; writing tests around model
> calls; comparing prompts, models, or providers; turning user feedback into
> eval data.
> **See also:** [LLM applications](../llm/llm-applications.md), [LLM inference and serving](../llm/inference-and-serving.md),
> [Finetuning and training data](../llm/finetuning-and-data.md), [Machine learning systems](../ml/ml-systems.md),
> [Testing](../testing/testing.md), [Observability](../operations/observability-and-reliability.md)

## Top rules

1. **Define success criteria and the evaluation method before building the
   feature, and run the eval set in CI on every model, prompt, tool, or
   retrieval change.** *[Claude Docs: Define success criteria and build
   evaluations; OpenAI Docs: Evaluation best practices; Agent Evals: Capability
   vs. regression evals; AIE ch. 4, Evaluation Criteria]*
2. **Prefer code graders to LLM judges, and judges to humans.** Execute the
   code, run the SQL, check the schema. *[Claude Docs: Define success criteria
   and build evaluations; AIE ch. 3, Functional Correctness]*
3. **Calibrate every LLM judge against human labels, and version its model,
   prompt, and sampling settings as one unit.** *[Agent Evals: Model-based
   graders; AIE ch. 3, How to Use AI as a Judge]*
4. **Build eval sets from real failures and production traffic, with slices,
   hard cases, and out-of-scope inputs.** *[Agent Evals: Step 0. Start early;
   AIE ch. 4, Annotate evaluation data]*
5. **Evaluate every component on its own and the system end to end.** *[OpenAI
   Docs: Evaluation best practices; AIE ch. 4, Step 1. Evaluate All Components
   in a System]*
6. **Size each set for the difference you must detect, and run live cases
   several times.** *[AIE ch. 4, Annotate evaluation data; Agent Evals: How to
   think about non-determinism in evaluations for agents]*
7. **Read a sample of transcripts from every eval run, and a sample of
   production conversations each day, before trusting a score.** *[Agent
   Evals: Step 6: Check the transcripts; AIE ch. 4, Select evaluation
   methods; AIE ch. 10, Logs and traces]*
8. **Never score open-ended output with lexical overlap or substring
   matching; keep exact and substring checks for closed-form answers.** *[AIE
   ch. 3, Similarity Measurements Against Reference Data]*

## Criteria and guidelines

- **Give each criterion a number to hit, such as an F1 score on a labeled set
  or a p95 latency, and cover task fidelity, consistency, tone, privacy,
  context use, latency, and price.** "Good answers" is not a criterion.
  *[Claude Docs: Define success criteria and build evaluations]*
- **Write the criteria and method before the feature exists, aimed at where the
  system is likely to fail.** A feature nobody can evaluate costs to keep and
  more to remove; a handful of favorite prompts cannot support iteration. *[AIE
  ch. 4, Evaluation Criteria]*
- **Write an evaluation guideline that says what the application must not do as
  well as what it should, including which inputs are out of scope and the
  expected reply.** A correct answer can still be a bad one. *[AIE ch. 4, Step
  2. Create an Evaluation Guideline]*
- **Validate the scoring rubric with human raters until they apply it
  consistently.** *[AIE ch. 4, Step 2. Create an Evaluation Guideline]* Reusing
  it as an annotation guide is in [Finetuning and training
  data](../llm/finetuning-and-data.md).
- **Map scores to business outcomes and a minimum usefulness score**, such as
  the share of tickets that can be automated at a given factual-consistency
  level, so you know whether a gain is worth its cost. Do not optimize for
  engagement alone. *[AIE ch. 4, Tie evaluation metrics to business metrics]*

## Eval sets

- **Start with a few dozen cases from real failures, then add edge, ambiguous,
  multilingual, jailbreak, and injection inputs and every production
  failure.** *[Agent Evals: Step 0. Start early; OpenAI Docs: Evaluation best
  practices]*
- **Keep several sets: one matching the production distribution, slices by user
  tier and traffic source, known hard cases, realistic user mistakes such as
  typos, and out-of-scope inputs.** Every property you care about gets its own
  set. *[AIE ch. 4, Annotate evaluation data]* Per-slice reporting is in
  [Machine learning systems](../ml/ml-systems.md).
- **Size a gating set for the smallest difference it must detect, and bootstrap
  it.** Each threefold smaller difference needs about ten times the examples;
  if resampled sets score very differently, the set is too small. Treat a few
  hundred examples as a floor. *[AIE ch. 4, Annotate evaluation data]*
- **Keep your own eval data private and out of training data.** Public test
  sets leak into model training. *[AIE ch. 4, Data contamination with public
  benchmarks]* Decontaminating training data is in [Finetuning and training
  data](../llm/finetuning-and-data.md).
- **Keep eval cases, graders, and judge prompts in the repository, versioned
  with the code they test, and run them from your own harness.** Hosted eval
  products get retired: OpenAI is shutting down its hosted Evals platform in
  late 2026. *[OpenAI Docs: Evaluation best practices]*

## Graders

- **Use functional correctness wherever the task allows, and grade efficiency
  too.** Run generated code against tests and check that SQL runs and returns
  the right rows; a correct query that is too slow still fails. *[AIE ch. 3,
  Functional Correctness; AIE ch. 4, Domain-Specific Capability]*
- **Do not score open-ended output with BLEU, ROUGE, or "contains the answer"
  checks; use exact or substring match only for closed-form outputs such as a
  label, an enum value, or an extracted field.** Reference sets are incomplete,
  and substring checks pass wrong answers that contain the right token. *[AIE
  ch. 3, Similarity Measurements Against Reference Data; Claude Docs: Define
  success criteria and build evaluations]*
- **Grade outcomes, not exact paths, and read transcripts before trusting a
  score.** *[Agent Evals: Step 5: Design graders thoughtfully; Agent Evals:
  Step 6: Check the transcripts]*
- **Combine methods to control cost: a cheap classifier or code check on all
  traffic and an expensive judge on a sample.** Logprobs give a confidence
  signal for classification where the API returns them; many do not. *[AIE
  ch. 3, Increased costs and latency; AIE ch. 4, Select evaluation methods]*
- **Back judges with exact metrics and with humans reviewing a daily sample of
  production conversations.** Daily review catches shifts that metrics miss.
  *[AIE ch. 3, Summary; AIE ch. 4, Select evaluation methods; AIE ch. 10, Logs
  and traces]*

## LLM judges

- **Give a judge the task, a rubric with an example and justification per
  score, a pass/fail or small discrete scale, an "unknown" option, and
  reasoning before the score (thinking enabled on the grader where the model
  supports it); check it against human labels before relying on it.** Labels
  beat numeric scores, and a 1-to-5 scale beats a continuous one. *[Claude
  Docs: Define success criteria and build evaluations; OpenAI Docs: Evaluation
  best practices; Agent Evals: Model-based graders; Agent Evals: Step 5:
  Design graders thoughtfully; AIE ch. 3, How to Use AI as a Judge]*
- **Treat a judge as model plus prompt plus sampling settings, version all
  three, and never compare scores across a change to any of them.** Built-in
  criteria with the same name differ between tools; do not trust a judge whose
  model and prompt you cannot see. *[AIE ch. 3, How to Use AI as a Judge; AIE
  ch. 3, Criteria ambiguity]*
- **Control judge biases: grade with a different model from the one that
  produced the output, rerun pairwise comparisons with the order swapped, and
  check for a preference for longer answers.** Models favor their own outputs.
  *[Claude Docs: Define success criteria and build evaluations; OpenAI Docs:
  Evaluation best practices; AIE ch. 3, Biases of AI as a judge]*
- **Run an expensive judge off the request path.** An inline judge adds
  latency; review in the background instead, or use the judge only as a sampled
  guardrail. *[AIE ch. 3, Increased costs and latency]*
- **Use pairwise comparison for subjective quality, but add absolute metrics
  before switching models.** A win rate says which is better, not whether
  either is good enough or worth its extra cost. *[AIE ch. 3, Challenges of
  Comparative Evaluation]*

## Components, retrieval, and agents

- **Run regression evals per step and end to end on every prompt, model, tool,
  or retrieval change, and for conversations score both each turn and the whole
  task.** Only per-stage scores show which stage failed. *[OpenAI Docs:
  Evaluation best practices; Agent Evals: Capability vs. regression evals; AIE
  ch. 4, Step 1. Evaluate All Components in a System]*
- **Evaluate retrieval separately from generation, with recall at k and context
  precision on labeled query-to-chunk pairs, NDCG or MRR when order matters,
  and the final answers.** A retriever is good only if it improves answers.
  *[Contextual Retrieval: Methodology; OpenAI Docs: Evaluation best practices;
  AIE ch. 6, Comparing retrieval algorithms]*
- **Measure factual consistency against the supplied context, splitting long
  answers into claims checked one by one.** Use an entailment classifier or a
  judge; weight the hallucination set toward niche facts and things that do not
  exist. *[AIE ch. 4, Factual consistency]*
- **Build your own instruction-following and robustness set from your real
  format, style, and persona rules, and perturb prompts slightly to measure
  sensitivity.** Public benchmarks miss the instructions you depend on. *[AIE
  ch. 4, Instruction-following criteria; AIE ch. 4, Roleplaying]*
- **Evaluate agents on a planning set of tasks with their tool inventories:
  valid-plan rate, calls to missing tools, invalid or wrong arguments, goal
  failures, and false claims of completion.** Also measure steps, cost, and
  time per task against a baseline, and test each tool on its own. *[AIE ch. 6,
  Agent Failure Modes and Evaluation; OpenAI Docs: Evaluation best practices]*

## Nondeterminism and tests around model calls

- **Unit-test against a client interface fed recorded responses (refusal,
  truncated, malformed, rate-limited) and assert on parsed structure, never
  wording.** *[Claude Docs: Stop reasons and fallback; Claude Docs: Claude API
  errors; Claude Docs: Define tools]* See [Testing](../testing/testing.md).
- **Run live evals several times per case, each trial from a clean
  environment, and report pass@k where one success suffices or pass^k where
  every attempt must succeed.** *[Agent Evals: How to think about
  non-determinism in evaluations for agents; Agent Evals: Step 4: Build a
  robust eval harness with a stable environment]*
- **Evaluate the eval pipeline itself: better responses must score higher,
  reruns must reproduce, and correlated metrics are redundant.** *[AIE ch. 4,
  Evaluate your evaluation pipeline]*
- **Log every variable in the eval run (data, rubric, judge prompt, judge model
  and sampling settings) so a score change traces to the application, not the
  evaluator.** Where a judge's temperature cannot be fixed, pin the snapshot
  and prompt and average several judge runs (updated from older
  temperature-zero advice). *[AIE ch. 4, Iterate]*

## Model selection

- **Select models in stages: filter on hard attributes (license, privacy,
  hosting, fixed latency needs), shortlist from public data, run your own eval
  pipeline, then monitor in production.** *[AIE ch. 4, Model Selection
  Workflow]*
- **Prove feasibility on the strongest model you can afford, then test cheaper
  models against it.** If the strongest fails, weaker ones will too. *[AIE ch.
  4, Model Selection Workflow; AIE ch. 4, Cost and Latency]*
- **Use public benchmarks and leaderboards only to rule models out.** Check
  which capabilities they cover and how they aggregate, and assume
  contamination. *[AIE ch. 4, Navigate Public Benchmarks; AIE ch. 4, Data
  contamination with public benchmarks]*
- **Decide between a model API and self-hosting on privacy, data lineage and IP
  indemnity, performance, functionality, cost including engineering, control,
  and on-device needs, and revisit as scale changes.** Check each license for
  commercial use and for whether outputs may train other models. *[AIE ch. 4,
  Model Build Versus Buy]* Cost curves, and the eval rerun a provider or
  serving change needs, are in [LLM inference and
  serving](../llm/inference-and-serving.md).

## User feedback as eval data

- **Log implicit signals: early stops, "no, I meant" follow-ups, rephrasing,
  regenerations, and edits, and read conversation length against the product's
  purpose.** A user's edit beats the original as a preference pair. *[AIE ch.
  10, Extracting Conversational Feedback]*
- **Never ask users to choose between answers they cannot judge**, and offer an
  "I don't know" option. Comparative votes work only when the user could do the
  task. *[AIE ch. 3, Ranking Models with Comparative Evaluation; AIE ch. 10,
  How to collect feedback]*
- **Correct for leniency, position, length, and random-click bias before acting
  on feedback.** Optimizing for approval alone makes a model sycophantic. *[AIE
  ch. 10, Feedback Limitations]*

## Tensions

- **LLM-as-judge vs human review.** House position: code checks first, judges
  calibrated to human labels, humans for high stakes and a daily sample.
  *[Claude Docs: Define success criteria and build evaluations; Agent Evals:
  Types of graders for agents; AIE ch. 3, Summary]*
- **Small discrete scale vs binary pass/fail.** House position: one binary
  verdict per criterion where the criterion allows it, otherwise a small scale
  with an anchored example per score; both calibrated to humans. *[AIE ch. 3,
  How to Use AI as a Judge; Claude Docs: Define success criteria and build
  evaluations]*
- **Temperature zero vs averaged judge runs.** Older advice fixes the judge's
  temperature at zero; many reasoning models ignore it. House position: pin the
  judge snapshot and prompt, and average several runs. *[AIE ch. 4, Iterate;
  Agent Evals: Model-based graders]*
- **A few dozen cases vs statistically sized sets.** House position: start with
  a few dozen real failures to find problems fast; grow a set to the size its
  gate needs before it blocks releases. *[Agent Evals: Step 0. Start early; AIE
  ch. 4, Annotate evaluation data]*
- **Overlap and substring metrics vs judges.** Claude's eval examples use
  ROUGE-L and string match; the book warns against both for open-ended text.
  House position: exact and substring checks for closed-form outputs, a
  calibrated judge or functional check for open-ended ones. *[Claude Docs:
  Define success criteria and build evaluations; AIE ch. 3, Similarity
  Measurements Against Reference Data]*
- **Win rate vs absolute quality.** House position: pairwise for choosing
  between candidates, absolute metrics for deciding whether to ship. *[AIE ch.
  3, Challenges of Comparative Evaluation]*

## Sources

- **Claude Docs**: Claude API documentation (Anthropic), cited by page title, <https://platform.claude.com/docs/>
- **OpenAI Docs**: OpenAI API documentation, cited by guide title, <https://developers.openai.com/api/docs/>
- **Agent Evals**: Demystifying evals for AI agents (Anthropic, January 2026), <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>
- **Contextual Retrieval**: Introducing Contextual Retrieval (Anthropic, September 2024), <https://www.anthropic.com/engineering/contextual-retrieval>
- **AIE**: AI Engineering: Building Applications with Foundation Models (Chip Huyen, O'Reilly, 1st ed., 2025)
