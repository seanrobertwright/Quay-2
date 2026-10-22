# LLM inference and serving

> **Load when:** tuning latency, throughput, or cost of LLM calls; caching;
> batch APIs; routing between models; self-hosting or serving models
> (quantization, KV cache, speculative decoding, batching).
> **See also:** [LLM applications](../llm/llm-applications.md), [LLM evaluation](../llm/llm-evaluation.md),
> [Finetuning and training data](../llm/finetuning-and-data.md), [Caching and Redis](../data/caching-and-redis.md),
> [Scalability and system design](../architecture/scalability-and-system-design.md), [Cloud architecture](../cloud/cloud-architecture.md),
> [Performance and load testing](../testing/performance-and-load-testing.md), [Observability](../operations/observability-and-reliability.md)

## Top rules

1. **Track time to first token, time per output token, and total latency
   separately, as percentiles.** Averages hide the slow tail. *[AIE ch. 9,
   Latency, TTFT, and TPOT]*
2. **Cap output tokens per call and user input length, and set spend limits and
   per-user quotas.** *[OpenAI Docs: Production best practices; OWASP LLM:
   LLM10 Unbounded Consumption]*
3. **Cut output tokens, including reasoning tokens, before input tokens.** They
   cost more and dominate latency. *[AIE ch. 9, Overcoming the autoregressive
   decoding bottleneck; Claude Docs: Effort]*
4. **Order prompts stable-first so the provider can cache the shared prefix,
   and monitor cache read and write tokens.** *[Claude Docs: Prompt caching;
   AIE ch. 9, Prompt caching]*
5. **Never cache a response that depends on the user or the time.** *[AIE ch.
   10, Exact caching]*
6. **Send work nobody is waiting for to a batch API.** *[AIE ch. 9, Online and
   batch inference APIs]*
7. **Route all model traffic through one gateway that holds the keys, enforces
   spend, and fails over.** *[AIE ch. 10, Gateway]*
8. **Optimize goodput, the requests per second that meet the latency target,
   not raw throughput.** *[AIE ch. 9, Throughput and goodput]*
9. **Rerun the evals after every quantization, serving-stack, or provider
   change.** These optimizations can alter output quality. *[AIE ch. 9, Model
   compression; AIE ch. 9, Inference Optimization]*

## Latency and throughput

- **Measure time to first token (TTFT), time per output token (TPOT), and total
  latency separately, and in agent or reasoning flows measure time to the first
  token the user sees.** Hidden planning and tool steps push it far past the
  model's own TTFT. *[AIE ch. 9, Latency, TTFT, and TPOT]*
- **Record these as the OTel GenAI client metrics (operation duration, time to
  first chunk, time per output chunk) plus input, output, cache, and reasoning
  token counts.** The conventions are still in Development status. *[OTel
  GenAI: Client inference]*
- **Set TPOT targets from reading speed for streamed text.** Roughly 6 to 8
  tokens per second keeps ahead of a fast reader; faster buys little. *[AIE ch.
  9, Latency, TTFT, and TPOT]*
- **Report p50, p90, p95, and p99, not means, and plot TTFT against input
  length.** Outliers point to network errors or unusually long prompts. *[AIE
  ch. 9, Latency, TTFT, and TPOT]*
- **Optimize goodput rather than throughput, and compare servers by cost per
  request, not tokens per second.** Batching can multiply throughput while
  breaking the latency target, and tokenizers differ. *[AIE ch. 9, Throughput
  and goodput]*
- **Account for the latency cost of chaining.** Each added step, reflection
  pass, or hidden reasoning block delays the first visible token. *[AIE ch. 5,
  Break Complex Tasks into Simpler Subtasks; AIE ch. 5, Give the Model Time to
  Think]*
- **To cut tail latency on a flaky step, send parallel duplicate calls and take
  the first valid response**, and budget the extra cost. *[AIE ch. 2, Test Time
  Compute; AIE ch. 10, Output guardrails]*

## Cost and token limits

- **Cap output tokens per call and user input length, and set spend limits,
  spend alerts, and per-user quotas.** Per-feature cost and token alerting is
  in [LLM applications](../llm/llm-applications.md). *[OpenAI Docs: Production
  best practices; OWASP LLM: LLM10 Unbounded Consumption]*
