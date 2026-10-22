# Finetuning and dataset engineering for LLMs

> **Load when:** deciding whether to finetune, preparing or generating
> training data, running a finetune, or reviewing a finetuning pipeline.
> **See also:** [LLM applications](../llm/llm-applications.md),
> [LLM evaluation](../llm/llm-evaluation.md),
> [Inference and serving](../llm/inference-and-serving.md),
> [Machine learning systems](../ml/ml-systems.md)

## Top rules

1. **Exhaust systematic prompting, examples, and retrieval, with the eval
   pipeline already built, before you finetune.** Most "prompting failed"
   claims rest on vague instructions, unrepresentative examples, and
   undefined metrics. *[AIE ch. 7, Reasons Not to Finetune; OpenAI Docs:
   Model optimization; Google Cloud Docs: Introduction to tuning]*
2. **Choose the fix from the failure type: retrieval for missing or stale
   facts, finetuning for form, style, and format.** When both appear, start
   with retrieval. *[AIE ch. 7, Finetuning and RAG]*
3. **Start with LoRA on all linear layers; move to full finetuning only with
   thousands of examples or more and evidence that adapters plateau.**
   *[AIE ch. 7, Finetuning methods; PEFT Docs: LoRA]*
4. **Pilot on 50 to 100 well-made examples, then train on growing subsets to
   measure the slope before paying for more data.** *[AIE ch. 8, Data
   Quantity; OpenAI Docs: Supervised fine-tuning]*
5. **Prefer a small curated dataset that mirrors real usage over a large
   noisy one.** *[AIE ch. 8, Data Quality; AIE ch. 8, Data Coverage; Google
   Cloud Docs: Introduction to tuning]*
6. **Deduplicate training data and decontaminate it against every eval set
   before training.** Otherwise the eval measures memory, not skill. *[AIE
   ch. 8, Deduplicate Data; AIE ch. 4, Handling data contamination]*
7. **Format data in the target model's chat template, compute loss on the
   responses, and call the tuned model in exactly the training format.**
   *[AIE ch. 8, Format Data; TRL Docs: SFT Trainer]*
8. **Train only on synthetic data that passed verification, and record the
   lineage and license of every dataset.** *[AIE ch. 8, Data verification;
   AIE ch. 8, Obscure data lineage]*
9. **Ship a finetune only when it beats both the base model and the best
   prompt-plus-retrieval baseline on held-out data, with no regression on
   tasks it was not trained for.** *[AIE ch. 7, Reasons Not to Finetune;
   OpenAI Docs: Supervised fine-tuning]*
10. **Set a maintenance policy before training: who re-tests new base
    models, what gain triggers a switch, and what happens when the base
    model or tuning platform retires.** *[AIE ch. 7, Reasons Not to Finetune;
    OpenAI Docs: Model optimization]*

## Deciding whether to finetune

- **Escalate in order: prompt, add a few to a few dozen examples, add basic
  retrieval, then advanced retrieval or finetuning by failure mode, then
  both.** Write down which step failed and the eval that showed it. *[AIE
  ch. 7, Finetuning and RAG; OpenAI Docs: Model optimization]*
- **Build the eval set, annotation guide, and experiment tracking during the
  prompting phase.** Finetuning reuses all three. *[AIE ch. 7, Reasons Not to
  Finetune]* Eval method is in [LLM evaluation](../llm/llm-evaluation.md).
- **Do not finetune only to shorten prompts.** Prompt caching now removes
  most of the token cost of repeated examples; finetune for this reason only
  when the examples no longer fit the context window. *[AIE ch. 7, Reasons
  Not to Finetune]* Caching is in [Inference and
  serving](../llm/inference-and-serving.md).
- **Do not accept "our domain needs a domain model" without a benchmark on
  your own task.** General models have repeatedly overtaken specialized ones
  on domain benchmarks soon after release. *[AIE ch. 7, Reasons Not to
  Finetune]*
- **Consider finetuning a small model when cost or latency rules out a large
  one.** On a narrow task, a small tuned model can beat a far larger general
  one. *[AIE ch. 7, Reasons to Finetune]*
