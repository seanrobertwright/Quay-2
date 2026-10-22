# Continuous integration and delivery

> **Load when:** writing or reviewing pipeline configuration (GitHub Actions
> workflows, `.gitlab-ci.yml`, a Jenkinsfile, or any CI YAML), build, test,
> or deploy scripts that CI runs, branch protection and merge gates, CI
> secrets, tokens, and runners, artifact versioning and promotion, a
> deployment or release strategy (rolling, blue-green, canary, feature flags,
> rollback), schema migrations shipped by a pipeline, or diagnosing a slow,
> flaky, or red pipeline.
> **See also:** [Containers and Docker](containers.md), [Kubernetes](kubernetes.md),
> [Version control and code review](../core/version-control.md),
> [Testing](../testing/testing.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Application and API security](../security/application-security.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Database operations](../data/database-operations.md),
> [Engineering process](../core/engineering-process.md)

## Top rules

1. **Define the pipeline in a file in the application's repository, and never
   create or edit jobs by hand in the CI server's UI.** It then gets review,
   history, and revert like other code. *[PaC ch. 2, 7;
   CD-Docker-Jenkins ch. 4]*
2. **Run the pipeline on every commit and PR, require it to pass before
   merge, and treat a red trunk as stop-the-line: fix or revert at once.**
   Changes piled onto a red build hide each other's defects.
   *[DevOps Handbook ch. 10, 11; Accelerate ch. 4; PaC ch. 9]*
3. **Integrate to trunk at least daily with short-lived branches and feature
   flags, not long-lived feature branches.** A weeks-old branch is deferred
   integration. *[Accelerate ch. 4; DevOps Handbook ch. 11; MSE ch. 5]*
4. **Build each artifact once, tag it with the commit SHA or digest, and
   promote that exact artifact through every environment, injecting config
   at deploy time.** A per-stage rebuild ships what staging never tested.
   *[DevOps Handbook ch. 9, 10; CD-Docker-Jenkins ch. 5, 7; PaC ch. 9]*
5. **Keep the commit stage to about five to ten minutes and commit-to-
   deployable under an hour.** Slower feedback means trunk is never green.
   *[MSE ch. 8, 14; CD-Docker-Jenkins ch. 4; DevOps Handbook ch. 10]*
6. **Keep secrets out of the repo, pipeline YAML, images, caches, and logs;
   use short-lived scoped credentials and rotate anything ever committed.**
   History and image layers keep values forever. *[GitLab-CICD ch. 5, 7;
   LGHA ch. 9; CD-Docker-Jenkins ch. 7; Review lessons]*
7. **Treat event text, fork PRs, and third-party actions as hostile:** pass
   untrusted values through env vars, never `${{ }}` inside `run:`; build
   forks only under unprivileged triggers; pin actions to full SHAs; grant the
   job token minimum scopes. *[LGHA ch. 6, 9; Review lessons]*
8. **Automate deployment with one mechanism for every environment, and fail
   it unless a smoke test proves the new version is live and reaches its
   dependencies.** *[DevOps Handbook ch. 12; Accelerate ch. 9;
   CD-Docker-Jenkins ch. 7; PaC ch. 11]*
9. **Separate deployment from release and design the rollback before the
   first release;** rollback runs through the same pipeline, never around its
   tests. *[DevOps Handbook ch. 12; MSE ch. 14; CD-Docker-Jenkins ch. 9]*
10. **Make every migration backward compatible with the running version
    (expand, migrate, contract) and run it as a pipeline stage.** Old and new
    code share one database during a rollout. *[DevOps Handbook ch. 12;
    CD-Docker-Jenkins ch. 9]*

## Authoring pipeline config

- **Lint CI config before pushing** (platform lint endpoint, CLI, or editor
  extension) and simulate `rules:` for the target ref; push-until-green fills
  history with debug commits. *[PaC ch. 2; GitLab-CICD ch. 12]*
- **Make CI call the same build entry points developers run locally, as
  plain shell commands.** A CI-only path drifts from local builds.
  *[GitLab-CICD ch. 4; CD-Docker-Jenkins ch. 4]*
- **Give each job one task and a name that says what it does;** a `test` job
  that also runs five scanners is a review defect. *[GitLab-CICD ch. 4]*