- **Cut output first: ask for concise answers, set stop conditions, and cap
  length.** Output tokens are priced several times higher than input tokens
  (the book cited two to four times; check current price lists), and one can
  add as much latency as about a hundred input tokens. *[AIE ch. 9, Overcoming
  the autoregressive decoding bottleneck; AIE ch. 4, Cost and Latency]*
- **Set the reasoning effort or thinking level explicitly per feature, and
  choose it with an eval sweep.** Thinking tokens count as output and against
  `max_tokens`, and defaults differ between models (updated: the book predates
  reasoning-effort controls). *[Claude Docs: Effort]*
- **Count tokens with the provider's counter for the model in use, and treat
  the result as an estimate.** Tokenizers differ between model generations, so
  a count taken on another model is wrong. *[Claude Docs: Token counting]*
- **Prefer a compact output format when output volume drives cost.** A less
  verbose format such as YAML uses fewer tokens than JSON, but only where the
  provider's schema mode is not needed. *[AIE ch. 2, Structured Outputs]*

## Streaming and long requests

- **Stream user-facing responses, and use streaming or a batch API for long
  generations.** Idle connections on long unstreamed requests can drop.
  *[OpenAI Docs: Production best practices; Claude Docs: Claude API errors]*
- **Decide per feature whether streaming outweighs checking the full response
  before the user sees it.** Output guardrails cannot judge a response that is
  still arriving. *[AIE ch. 10, Guardrail implementation]*

## Prompt and response caching

- **Order prompts stable-first (tools, system prompt, shared documents,
  examples, then user input), keep timestamps, per-user data, and unstable JSON
  key order out of the cached prefix, and monitor cache read and write
  tokens.** Short prompts are silently not cached. *[Claude Docs: Prompt
  caching; AIE ch. 9, Prompt caching]*
- **Hold request settings that shape the prompt, such as the tool list and the
  top-level effort level, constant within a cached conversation.** Changing
  them restarts the cache. *[Claude Docs: Effort; Claude Docs: Prompt caching]*
- **Check the provider's current caching terms before relying on savings.**
  Discounts, write premiums, cache lifetimes, minimum lengths, and whether
  caching is automatic or explicit differ by provider and change often
  (updated from the book's figures). *[Claude Docs: Prompt caching; AIE ch. 9,
  Prompt caching]*
- **Cache exact repeats, including embedding lookups and answers users expect
  to be identical each time.** Eviction and TTLs are in [Caching and
  Redis](../data/caching-and-redis.md). *[AIE ch. 10, Exact caching; AIE ch. 2,
  The Probabilistic Nature of AI]*
- **Never cache a response that depends on the user or the time.** A cached
  answer containing one user's account details can reach another user who asked
  the same generic question. *[AIE ch. 10, Exact caching]*
- **Add semantic caching only after measuring its hit rate and its wrong-hit
  rate.** A wrong hit returns a wrong answer, and quality depends on the
  embedding, the vector search, and the threshold. *[AIE ch. 10, Semantic
  caching]*

## Batch APIs

- **Send work that is not latency-sensitive to batch APIs**: synthetic data,
  periodic reports, document backfills, reprocessing after a model migration,
  and reindexing. Providers have offered about half price with turnaround in
  hours; check current terms. *[AIE ch. 9, Online and batch inference APIs]*

## Routing and gateways

- **Route each request to the cheapest, fastest model that meets the quality
  bar for its intent**, sending simple queries to small models and specialized
  intents to specialized handlers. Model choice often fixes cost and latency
  more easily than prompting. If retrieval pushes the context past the target
  model's window, truncate or reroute. *[AIE ch. 10, Router; Claude Docs:
  Prompt engineering overview; OpenAI Docs: Production best practices]* Model
  selection is in [LLM evaluation](../llm/llm-evaluation.md).
- **Send all model traffic through a gateway**: one interface across providers,
  provider keys out of applications, access and spend control per user or
  application, fallbacks for rate limits and outages, and one place to log.
  Retry at one layer only, as set out in [LLM
  applications](../llm/llm-applications.md). *[AIE ch. 10, Gateway]*
- **Prefer models behind a standard API so a swap touches only the gateway.**
  The rest of a model change is a release; see [LLM
  applications](../llm/llm-applications.md). *[AIE ch. 10, Gateway; AIE ch. 1,
  Maintenance]*

