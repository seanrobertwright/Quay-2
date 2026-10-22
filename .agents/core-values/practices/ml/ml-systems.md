# Machine learning systems

> **Load when:** building, training, evaluating, deploying, or reviewing an ML
> model or its pipeline (features, labels and splits, metrics, training-serving
> skew, registry, rollout, batch or online inference, recommendation and
> ranking, retraining, drift monitoring), or code that acts on predictions.
> **See also:** [Python](../languages/python.md),
> [Testing](../testing/testing.md), [CI/CD](../devops/ci-cd.md),
> [Observability](../operations/observability-and-reliability.md),
> [System design](../architecture/scalability-and-system-design.md),
> [Caching and Redis](../data/caching-and-redis.md),
> [Search](../data/search-elasticsearch.md), [Kafka](../messaging/kafka.md),
> [Security](../security/application-security.md), [LLM applications](../llm/llm-applications.md),
> [Finetuning and data](../llm/finetuning-and-data.md)

## Top rules

1. **Run one feature-transformation code path for training and serving.**
   Put transforms in the model graph, a shared library, or a feature store,
   and freeze fitted statistics and encoders with the model; a second
   implementation silently diverges and only shows up as slowly worse output.
   *[Rules of ML Rule 32; MLCC When to transform data; MLDI ch. 1 Spotify case]*
2. **Never train on a feature that is unavailable, or has a different value,
   at prediction time.** Join each label to feature values as of the event
   time, and treat a suspiciously good offline score as leakage until proven
   otherwise. *[MLCC Monitoring pipelines; ML pipelines; MLDI Usecases LinkedIn
   Course Recommendation]*
3. **Split time-dependent data by time, never at random.** Train on the past,
   validate on the future, and keep validation and test sets at the natural
   class distribution. *[MLDI ch. 1 How to Split Train/Test Data, Handle
   Imbalance]*
4. **Ship the simplest model that proves the pipeline, and keep a trivial
   baseline running forever.** Heuristics or logistic regression first; a
   deeper model is an experiment that must beat the baseline online.
   *[Rules of ML Rules 1-4, 14; ML Test Score Model 5; MLDI ch. 2 Airbnb]*
5. **Make the training target the business outcome and write down the online
   metric before choosing features.** Reject a change that improves loss but
   worsens the decision it drives. *[MLDI ch. 6 Problem Statement; Rules of ML
   Rules 12-13, 25]*
6. **Gate every candidate model automatically before serving.** Compare to the
   previous version and a fixed validation threshold, on every important
   slice, and check the artifact loads in the production serving binary.
   *[ML Test Score Infra 4, Infra 6, Model 6-7; ML pipelines]*
7. **Roll out behind a canary or A/B split and keep a rehearsed one-step
   rollback.** Credit business gains only through the split, since promotions
   and launches move metrics too; widen traffic while they hold, else revert to
   a known-good registry version. *[ML Test Score Infra 6-7; Rules of ML Rule
   24; MLDI ch. 1 Online Metrics; AIE ch. 4 Evaluation-Driven Development]*
8. **Log the features actually served with every prediction, and monitor skew,
   bias, and staleness.** Those logs are the next training set and the only
   evidence when quality drifts without an error. *[Rules of ML Rules 10, 29;
   ML Test Score Monitor 3-4, 7; MLDI ch. 1 Spotify case]*
9. **Recalibrate after downsampling or reweighting, and check calibration, not
   only AUC, whenever scores are used as probabilities.** Bids, thresholds,
   and score blending all assume calibrated outputs. *[MLDI ch. 2 Calibration;
   Rules of ML Rule 30]*
10. **Parse every external input to the model at the boundary.** Request
    bodies, config, and env vars go through a schema that rejects NaN, empty
    strings, unknown categories, and out-of-range values with a clear error.
    *[Review lessons; ML Test Score Data 1]*

## Framing, objectives, and baselines

- **Instrument the product before any model exists.** Logged outcomes are the
  training data you will need, and they show what the model changed.
  *[Rules of ML Rules 1-3]*
- **Pick a first objective that is simple, observable, and attributable to the
  model.** Clicks or saves, not "happiness"; keep long-term goals as launch
  guardrails. *[Rules of ML Rules 12-13]*