- **Factor repeated config into versioned reusable units** (reusable
  workflows, composite actions, GitLab components or `extends:` templates,
  shared libraries) with typed, defaulted inputs, and pin callers to a tag or
  SHA. Copy-pasted pipelines drift. *[GitLab-CICD ch. 9; LGHA ch. 12;
  PaC ch. 14; CD-Docker-Jenkins ch. 9]*
- **Use current mechanisms:** `$GITHUB_OUTPUT`, not the deprecated
  `set-output`; GitLab `rules:`, not `only`/`except`; rulesets, not the old
  required-workflow and tag-protection features. *[LGHA ch. 7, 9, 12;
  GitLab-CICD ch. 8, 12]*
- **Parse every pipeline input at the boundary:** dispatch inputs, env vars,
  and script flags are checked (non-empty, in range, well-formed) and the job
  fails fast with a clear message. *[Review lessons]*
- **Write cron schedules in UTC on purpose** and stamp generated files with
  ISO-8601 UTC times; servers may read cron in local time.
  *[PaC ch. 14; Review lessons]*

## Stages, speed, and feedback

- **Order stages fastest-first:** compile, unit tests, lint, and static
  analysis; then build and store the artifact; then acceptance tests in a
  production-like environment; then performance and security; then
  exploratory testing. *[DevOps Handbook ch. 10; PaC ch. 1;
  CD-Docker-Jenkins ch. 1]*
- **Run independent checks in parallel with fail-fast, and model real
  dependencies as a DAG (`needs:`)** so jobs start when their inputs exist.
  *[GitLab-CICD ch. 9; PaC ch. 8]*
- **Pass outputs between jobs as declared artifacts; use caches only for
  dependencies.** A cache miss must cost time, never correctness.
  *[GitLab-CICD ch. 9; LGHA ch. 7]*
- **Key caches on OS plus a hash of the lockfile with broader fallbacks,**
  and prefer a setup action's built-in cache; a per-pipeline key defeats
  caching. *[LGHA ch. 7; GitLab-CICD ch. 9]*
- **Set an explicit timeout on every job and every wait** (approvals,
  quality-gate callbacks); defaults run for hours. *[LGHA ch. 8; PaC ch. 8,
  10; CD-Docker-Jenkins ch. 9]*
- **Cancel superseded PR runs with a workflow-plus-ref concurrency group, but
  queue deploys rather than cancelling them mid-flight.** *[LGHA ch. 8]*
- **Run teardown, report upload, and notifications in a block that runs after
  failure** (`post { always }`, `when: always`, `!cancelled()`); a
  notification inside the failing stage never fires. *[CD-Docker-Jenkins
  ch. 5; PaC ch. 10; GitLab-CICD ch. 4; LGHA ch. 8]*
- **Publish JUnit results, coverage, and annotations to the PR** so reviewers
  need not dig through logs. *[GitLab-CICD ch. 4, 6; LGHA ch. 10; PaC ch. 8]*

## Keeping trunk green

- **Gate merges with rulesets or branch protection: no direct pushes,
  required checks and review, and a merge queue or gated commit** that proves
  the change against current trunk. *[PaC ch. 9; DevOps Handbook ch. 11;
  LGHA ch. 9]*
- **Let anyone revert the commit that broke trunk, and fix undeployability
  ahead of feature work.** *[DevOps Handbook ch. 10; Accelerate ch. 4;
  CD-Docker-Jenkins ch. 1]*
- **Fix, quarantine, or delete a flaky test the day it appears;** a pass must
  mean releasable, and quarantined tests need an owner so they are not
  forgotten. *[DevOps Handbook ch. 10; Accelerate ch. 4; MSE ch. 14]*

## Tests in the pipeline

Test design lives in [testing.md](../testing/testing.md); this is the CI part.

- **When a later stage or production finds a bug, add a test at the fastest
  stage that could have caught it.** *[DevOps Handbook ch. 10;
  CD-Docker-Jenkins ch. 9]*
- **Make the automated acceptance suite the release gate, covering all that
  "releasable" means here:** functional, performance, security, resilience,
  and compliance. *[MSE ch. 14; CD-Docker-Jenkins ch. 1]*
- **Scope each pipeline to one independently deployable unit;** needing other
  teams' pipelines before release means the boundary is wrong. Prefer
  contract tests to joint end-to-end suites. *[MSE ch. 9, 14;
  Accelerate ch. 5]*