- **Budget the whole lifecycle before starting: data acquisition, training
  skill, hosting, monitoring, and periodic re-evaluation against new base
  models.** *[AIE ch. 7, Reasons Not to Finetune]*

## Choosing a base model, method, and platform

- **Prototype with the strongest model you can afford.** If it fails, weaker
  models will too; if it succeeds, it becomes the reference for cheaper
  ones. *[AIE ch. 7, Finetuning Tactics]*
- **Follow one of two paths.** Progression: debug the training code on the
  cheapest model, confirm loss falls on a mid-size model, push the best
  model, then map price against quality across sizes. Distillation: tune a
  strong model on a small, high-quality set, use it to generate more data,
  and train a cheaper model on that. *[AIE ch. 7, Finetuning Tactics; OpenAI
  Docs: Supervised fine-tuning]*
- **With little data, use adapters on a stronger base; with a lot, full
  finetuning of a smaller model becomes viable.** With a few hundred
  examples full finetuning may not beat LoRA. *[AIE ch. 7, Finetuning
  methods; AIE ch. 8, Data Quantity]*
- **Factor serving into the method.** Many LoRA adapters share one base
  model, so per-customer or per-task variants stay cheap; full finetunes
  each need a full model. *[AIE ch. 7, Serving LoRA adapters]*
- **Pick the method from the data you can produce: supervised finetuning
  for demonstrations of correct outputs, preference tuning for pairs of
  better and worse outputs (tone, style, subjective quality), and
  reinforcement finetuning only when a reliable grader can score outputs.**
  Preference tuning usually runs on top of a supervised finetune. *[OpenAI
  Docs: Model optimization; Google Cloud Docs: Introduction to tuning]*
- **When memory is the limit, quantize the frozen base model (QLoRA)
  instead of shrinking the adapter.** Adapter weights are already tiny next
  to the base weights. *[AIE ch. 7, Quantized LoRA; AIE ch. 7, Memory
  Bottlenecks]*
- **Keep the training pipeline portable across providers and open-weight
  models.** Hosted tuning APIs limit base models and knobs, and can close:
  OpenAI's fine-tuning platform is closed to new users, and its tuned models
  retire with their base models (updated from the book, which treats
  hosted APIs as the easy default). *[AIE ch. 7, Finetuning frameworks;
  OpenAI Docs: Model optimization; OpenAI Docs: Supervised fine-tuning]*

## LoRA configuration

- **Target all linear layers (`target_modules="all-linear"` in PEFT) by
  default.** Spreading a fixed budget across more weight matrices beats a
  higher rank on fewer, and QLoRA, which adapts all linear layers, matched
  full finetuning in its tests (updated from the book's query-and-value
  fallback, which is still PEFT's default target). *[AIE ch. 7, LoRA
  configurations; PEFT Docs: LoRA]*
- **Keep rank small, usually 4 to 64, and raise it only when evals show
  underfitting.** *[AIE ch. 7, LoRA configurations]*
- **Tune alpha with rank, keeping the alpha-to-rank ratio between roughly
  1:8 and 8:1, and enable rank-stabilized scaling (`use_rslora`) when you
  raise rank.** Default scaling is alpha over rank, which shrinks updates as
  rank grows. *[AIE ch. 7, LoRA configurations; PEFT Docs: LoRA]*
- **Merge the adapter into the base weights when you serve a single
  variant, and keep adapters separate when you serve many.** Merging removes
  adapter latency but blocks per-request adapter switching. *[AIE ch. 7,
  Serving LoRA adapters; PEFT Docs: LoRA]*

## Hyperparameter starting points

These are starting points to sweep from, not answers. Check the base model's
or framework's documentation first. *[AIE ch. 7, Finetuning hyperparameters]*
Reading loss curves for learning rate and epochs, and using gradient
accumulation below a batch of about eight, are in [ML
systems](../ml/ml-systems.md).