- **Turn vague complaints into a measured metric, and when gains plateau fix
  the objective before adding features.** Launch when metrics move together,
  not when one easy metric rises. *[Rules of ML Rules 27, 38-39]*
- **Feed existing heuristics in as features, or predict a correction to a
  deterministic estimate, instead of replacing them.** They carry domain
  knowledge and keep the system simple. *[Rules of ML Rule 7; MLDI Usecases
  Uber ETA]*
- **Prefer one shared model with cohort features over a model per cohort.**
  Per-segment models multiply serving logic and starve each of data.
  *[MLDI ch. 1 Serving Logics and Multiple Models]*
- **Write a latency budget for each stage into the requirements.** Ranking gets
  its own slice of the request budget, not whatever is left over.
  *[MLDI ch. 4 Requirements]*

## Features and training-serving consistency

- **Fit encoders and normalization statistics once on the full training set,
  save them with the model, and map unseen or rare categories to "other".**
  Per-call or per-batch fitting makes one raw value mean different things.
  *[MLDI ch. 1 One Hot Encoding; MLCC When to transform data]*
- **Encode high-cardinality categoricals with out-of-fold, smoothed target
  encoding, feature hashing, or embeddings, not one-hot.** Same-row target
  encoding leaks the label; size hash buckets by measuring loss.
  *[MLDI ch. 1 One Hot Encoding, Mean Encoding, Feature Hashing]*
- **Clip numeric features before scaling and log-transform heavy tails;
  replace raw coordinates with distances or grid cells.** Raw extremes squash
  the useful range. *[MLDI ch. 1 Numeric Features, ch. 6 Feature Engineering]*
- **Express time as relative age or calendar parts, never an absolute "now".**
  Serving always happens outside the trained range. Handle timestamps through
  the project's single date helper and treat zone-less values as UTC.
  *[MLDI ch. 1 Numeric Features; Review lessons]*
- **Assert, per tagged example, that training-time and serving-time feature
  values are identical.** Also compare min, max, mean, and missing fraction on
  a schedule and alert on drift. *[ML Test Score Monitor 3; MLCC Monitoring
  pipelines; MLDI ch. 1 Spotify case]*
- **Keep fast-changing features in a low-latency key-value store fed by a
  stream, and batch features on a batch path.** Serving needs millisecond
  reads; training needs throughput. *[MLDI ch. 1 Deployment Example, ch. 7]*
- **Prefer directly observed features over another model's outputs.** Upstream
  learned signals drift under you. *[Rules of ML Rule 17; Hidden Debt sec. 3]*
- **Give every feature an owner and a source, and make it pay for itself.**
  Run leave-one-feature-out evaluations and delete low-gain or legacy
  features; reject tiny gains that add new data dependencies. *[Rules of ML
  Rules 11, 22; Hidden Debt sec. 3; ML Test Score Data 2-3]*
- **Enforce feature policy with failing checks.** Prohibited attributes,
  deprecated sources, and privacy rules cover training and validation data and
  vocabularies; privacy beats feature velocity. *[ML Test Score Data 4-6]*
- **Scope every feature and training-data query on user- or org-owned data by
  the tenant column.** A shared model must not read or serve one tenant's
  records for another unless that sharing is an explicit, reviewed decision.
  *[Review lessons]*
- **After fixing a skew or leakage bug, grep for the same transform elsewhere.**
  Duplicated feature code is where the sibling bug lives; fix all copies in the
  same change. *[Review lessons]*

## Training data, labels, and sampling

- **Define labels and negatives before modeling, and record the choice.** "Seen
  but not engaged" and "random unseen" teach different things.
  *[MLDI ch. 1 Data Generation Strategy]*
- **Audit what a copied pipeline filters out.** A filter such as "only shown
  items" silently biases a new model. *[Rules of ML Rule 6]*
- **Resample only the training set; downsample the majority class and weight
  kept examples by the inverse sampling rate.** Dropping without reweighting
  breaks calibration; prefer this to synthetic oversampling at scale.
  *[MLDI ch. 1 Resampling; Rules of ML Rule 30]*
- **Check that every entity you must predict for appears in the training
  split.** An id-based split can leave users or stores with no rows.
  *[MLDI ch. 1 How to Split Train/Test Data]*