## Self-hosting and model serving

- **Revisit the API-versus-self-host cost comparison as volume grows.** API
  cost per token stays flat while self-hosted cost falls with utilization;
  count the engineering cost of running, scaling, and guarding the service.
  *[AIE ch. 4, Cost and Latency; AIE ch. 4, API cost versus engineering cost]*
- **Estimate memory before choosing hardware: weights take parameter count
  times bytes per parameter, plus a KV cache that grows linearly with context
  length and batch size.** A 13B model needs about 26 GB for 16-bit weights
  alone, and finetuning needs far more than inference. *[AIE ch. 7, Memory
  Bottlenecks; AIE ch. 9, Attention mechanism optimization]*
- **For long-context or large-batch workloads, size by KV cache memory and use
  a server with paged KV cache management.** The cache, not the weights, often
  limits batch size. *[AIE ch. 9, Attention mechanism optimization]*
- **Find out whether each stage is compute-bound or bandwidth-bound before
  optimizing it.** Prefill is usually limited by compute and decode by memory
  bandwidth; a roofline profile shows which applies. *[AIE ch. 9,
  Computational bottlenecks]*
- **Measure hardware efficiency with model FLOP/s utilization (MFU) and model
  bandwidth utilization (MBU), not the GPU utilization `nvidia-smi` shows.**
  That figure reports busy time and can read 100% while the chip does little
  useful work. *[AIE ch. 9, Utilization, MFU, and MBU]*
- **Try weight-only quantization and distillation first among model
  optimizations, and re-evaluate quality after each.** Where the GPU supports
  FP8 natively, FP8 serving is now a common first step (updated). Pruning
  rarely pays off in practice. *[AIE ch. 9, Model compression]*
- **Turn on speculative decoding for structured or code output, and inference
  with reference (prompt lookup) for answers that copy from the input.** The
  target model verifies every drafted token, so quality is unchanged; a
  separate draft model must share the target's tokenizer. *[AIE ch. 9,
  Speculative decoding; AIE ch. 9, Inference with reference]*
- **Use continuous batching, and at scale run prefill and decode on separate
  instances.** Separation keeps one request's prefill from stalling others'
  decoding; set the instance ratio from input length and whether TTFT or TPOT
  matters more. *[AIE ch. 9, Batching; AIE ch. 9, Decoupling prefill and
  decode]*
- **Scale out with replicas and split large models with tensor parallelism;
  avoid pipeline parallelism on latency-bound serving.** It adds communication
  latency to every request. *[AIE ch. 9, Parallelism]*
- Chat templates for self-hosted and finetuned models: see [LLM
  applications](../llm/llm-applications.md) and [Finetuning and training
  data](../llm/finetuning-and-data.md).

## Tensions

- **Streaming vs output guardrails.** House position: stream user-facing text
  by default; buffer the full response when a guardrail must clear it first,
  such as PII, regulated content, or tool triggers. *[OpenAI Docs: Production
  best practices; AIE ch. 10, Guardrail implementation]*
- **Exact vs semantic caching.** Vendors promote semantic caches; the book
  doubts they pay off. House position: exact caching first, semantic caching
  only with a measured hit rate and wrong-hit rate. *[AIE ch. 10, Semantic
  caching]*
- **Throughput vs latency.** House position: batch as far as the latency target
  allows and judge by goodput. *[AIE ch. 9, Throughput and goodput]*
- **API vs self-hosting.** House position: an API until volume, privacy, or
  control needs justify the engineering cost, and revisit as volume changes.
  *[AIE ch. 4, Model Build Versus Buy; AIE ch. 4, API cost versus engineering
  cost]*

## Sources

- **Claude Docs**: Claude API documentation (Anthropic), cited by page title, <https://platform.claude.com/docs/>
- **OpenAI Docs**: OpenAI API documentation, cited by guide title, <https://developers.openai.com/api/docs/>
- **OWASP LLM**: OWASP Top 10 for LLM Applications 2025, cited by risk, <https://genai.owasp.org/llm-top-10/>
- **OTel GenAI**: OpenTelemetry semantic conventions for generative AI, cited by document title, <https://github.com/open-telemetry/semantic-conventions-genai>
- **AIE**: AI Engineering: Building Applications with Foundation Models (Chip Huyen, O'Reilly, 1st ed., 2025)