- **Start the learning rate near the framework default (2e-5 for full
  finetuning in TRL, about 1e-4 for adapters) and sweep around it, with a
  schedule that decays toward the end.** The book's search range is 1e-7 to
  1e-3. *[AIE ch. 7, Learning rate; TRL Docs: SFT Trainer]*
- **Plan one or two epochs for millions of examples and four to ten for
  thousands, then adjust from validation loss.** *[AIE ch. 7, Number of
  epochs]*
- **Compute loss on response tokens only, and confirm the trainer's mask
  rather than assuming it.** TRL masks prompts by default only for
  prompt-completion data; chat (`messages`) data trains on the full
  sequence unless you set `assistant_only_loss=True`. The book's 10%
  prompt-loss weight is a variant to test (updated from the book).
  *[AIE ch. 7, Prompt loss weight; TRL Docs: SFT Trainer]*
- **Before enabling assistant-only loss, check that the chat template has
  generation markers around assistant turns.** TRL patches the template for
  some known model families; for others, without the markers it cannot mask
  the other roles. *[TRL Docs: SFT Trainer]*

## Running the finetune

Seeds, versioning, and the model registry follow [ML
systems](../ml/ml-systems.md).

- **Rule out bad hyperparameters and prompts before concluding that more
  data will not help.** After that, if the small pilot shows no gain, a
  larger set rarely will. *[AIE ch. 8, Data Quantity; OpenAI Docs:
  Supervised fine-tuning]*
- **Train on 25%, 50%, and 100% of the data to see whether more data is
  still paying off.** *[AIE ch. 8, Data Quantity]*
- **When high-quality labels are scarce, finetune in stages: first on cheaper
  data (raw domain text, a related task, or synthetic data), then on the
  small high-quality set.** The synthetic-then-real route is the hardest to
  get right. *[AIE ch. 8, Data Quantity]*
- **Keep a checkpoint per epoch and select by validation metrics, not by the
  last step.** Hosted APIs may keep only the last few (OpenAI keeps three),
  so pick before they are pruned. *[OpenAI Docs: Supervised fine-tuning;
  Google Cloud Docs: Introduction to tuning]*

## Dataset curation and coverage

- **Check every dataset for six properties: relevant, aligned with the
  task's requirements, consistent across annotators, correctly formatted,
  sufficiently unique, and compliant.** "Aligned" may mean concise or
  creative rather than merely correct. *[AIE ch. 8, Data Quality]*
- **Spend the data budget on curation before volume.** About a thousand
  curated examples have beaten far larger noisy sets. *[AIE ch. 8,
  Data Quality; Google Cloud Docs: Introduction to tuning]*
- **Match the data mix to production traffic: short and detailed
  instructions, real typos, the languages and output formats users need, and
  multi-turn examples if the task is conversational.** Unrelated
  heterogeneous data can hurt. *[AIE ch. 8, Data Coverage; Google Cloud Docs:
  Introduction to tuning]*
- **Include examples of every behavior you want, and remove examples of
  habits you do not.** Want reasoning, include worked reasoning; want tool
  use, include real tool traces; drop examples that rewrite text nobody
  asked to change. *[AIE ch. 8, Data Curation]*
- **Collect tool-use traces by observing experts work, not by asking them to
  describe the work.** *[AIE ch. 8, Data Curation]*
- **Train on the full mix of tasks the model serves, not only the weak
  one.** Specializing on one query type degrades the others; otherwise keep
  separate models or adapters. *[AIE ch. 7, Reasons Not to Finetune]*
- **When tuning for safety, include borderline requests answered with safe,
  helpful responses, not only refusals of malicious ones.** A request that
  could be benign should get a legal alternative, not a blanket refusal.
  *[AIE ch. 5, Model-level defense]*

## Acquisition and annotation

- **Prefer your own application data, gathered through a feedback loop.** It
  matches your distribution better than any public set. *[AIE ch. 8, Data
  Acquisition and Annotation]*
- **Write annotation guidelines before labeling, and reuse the eval rubric
  as the guide.** State what a good response is and what separates adjacent
  scores; teams report guidelines as one of the hardest parts of the
  pipeline. *[AIE ch. 8, Data Acquisition and Annotation; AIE
  ch. 4, Annotate evaluation data]*