- **Make splits deterministic by hashing a stable, system-specific key.** Then
  datasets regenerate exactly and never collide with another system's split.
  *[MLCC Monitoring pipelines]*
- **Run feature selection and importance on the training split only.** Using
  the full set leaks test information into design. *[MLDI Assessment]*

## Evaluation and metrics

- **Choose the loss from what errors cost.** MAE or Huber for outliers,
  quantile or asymmetric loss when over- and under-prediction cost
  differently; for a predicted range, check how often actuals fall inside.
  *[MLDI ch. 1 Loss Function, ch. 7 Quantile Regression]*
- **Compare click-rate models across datasets with normalized cross entropy.**
  Raw log loss flatters extreme base rates; above one means worse than
  predicting the base rate. *[MLDI ch. 1 Normalized Cross Entropy]*
- **Check calibration with a predicted-to-actual ratio and a reliability plot;
  fix with Platt scaling or isotonic regression.** A higher-AUC model can be
  badly miscalibrated. *[MLDI ch. 2 Calibration]*
- **Match the ranking metric to the product.** NDCG or MAP for graded,
  multi-result relevance; MRR only when the first hit is all that counts.
  Evaluate rankers by replaying later held-out traffic. *[MLDI ch. 1 Model
  Evaluation, ch. 4 Evaluation]*
- **Show with small live experiments that offline proxies track online
  metrics before trusting offline wins.** For nonstationary data they often
  do not. *[ML Test Score Model 2; MLDI ch. 1 Online Metrics]*
- **Break quality loss into training vs holdout, holdout vs next-day, and
  next-day vs live.** A training-vs-live mismatch on the same example is an
  engineering bug, not drift. *[Rules of ML Rules 33, 37]*
- **Tune learning rate and epochs from the loss curves.** Jumpy loss means the
  rate is too high and smooth but slow loss too low; validation loss rising as
  training loss falls means too many epochs. Below a batch of about 8, use
  gradient accumulation. *[AIE ch. 7 Finetuning Hyperparameters]*
- **Report metrics per slice and per demographic group, online and offline.**
  An aggregate can improve while every slice worsens (Simpson's paradox), and
  the team's own usage is not a test set. *[Rules of ML Rule 23; ML Test Score
  Model 6-7; MLDI ch. 2 Fairness; AIE ch. 4 Annotate Evaluation Data]*
- **Keep model cards and reported metrics true to the code.** Re-check every
  accuracy, coverage, or "never" claim in a model card or docstring when the
  pipeline changes, and compute numbers rather than typing them.
  *[Review lessons; ML pipelines]*

## Testing ML code and data

- **Validate training and serving inputs against a feature schema.** Record
  ranges, categories, and missing rates; stop the pipeline on violations.
  *[ML Test Score Data 1, Monitor 2; MLOps (GCP)]*
- **Unit-test all feature code, however simple.** Assert scaling ranges, one
  hot bit per one-hot vector, near-zero z-score means, and clipping.
  *[ML Test Score Data 7; MLCC Monitoring pipelines]*
- **Unit-test model code without full training, asserting properties, not
  golden models.** Run one step on random input, see loss fall over a few
  steps, overfit a tiny set, restore a checkpoint; golden comparisons are flaky
  and get updated blindly. *[ML Test Score Infra 2; MLCC Deployment testing]*
- **Integration-test the whole pipeline on every model or server release.** A
  fast subset run for feedback, backed by a slower near-production run.
  *[ML Test Score Infra 3; MLCC Deployment testing]*
- **Seed randomness and version code, data, and config.** Then a feature-code
  refactor can be diff-tested for an equivalent model, and one example can be
  stepped through a given model version when debugging.
  *[ML Test Score Infra 1, Infra 5; MLCC Deployment testing]*
- **Keep notebooks, sample data, and model files under the repo's pre-commit
  gates.** The grep that blocks personal identifiers, credentials, and U+FFFD
  applies to them too. *[Review lessons]*

## Release, registry, and retraining

- **Store each validated model in a versioned registry with lineage, and have
  serving pull the latest validated version.** Data version, code version,
  parameters, and metrics make audit and rollback possible; manual deploys
  waste frequent retraining. *[ML pipelines; MLOps (GCP); MLDI ch. 1
  Deployment Example, ch. 3 Inference]*