- **Run tests in a pinned job container and run databases as health-checked
  service containers reset per suite,** not on whatever the runner image
  ships. *[PaC ch. 8; LGHA ch. 5, 13]*
- **Make lint and static-analysis gates fail the build,** keep unused imports
  and dead code as errors, and lint Markdown. Never downgrade a correctness
  rule to a warning globally; scope the suppression to one file.
  *[PaC ch. 8; Review lessons]*
- **Run a pre-commit hook and matching CI step that fail on U+FFFD
  replacement characters and on maintainers' personal identifiers**
  (usernames, home paths, email addresses) in tracked files.
  *[Review lessons]*
- **Gate high-value operations on performance thresholds (for example p99
  latency) in a stable, isolated environment,** run slow non-functional suites
  nightly, and review their trends. *[DevOps Handbook ch. 10;
  GitLab-CICD ch. 10; CD-Docker-Jenkins ch. 7; MSE ch. 14]*
- **Use synthetic or masked test data loaded through public APIs, never a raw
  production snapshot.** *[CD-Docker-Jenkins ch. 9; Accelerate ch. 4]*

## Secrets and credentials

- **Store secrets in the CI secret store or a secrets manager, masked and
  scoped to the environment or protected branch that needs them.**
  *[GitLab-CICD ch. 5, 8; LGHA ch. 6, 9]*
- **Prefer the auto-issued job token, platform roles, or OIDC federation to
  long-lived keys and personal tokens,** and request `id-token: write` only
  on the job that performs OIDC; the books predate OIDC as the cloud default.
  *[LGHA ch. 9; GitLab-CICD ch. 8; PaC ch. 9; Review lessons]*
- **Never bake deploy keys into agent or app images, compose files, or
  manifests;** inject them at run time. *[CD-Docker-Jenkins ch. 7;
  PaC ch. 10]*
- **Never echo, encode, cache, or dump secrets or whole contexts;** masking
  matches exact registered values only, so base64 and substrings leak.
  *[LGHA ch. 7, 8, 9, 10]*
- **Write a secret that must touch disk to a uniquely named 0600 temp file,
  never a predictable path or a command-line argument.**
  *[Review lessons; PaC ch. 9]*
- **Validate values placed in a shell `export` or `eval` as identifiers, and
  give token-carrying HTTP calls a timeout with redirects off.**
  *[Review lessons]*
- **Run secret detection on every commit (history mode on imported repos);
  revoke and rotate a committed secret rather than deleting it.**
  *[GitLab-CICD ch. 5, 7; LGHA ch. 9]*

## GitHub Actions and pull-request hardening

- **Bind untrusted values to `env:` and use `"$VAR"` in the script;** titles,
  bodies, branch names, labels, author emails, `inputs.*`, and secrets are
  all injectable when expanded inline. *[LGHA ch. 6, 7, 9]*
- **Set `permissions:` per job with minimum scopes, add `contents: read`
  whenever the job checks out code, and keep the repo default read-only;**
  never grant a broad scope where a narrower one works.
  *[LGHA ch. 6, 9; Review lessons]*
- **Build contributor code under `pull_request`, never
  `pull_request_target`, and never check out or run the PR head in a
  privileged job;** build wrappers, manifests, and local actions are attacker
  code. *[LGHA ch. 9]*
- **Split privileged write-backs into a `workflow_run` workflow** that treats
  the unprivileged run's uploaded artifact as untrusted data. *[LGHA ch. 9]*
- **Pin third-party actions to full commit SHAs with a version comment,
  update them through automated PRs, and read their source before
  adoption.** Tags move. Enforce pins with the allowed-actions SHA-pinning
  policy. *[LGHA ch. 9; GitHub SHA-pinning policy]*
- **Restrict allowed actions, put workflow files under CODEOWNERS, and
  require approval for first-time contributors' runs.** *[LGHA ch. 9]*
- **After fixing one workflow, sweep every workflow for the same pattern and
  overlapping triggers, and fix them all in one change.** *[LGHA ch. 9;
  Review lessons]*

## Runners and CI infrastructure

- **Run each build in a fresh, ephemeral environment from a pinned image;**
  persistent runners leak files between jobs. *[DevOps Handbook ch. 22;
  LGHA ch. 5; GitLab-CICD ch. 5]*