- **Record the source, license, and collection date of every dataset, and
  trace mixed datasets to their parts.** A permissive top-level license can
  wrap data from restrictive sources. *[AIE ch. 8, Obscure data lineage]*
- **Check that a teacher model's terms allow training other models on its
  outputs, and note whether it may have seen your benchmarks.** *[AIE
  ch. 8, Model Distillation; AIE ch. 8, Obscure data lineage]*

## Synthetic data and distillation

- **Verify every synthetic example before training.** For code, run parsers,
  linters, unit tests, and back-translation; otherwise use AI verifiers or
  classifiers, plus heuristic filters for empty, overlong, repetitive, or
  input-copying outputs and for identical instructions with conflicting
  responses. *[AIE ch. 8, Data verification]*
- **Mix synthetic data with real data; never train on generated data
  alone.** Generated-only training risks model collapse, losing rare cases
  and amplifying bias. *[AIE ch. 8, Limitations to AI-generated data]*
- **Score a distilled student on correctness against references, not on
  similarity to the teacher.** Imitation transfers style more than
  capability, so a student can sound right while being wrong. *[AIE ch. 8,
  Limitations to AI-generated data]*
- **For long, high-quality responses, generate the instructions, not the
  responses.** Take strong human-written long-form text and have a model
  write the prompt that would produce it. *[AIE ch. 8, Instruction data
  synthesis]*
- **If you seed synthesis with eval examples, as the book suggests, take
  those seeds out of the held-out split, and decontaminate the generated
  pool against what remains.** Generated items can paraphrase their seeds
  closely enough to inflate scores. *[AIE ch. 8, Data Acquisition and
  Annotation; AIE ch. 4, Handling data contamination]*

## Processing: inspect, deduplicate, clean, decontaminate

- **Treat data processing like a production job: test each script on a
  sample, never modify source data in place, and order steps cheapest
  first.** For example, deduplicate before an expensive cleaning pass. *[AIE
  ch. 8, Data Processing]*
- **Read the data before training on it.** Plot token, length, topic, and
  score distributions by source, annotator, and time, measure annotator
  disagreement, and label a few examples yourself. *[AIE ch. 8, Inspect
  Data]*
- **Deduplicate at a stated granularity with exact, n-gram or fuzzy,
  MinHash, or embedding matching.** Duplicates skew the distribution and,
  across a split, leak test examples into training. *[AIE ch. 8, Deduplicate
  Data]*
- **Decontaminate against every eval and benchmark set by long n-gram
  overlap, and use unusually low perplexity as a cheaper second signal.**
  Drop or quarantine matches and record what was removed. *[AIE ch. 4,
  Handling data contamination]*
- **Strip stray HTML, Markdown, and other formatting tokens that the task
  does not need.** It shortens inputs and has raised accuracy markedly.
  *[AIE ch. 8, Clean and Filter Data]*
- **Remove PII and any field you lack the right to train on, and filter
  low-quality annotations.** One study found labels from late in a session
  were worse, likely from fatigue. *[AIE ch. 8, Clean and Filter Data]*

## Formatting and chat templates

- **Render every example through the target model's own chat template,
  applied by the tokenizer, never a hand-built string.** A wrong template
  causes silent, strange degradation. *[AIE ch. 8, Format Data; AIE ch. 5,
  System Prompt and User Prompt; TRL Docs: SFT Trainer]*
- **Align the end-of-turn token with the chat template.** A mismatch leaves
  the tuned model unable to stop. *[TRL Docs: SFT Trainer]*
- **Drop task descriptions and few-shot scaffolding from training
  instructions once you have enough examples.** The examples teach the
  task, and few-shot examples become training rows. *[AIE ch. 8, Format
  Data]*
- **Call the tuned model with exactly the training format, and test for
  drift with a prefix, missing delimiter, and trailing-space case.** Small
  format differences can break a finetuned model. *[AIE ch. 8, Format Data]*