- **Enforce "one active model per slot" in the registry's database.** Use a
  partial unique index or a locked transaction, not a check in the promoting
  script. *[Review lessons]*
- **Deploy and automate the training pipeline, not just the model.** Trigger
  on schedule, new data, metric drops, or drift; notebook hand-offs breed
  skew. *[MLOps (GCP); ML pipelines]*
- **Measure quality decay against model age before setting retrain cadence.**
  It also sets the staleness alert and the level: train once, periodic full
  retrain, nearline update, or warm start. *[ML Test Score Model 4; Rules of
  ML Rule 8; MLDI ch. 1 Retraining Requirements, ch. 2 Nonstationary Problem]*
- **Recompute decision thresholds in the pipeline on every retrain.** A
  hard-coded threshold is wrong after the next model. *[Hidden Debt sec. 7]*
- **Pin vendor, pretrained, and upstream signals to frozen versions and
  re-validate before upgrading.** Even an upstream "fix" breaks a model that
  learned the old behaviour. *[Hidden Debt sec. 3]*

## Serving and inference

- **Use batch inference for bounded inputs or predictions you must vet first;
  online inference for long-tail inputs.** Plan online latency early, since
  more servers may not fix it. *[MLCC Static versus dynamic inference; MLDI
  Usecases Airbnb Room Classification]*
- **Give predictions rich types that carry the model version and meaning.** A
  bare float hides whether it is a probability, logit, or threshold.
  *[Hidden Debt sec. 5]*
- **Declare every consumer of model outputs through access control or a
  contract.** Undeclared consumers create hidden coupling and feedback loops.
  *[Hidden Debt sec. 2]*
- **Give outbound calls to model or embedding APIs a timeout, disabled
  redirects, and credentials from a secret store, never source.** Retry and
  fallback rules for LLM calls live in
  [LLM applications](../llm/llm-applications.md). *[Review lessons]*
- **Bound per-request work by candidate count, not corpus size.** Cap
  candidate lists, precompute embeddings, fan large sets out to scoring
  workers, and never recompute an expensive derivation per request. *[Review
  lessons; MLDI ch. 1 Serving Embedding, Imbalance Workload]*

## Monitoring in production

- **Alert on prediction bias, mean prediction against mean label, overall and
  per slice.** Zero bias does not prove the model is good. *[Hidden Debt sec.
  7; ML Test Score Monitor 7]*
- **Alert on the age of the model and of every derived input table, and on
  falling feature coverage.** A dead refresh job fails silently.
  *[Rules of ML Rule 10; ML Test Score Monitor 4; MLCC Monitoring pipelines]*
- **Alert on the first NaN or Inf in training and on weights out of bounds.**
  These rarely raise errors. *[ML Test Score Monitor 5]*
- **Measure live quality with fast labels, periodic human rating, and user
  reports, correcting for biased feedback.** Validation data is always older
  than serving data. *[ML Test Score Monitor 7; ML pipelines]*
- **Cap any system that acts in the world (bids, blocks, sends) with sanity
  limits that alert and escalate to a human.** *[Hidden Debt sec. 7]*

## Recommendation and ranking

- **Build in stages: cheap high-recall candidate generation, a precise ranker,
  then a re-ranking layer for business rules.** Run retrieval and ranking as
  separate services so each scales and ships on its own. *[MLDI ch. 2
  Components, ch. 3 Multistage Models, Question 3]*
- **Choose the similarity function deliberately and correct sampled-negative
  logits for sampling frequency.** Dot product favours high-norm, popular
  items. *[MLDI ch. 1 Embedding, YouTube retrieval]*
- **Version precomputed embeddings with the model that produced them and serve
  large corpora from an ANN index service.** Mixed versions score garbage.
  *[MLDI ch. 1 Two-Tower, Approximate Nearest Neighbor Search]*
- **Correct position bias.** Train with position as a separate input set to a
  constant at serving, or weight by inverse propensity. *[Rules of ML Rule 36;
  MLDI ch. 2 Position Bias]*
- **Hold out randomized traffic and budget exploration to break degenerate
  feedback loops.** Feedback exists only for what the model chose to show, so
  top items gain clicks, rank higher, narrow the catalog, and amplify bias.
  *[Rules of ML Rules 34-35; Hidden Debt sec. 4; MLDI ch. 2 Exploration;
  AIE ch. 10 Degenerate Feedback Loop]*