- **Never use self-hosted runners on public repos or shell executors outside
  trusted projects, and never mount the host Docker socket.** Each gives fork
  code a path to the host. *[LGHA ch. 5, 9; GitLab-CICD ch. 5; PaC ch. 14]*
- **Run no builds on the controller; route jobs by label or tag to
  autoscaled, disposable agents,** preferring Linux. *[PaC ch. 3, 5;
  CD-Docker-Jenkins ch. 3; GitLab-CICD ch. 5; LGHA ch. 5]*
- **Harden CI like production:** provision it as code, keep it private, use
  SSO with roles and an audit log, restrict runner egress, give CI read-only
  source credentials, and trial upgrades on a test instance.
  *[DevOps Handbook ch. 22; PaC ch. 4, 14; CD-Docker-Jenkins ch. 3]*
- **Back up CI state remotely, test the restore, and monitor runner health
  apart from build results.** *[PaC ch. 13, 14; GitLab-CICD ch. 5]*

## Artifacts, versioning, and supply chain

Image construction (multi-stage builds, base-image pins, `.dockerignore`)
lives in [containers.md](containers.md).

- **Push artifacts to a registry with history (not the repo or job
  artifacts) and deploy by commit SHA or digest, never `latest` or an
  environment tag,** so rollback picks an existing build. *[PaC ch. 9;
  CD-Docker-Jenkins ch. 5, 7; GitLab-CICD ch. 9]*
- **Scan dependencies, images, and IaC on every commit against committed
  lockfiles, and gate on an explicit policy;** a green scanner job only
  means it ran. *[DevOps Handbook ch. 22; PaC ch. 8, 9; GitLab-CICD ch. 7]*
- **Generate an SBOM and a signed provenance attestation for every artifact,
  and make the deploy step or admission policy reject one whose signature or
  digest fails.** Use keyless Sigstore signing with SLSA provenance; the
  book's PGP-key signing is dated. *[DevOps Handbook ch. 9, 22]*

## Deployment and release

- **Default to continuous delivery (every green build releasable, production
  one approval away);** remove the manual gate only once change fail rate
  shows the suite reliably stops bad builds.
  *[GitLab-CICD ch. 4; PaC ch. 1; Accelerate ch. 4]*
- **Map refs to targets explicitly:** PRs to ephemeral review environments,
  trunk to staging, tags or promotions to production, and unknown refs to
  nothing privileged. *[GitLab-CICD ch. 4, 8; PaC ch. 10]*
- **Isolate environments by network or account with a deploy credential
  each, and gate production with environment protection rules.**
  *[PaC ch. 10; LGHA ch. 6]*
- **Have the pipeline record every deployment** (who, artifact hash, config
  revision, target, output), and put work-item IDs in commits so releases
  trace to stories. *[DevOps Handbook ch. 12, 23]*
- **Never change production by hand; apply idempotent, version-controlled
  definitions or replace the instance.** *[DevOps Handbook ch. 9;
  Accelerate ch. 4; CD-Docker-Jenkins ch. 6]*
- **Prefer pull-based GitOps for Kubernetes, and run IaC through review plus
  validate-and-plan before apply.** *[GitLab-CICD ch. 8, 12; PaC ch. 11]*
- **Deploy with zero downtime in business hours,** rolling by default and
  blue-green or canary for instant rollback; an off-hours window is an
  architectural defect. *[Accelerate ch. 5, 9; CD-Docker-Jenkins ch. 8, 9]*
- **Wait on rollout readiness, not a sleep, then check the reported version
  equals the build and one real transaction works.** A 200 can come from the
  old version. *[PaC ch. 11; DevOps Handbook ch. 12]*
- **Roll back automatically from post-deploy failure handlers and when canary
  metrics leave range.** *[CD-Docker-Jenkins ch. 9; DevOps Handbook ch. 12]*
- **Keep services backward compatible so each ships and rolls back alone;**
  orchestrated multi-service releases are an anti-pattern.
  *[CD-Docker-Jenkins ch. 9; Accelerate ch. 5; MSE ch. 13]*
- **Put risky work behind flags, test the shipped default and all-on states,
  and give each release flag an owner and removal date.** Dark-launch risky
  back ends. *[DevOps Handbook ch. 12; CD-Docker-Jenkins ch. 4]*

## Database changes in the pipeline