- **When the data format is your choice, pilot each candidate on the same
  small set and eval before committing.** Format alone changes finetuned
  quality. *[AIE ch. 8, Format Data]*

## Evaluating and shipping a finetuned model

- **Hold out an eval set before training, with the same diversity as the
  training data, and never tune on it.** *[OpenAI Docs: Supervised
  fine-tuning; AIE ch. 8, Deduplicate Data]* Method is in [LLM
  evaluation](../llm/llm-evaluation.md).
- **Report the tuned model against the base model and the best prompted
  baseline on the same eval, with cost and latency per request.** *[OpenAI
  Docs: Supervised fine-tuning; AIE ch. 7, Finetuning Tactics]*
- **Run regression evals on every task the deployment serves, not only the
  tuned one, plus safety and false-refusal checks.** *[AIE ch. 7, Reasons
  Not to Finetune; AIE ch. 5, Model-level defense]*
- **Combine separately tuned models or adapters by merging only after the
  merged model passes the same evals.** *[AIE ch. 7, Model Merging and
  Multi-Task Finetuning]*
- **Register the tuned model with its base model ID, adapter, dataset
  version, and eval results, and pin it like any snapshot.** *[AIE ch. 7,
  Reasons Not to Finetune]* Registry rules are in [ML
  systems](../ml/ml-systems.md); pinning is in [LLM
  applications](../llm/llm-applications.md).
- **Track the base model's retirement date, and re-run the eval on each new
  base model against the threshold set in the maintenance policy.** *[AIE
  ch. 7, Reasons Not to Finetune; OpenAI Docs: Supervised fine-tuning]*

## Tensions

- **Finetuning vs prompting and retrieval.** House position: prompting,
  examples, and retrieval first; finetune when evals plateau on a form or
  style failure and labeled data exists. Finetuning wins for strict formats,
  rare dialects, and small cheap models on a narrow task. *[AIE ch. 7,
  Finetuning and RAG; OpenAI Docs: Model optimization]*
- **LoRA vs full finetuning.** House position: LoRA on all linear layers.
  Full finetuning wins with large datasets and a single serving variant
  where the last points of quality matter. *[AIE ch. 7, Finetuning methods;
  PEFT Docs: LoRA]*
- **Prompt-loss weight vs response-only loss.** The book cites a 10% prompt
  weight as a common default; TRL masks prompts by default for
  prompt-completion data and offers assistant-only loss for chat data.
  House position: response-only, with a small prompt weight tested as an
  experiment. *[AIE ch. 7, Prompt loss weight; TRL Docs: SFT Trainer]*
- **Synthetic vs human data.** House position: real application data
  first, synthetic data verified and mixed in to fill coverage gaps, never
  alone. Synthetic data wins for rare cases and long-form responses built by
  reverse instruction. *[AIE ch. 8, Limitations to AI-generated data; AIE
  ch. 8, Instruction data synthesis]*
- **Hosted tuning API vs own training stack.** House position: a hosted API
  for a quick pilot, an open-weight model with a framework when the model
  must outlive one vendor's platform or needs knobs the API hides. *[AIE
  ch. 7, Finetuning frameworks; OpenAI Docs: Model optimization]*

## Sources

- **AIE**: AI Engineering: Building Applications with Foundation Models
  (Chip Huyen, O'Reilly, 1st ed., 2025)
- **OpenAI Docs**: OpenAI API documentation, cited by guide title
  ("Model optimization", "Supervised fine-tuning"),
  <https://developers.openai.com/api/docs/guides/model-optimization>,
  <https://developers.openai.com/api/docs/guides/supervised-fine-tuning>
- **Google Cloud Docs**: Google Cloud generative AI documentation,
  "Introduction to tuning",
  <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/tune-models>
- **PEFT Docs**: Hugging Face PEFT documentation, "LoRA",
  <https://huggingface.co/docs/peft/developer_guides/lora>
- **TRL Docs**: Hugging Face TRL documentation, "SFT Trainer",
  <https://huggingface.co/docs/trl/sft_trainer>