- **Design the cold-start path for new users and items explicitly.** Use
  feature towers, cluster embeddings, or popular items instead of an unseen
  id. *[MLDI Usecases Instagram; ch. 6 Inference]*

## Dependencies, configuration, and debt

- **Wrap third-party ML packages behind a narrow API you own, and build one
  coherent data pipeline.** Glue code and pipeline jungles of ad hoc joins
  freeze the system. *[Hidden Debt sec. 5]*
- **Do not stack a correction model on another model's output, and assume any
  change shifts the whole model.** Add features to the original instead, and
  diff old and new predictions on sampled traffic (a self-diff must be zero).
  *[Hidden Debt sec. 2; Rules of ML Rule 24]*
- **Treat ML config as reviewed code expressed as diffs from a prior config,
  with automated assertions such as feature count.** *[Hidden Debt sec. 6; ML
  Test Score Model 1]*
- **List each model's upstream signals in a checked-in manifest that notifies
  owners on change, and validate inputs against your own schema.** Do not rely
  on the producer's checks. *[Hidden Debt sec. 3; ML Test Score Monitor 1]*

## Tensions

- **Simple linear baseline vs pretrained model first.** Rules of ML, Hidden
  Debt, and the ML Test Score predate embedding APIs and hosted LLMs. Start
  with the simplest thing that proves the pipeline, which today may be a
  pretrained model, but keep a trivial baseline and pin the vendor model as a
  versioned upstream dependency.
  *[Rules of ML Rules 14, 17; Hidden Debt sec. 3; ML Test Score Model 5]*
- **Log served features vs one shared transform library vs a feature store.**
  All three fight skew. Default to a shared transform plus logged served
  features; adopt a feature store only when several models share features.
  *[Rules of ML Rules 29, 32; MLOps (GCP); MLDI ch. 1 Spotify case]*
- **Position as a feature vs inverse propensity; bandits as impractical vs
  routine.** MLDI and Hidden Debt downplay propensity and bandit methods, which
  are now common. Either bias correction is fine; the house rule is a
  randomized holdout to evaluate it. *[MLDI ch. 2; Hidden Debt sec. 4]*
- **Bit-identical reproducibility vs GPU nondeterminism.** Reproduce within a
  tolerance and document what stays nondeterministic. *[ML Test Score Infra 1]*
- **Canaries vs pre-release tests.** Catch model-server incompatibility in
  integration tests; the canary is only the last line. *[ML Test Score Infra 6]*
- **Corrections to MLDI.** Minority classes get the larger weight, not the
  majority; a 5th-95th quantile interval should contain about nine in ten
  actuals; scaling depends on model family (trees need none). The rules above
  use the corrected readings; its 2022 vendor stack is illustrative only.
  *[MLDI ch. 1, ch. 7]*

## Sources

- **MLDI**: Machine Learning Design Interview (Khang Pham, 2022)
- **Rules of ML**: Rules of Machine Learning (Martin Zinkevich, Google for
  Developers), <https://developers.google.com/machine-learning/guides/rules-of-ml>
- **Hidden Debt**: Hidden Technical Debt in Machine Learning Systems (Sculley
  et al., NeurIPS 2015),
  <https://proceedings.neurips.cc/paper_files/paper/2015/file/86df7dcfd896fcaf2674f757a2463eba-Paper.pdf>
- **ML Test Score**: The ML Test Score: A Rubric for ML Production Readiness
  and Technical Debt Reduction (Breck et al., IEEE Big Data 2017),
  <https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/>
- **MLCC**: Machine Learning Crash Course, Production ML systems (Google for
  Developers),
  <https://developers.google.com/machine-learning/crash-course/production-ml-systems>
- **ML pipelines**: Managing ML Projects: ML pipelines (Google for Developers),
  <https://developers.google.com/machine-learning/managing-ml-projects/pipelines>
- **MLOps (GCP)**: MLOps: Continuous delivery and automation pipelines in
  machine learning (Google Cloud Architecture Center),
  <https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning>
- **AIE**: AI Engineering: Building Applications with Foundation Models (Chip
  Huyen, O'Reilly, 1st ed., 2025)
- **Review lessons**: rules distilled from the maintainer's code-review findings