- **Keep migrations forward-only and versioned** (a legacy schema becomes
  migration one): add, dual-write, backfill, stop reading the old structure,
  and drop it only after the rollback window. *[CD-Docker-Jenkins ch. 9;
  DevOps Handbook ch. 12]*
- **Commit the schema change before the code that uses it,** so the pipeline
  proves it works with old code. *[CD-Docker-Jenkins ch. 9]*

## Change control and audit

Review mechanics live in [version-control.md](../core/version-control.md).

- **Meet separation of duties with a non-author approval plus a
  pipeline-only route to production,** for code, infra, and schema alike.
  *[Accelerate ch. 7; DevOps Handbook ch. 12; MSE ch. 14]*
- **Answer incidents with tests, smaller changes, and telemetry, not more
  approvals or freezes.** *[DevOps Handbook ch. 18; Accelerate ch. 7; MSE ch. 3]*
- **Before a pipeline PR, audit every claim it relies on** ("this job only
  runs on main", README lines, comments) against the config, and make the PR
  description cover the whole diff: why, how, the risks, and their
  countermeasures. *[Review lessons; DevOps Handbook ch. 18]*
- **Compute DORA's current metrics from pipeline and incident data:** change
  lead time, deployment frequency, change fail rate, failed deployment
  recovery time (the books' "time to restore"), and deployment rework rate.
  *[Accelerate ch. 2; MSE ch. 3; DORA metrics guide]*

## Tensions

- **Continuous delivery vs continuous deployment.** Default to delivery with
  a timed production approval; one source swaps the terms, so use the
  standard meanings. *[GitLab-CICD; PaC; CD-Docker-Jenkins]*
- **Build once vs rebuild per environment branch.** Build once; per-branch
  rebuilds and mutable tags ship untested artifacts. *[PaC; DevOps Handbook]*
- **Trunk-based vs PR or GitFlow.** Use short-lived PRs merged within a day
  through a merge queue; GitFlow is dated for continuous delivery.
  *[Accelerate; MSE; PaC]*
- **No external approval vs regulated change control.** Peer review plus a
  pipeline-only path; regulated teams keep pipeline-generated audit evidence.
  *[Accelerate; DevOps Handbook; MSE]*
- **Coverage gates vs coverage as signal.** Report coverage beside pass rates,
  since it says nothing about assertions; no global percentage gate, and gate,
  if at all, on changed lines. *[DevOps Handbook; CD-Docker-Jenkins;
  GitLab-CICD; MSE]*
- **Sequential vs parallel stages.** Phases stay sequential; checks within a
  phase run in parallel. *[CD-Docker-Jenkins; GitLab-CICD; PaC]*
- **Advisory vs blocking scanners.** Block merges on new critical or high
  findings. *[GitLab-CICD; PaC]*
- **Production-clone staging vs progressive delivery.** A smaller staging is
  acceptable when canaries with auto-rollback test real load.
  *[CD-Docker-Jenkins; DevOps Handbook]*
- **Fix forward vs roll back.** Flag off first, then roll back; fix forward
  only for trivial fixes. *[DevOps Handbook]*

## Sources

- **DevOps Handbook**: The DevOps Handbook, Second Edition (Gene Kim, Jez
  Humble, Patrick Debois, John Willis, Nicole Forsgren; IT Revolution, 2021)
- **Accelerate**: Accelerate: The Science of Lean Software and DevOps (Nicole
  Forsgren, Jez Humble, Gene Kim; IT Revolution, 2018)
- **GitLab-CICD**: Automating DevOps with GitLab CI/CD Pipelines (Christopher
  Cowell, Nicholas Lotz, Chris Timberlake; Packt, 2023)
- **LGHA**: Learning GitHub Actions (Brent Laster; O'Reilly, 2023)
- **PaC**: Pipeline as Code: Continuous Delivery with Jenkins, Kubernetes, and
  Terraform (Mohamed Labouardy; Manning, 2021)
- **CD-Docker-Jenkins**: Continuous Delivery with Docker and Jenkins (Rafał
  Leszko; Packt, 2017)
- **MSE**: Modern Software Engineering (David Farley; Addison-Wesley, 2022)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
- **DORA metrics guide**: <https://dora.dev/guides/dora-metrics-four-keys/>
- **GitHub SHA-pinning policy**: GitHub Actions policy now supports blocking
  and SHA pinning actions (GitHub Changelog), <https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/>
