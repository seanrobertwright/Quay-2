# Cloud architecture

> **Load when:** building or reviewing a service on a public cloud or PaaS
> (AWS, Azure, Google Cloud, Cloud Foundry, Heroku-style); writing IaC (CDK,
> CloudFormation, Terraform, Bicep, Pulumi); wiring config, secrets, IAM, or
> workload identity; placing resources in VPCs, subnets, and zones; using
> managed queues, databases, or identity providers; designing health
> endpoints, failover, backups, blast-radius limits, alarms, or runbooks; or
> reviewing a design for twelve-factor fitness, cost, or tags.
> **See also:** [Distributed systems](../distributed/distributed-systems.md),
> [Event-driven and messaging](../architecture/event-driven-and-messaging.md),
> [Microservices](../architecture/microservices.md),
> [CI/CD](../devops/ci-cd.md), [Containers](../devops/containers.md),
> [Kubernetes](../devops/kubernetes.md),
> [Observability](../operations/observability-and-reliability.md),
> [Application security](../security/application-security.md),
> [Database operations](../data/database-operations.md),
> [Spring Boot](../languages/spring-boot.md)

## Top rules

1. **Build one immutable artifact per commit, promote that exact artifact
   through every environment, and inject everything that differs per deploy.**
   Test: could the repo go public today without leaking a credential or host?
   *[12-Factor: Config, Build-release-run; CNJ ch. 1, 3, 15; CNSiA ch. 2]*
2. **Give every workload and person its own identity with short-lived
   credentials (roles, federation, workload identity); never create long-lived
   access keys.** Grant each permission in IaC, scoped to one action and
   resource. *[AWS WAF SEC02-BP02; Stratospheric ch. 3, 8, 16]*
3. **Make processes stateless, share-nothing, and disposable.** State,
   sessions, and token stores live in a backing service; start in seconds; on
   SIGTERM stop intake, finish in-flight work, requeue the rest, exit.
   *[12-Factor: Processes, Disposability; CNJ ch. 1, 5; CNSiA ch. 2, 7]*
4. **Put explicit connect and request timeouts on every cross-process call,
   and retry at exactly one layer: transient errors only, idempotent
   operations only, capped exponential backoff with jitter.** Defaults wait
   forever; stacked retries become storms.
   *[AWS WAF REL05-BP03, REL05-BP05; CNJ ch. 7, 12; CNSiA ch. 8]*
5. **Define all infrastructure declaratively in version control, pass account
   and region explicitly, change production only through the pipeline, and
   detect drift.** Console edits are unreviewed and unrepeatable.
   *[AWS WAF Reliability design principles, REL08-BP04; Stratospheric ch. 4, 6]*
6. **Spread across availability zones with pre-provisioned capacity to lose
   one, and fail over using data-plane actions only.** Launching resources or
   editing DNS mid-outage relies on control planes that may be failing too.
   *[AWS WAF REL11-BP04, REL11-BP05, REL10-BP03]*
7. **Keep liveness shallow (no dependency calls) and put only dependencies the
   service cannot serve without into readiness.** A shared dependency in every
   probe pulls every replica at once.
   *[Azure AC Health Endpoint Monitoring; CNSiA ch. 13]*
8. **Treat every managed queue as at-least-once: idempotent consumers, a
   dead-letter queue with an alarm, and a visibility timeout above the longest
   processing time.** *[AWS WAF REL04-BP04, REL05-BP04; Stratospheric ch. 12;
   CNSiA ch. 10]*
9. **Make only the edge public; put databases and internal services in private
   subnets with their own security groups, and still authenticate every
   internal call.** Network position is not trust. *[Stratospheric ch. 6, 11
   (dated: the sample runs tasks in public subnets to skip NAT cost);
   CNSiA ch. 2, 12; Azure WAF Security principles]*
10. **Use the same type and version of each backing service in dev as in
    prod, and prefer managed services to self-hosting.** A local stand-in
    database passes tests prod fails. *[12-Factor: Dev/prod parity; CNSiA
    ch. 2, 5; CNJ ch. 5, 13 (dated: allows H2); AWS WAF OE design principles]*

## The twelve-factor contract

- **Reach each backing service through a locator and credential in config,
  treating local and managed services identically.** Swaps and restores are
  then config changes. *[12-Factor: Backing services; CNJ ch. 1; CNSiA ch. 2]*
- **Do not bundle settings into named environment groups in the code; set
  each value per deploy.** Groups multiply with every environment; name
  feature profiles after what they enable. *[12-Factor: Config; CNSiA ch. 4]*
- **Give each release a unique ID and treat releases as append-only.** A
  config fix is a new release; rollback points at an earlier one.
  *[12-Factor: Build-release-run; CNSiA ch. 15]*
- **Use local disk only as scratch inside one unit of work.** Durable files
  go to an object store; check by destroying and recreating an instance.
  *[12-Factor: Processes; CNJ ch. 1, 5; CNSiA ch. 2]*
- **Never use sticky sessions or app-server session replication.** Keep
  sessions and OAuth client state in a time-expiring shared store.
  *[12-Factor: Processes; Azure AC Design principles; CNJ ch. 5; CNSiA ch. 9]*
- **Make background jobs reentrant by transaction or idempotency, and assume
  processes die without warning.** Use a queue that returns unacknowledged
  work on disconnect. *[12-Factor: Disposability]*
- **Write logs unbuffered to stdout as structured events; never manage log
  files from the app.** *[12-Factor: Logs; CNJ ch. 13; CNSiA ch. 13]*
- **Ship migrations and admin scripts in the app repo and run them as one-off
  platform jobs from the same image and config.** Laptop scripts drift and
  leave no audit trail. *[12-Factor: Admin processes; CNJ ch. 1; CNSiA ch. 2]*

## Configuration and secrets

- **Parse every config value and IaC parameter at startup or synth and fail
  fast naming the bad key.** Reject empty strings, NaN, malformed ids, and
  out-of-range numbers; never call `Number()` on an env var unchecked.
  *[Stratospheric ch. 6; Review lessons]*
- **Handle a secret in this order: remove it, replace it with a short-lived
  credential, then store it in a secrets manager read or mounted at runtime.**
  Never in source, config files, URLs, or plain parameter stores. *[AWS WAF
  SEC02-BP03; Stratospheric ch. 11]*
- **Generate database credentials in the cloud, attach them to the instance
  for managed rotation, and wire them to the service from IaC.**
  *[Stratospheric ch. 11]*
- **Inject secrets through the platform's secret field, not as plaintext
  values rendered into a task definition or manifest.** Anyone who can
  describe the deployment reads rendered values. *[Stratospheric ch. 11
  (dated: renders plaintext env vars); CNSiA ch. 14]* Image and Secret-object
  rules: [Containers](../devops/containers.md), [Kubernetes](../devops/kubernetes.md).
- **When tooling must write a secret to disk, use a uniquely named temp file
  with owner-only permissions.** *[Review lessons]*
- **Scan for committed secrets in CI and a pre-commit hook, and audit secret
  reads.** *[AWS WAF SEC02-BP03; Review lessons]*

## Identity and access

- **Never use the account root user for daily work.** Use it once to create
  the first administrator. *[Stratospheric ch. 3]*
- **Give services credentials only through the platform role (task role,
  instance profile, workload identity).** *[Stratospheric ch. 8; AWS WAF
  SEC02-BP02]*
- **Name actions and resources in IAM policies; avoid wildcards and broad
  managed policies; grant admin rights just in time, not standing.** Narrow
  grants revoke one capability at a time. *[Stratospheric ch. 3, 16; Azure WAF
  Security principles]*
- **Authenticate CI to the cloud through OIDC federation to a scoped role,
  and grant workflows only the token permissions they use.** Request an
  identity token only when federation consumes it. *[Stratospheric ch. 7
  (dated: stores long-lived keys); Review lessons]*
  See [CI/CD](../devops/ci-cd.md).
- **Delegate end-user login to a managed OIDC provider and treat it as a hard
  dependency.** Use authorization code with PKCE and keep SPA tokens in a
  backend-for-frontend; never implicit or password grants. *[Stratospheric
  ch. 10; CNSiA ch. 11, 12; CNJ ch. 8 (dated grants)]*
- **Scope every read and write of tenant- or user-owned data by the tenant
  column in the query, even when the id is globally unique.** *[CNSiA ch. 12;
  Review lessons]*

## Infrastructure as code

- **Use declarative templates or CDK-style programs that apply and roll back
  as a unit, not imperative CLI scripts.** On AWS CDK use v2 (`aws-cdk-lib`);
  v1 reached end of support in 2023. *[Stratospheric ch. 4 (dated: CDK v1)]*
- **Keep conditional logic out of IaC programs.** Each branch multiplies the
  environments you must reason about. *[Stratospheric ch. 4]*
- **Parameterize stacks by application and environment name and prefix every
  resource with them.** Staging, prod, and per-developer stacks then coexist.
  *[Stratospheric ch. 6]*
- **Take the image reference as a stack input, never hardcoded.** The
  pipeline picks the artifact. *[Stratospheric ch. 6]*

## Network and edge

- **Put a thin edge service or gateway in front of internal services for
  authentication, rate limiting, CORS, and routing; keep business logic out.**
  A fat gateway becomes the next monolith. *[CNJ ch. 8; CNSiA ch. 9]*
- **Check CORS origins against a per-endpoint allow-list; never answer `*` on
  an endpoint that reads or writes state.** *[CNJ ch. 8; Review lessons]*
- **Authenticate at the edge, relay a token downstream, and strip credentials
  downstream services should not see.** Resource servers validate the token
  per request and stay stateless. *[CNJ ch. 8; CNSiA ch. 12]*
- **Rate-limit inbound traffic per client with shared state, and limit calls
  to metered third-party APIs on the client side.** A per-instance limiter
  does not enforce a fleet-wide cap. *[CNSiA ch. 9; CNJ ch. 8]*
- **Put a work-intake API in front of internal queues; never expose a queue to
  clients.** *[AWS WAF REL05-BP04]*
- **Give outbound HTTP clients that carry a token a timeout and disable
  redirects.** A redirect can forward the credential elsewhere.
  *[Review lessons]*
- **Encrypt data in transit and at rest to match its class, and never route it
  through a lower-security tier.** *[Azure WAF Security principles; AWS WAF
  Security design principles]*

## Calls between components

- **Throttle every API on purpose: limits from load tests, 429 on excess,
  capped consumer concurrency, never above what was tested.**
  *[AWS WAF REL05-BP02]*
- **Classify errors before retry or fallback.** Business errors such as 404
  go straight back; doomed requests fail fast. *[AWS WAF REL05-BP04;
  CNSiA ch. 8]*
- **Wrap repeatedly failing dependencies in a circuit breaker, composed with
  the time limiter innermost (per attempt), then the breaker, and retry
  outermost.** Each retry then passes through the breaker and gets its own
  timeout. *[AWS WAF REL05-BP01; CNJ ch. 12 (dated: Hystrix); CNSiA ch. 8, 9]*
- **Make mutating APIs idempotent with a client-generated token stored with
  the first response under a unique index, expired by TTL, never a
  timestamp.** *[AWS WAF REL04-BP04; Review lessons]* Retry, saga, and
  outbox detail: [Distributed systems](../distributed/distributed-systems.md).
- **Prefer messaging when the result need not be immediate and the peer may
  be down, and never use XA across services.** Use sagas with idempotent
  compensations. *[CNJ ch. 10, 12; CNSiA ch. 10; Azure AC Design principles]*
- **Run cluster-wide scheduled jobs through a lease, leader election, or a
  scheduler that records runs, never a timer on every replica.** "Runs once"
  needs a lock or unique constraint in shared state. *[CNJ ch. 11;
  Review lessons]*

## Fault isolation, degradation, and recovery

- **Turn hard dependencies into soft ones: serve cached, partial, or default
  data when a non-critical dependency fails, and test each one down.**
  *[AWS WAF REL05-BP01; Google WAF Graceful degradation; CNSiA ch. 8]*
- **Never clear a cache or config because a refresh failed; serve the last
  good value and alarm.** *[AWS WAF REL05-BP01, REL11-BP05]*
- **Shed excess load at the front door and give each replica its own overload
  protection.** *[Google WAF Graceful degradation]*
- **Limit blast radius with cells keyed on a value every request carries,
  such as tenant ID: tested maximum size, no shared state, a thin router, one
  cell per deploy wave.** *[AWS WAF REL10-BP03, Reliability design principles]*
- **Default to multiple zones in one region; go multi-region only for a
  stated requirement.** *[AWS WAF REL10-BP03]*
- **Run a failure mode analysis at design time.** List each failure point on
  critical flows with impact, detection, and recovery. *[Azure AC Design
  principles; Azure WAF Reliability principles]*
- **Prove backups by scheduled, automated restores to a new location that are
  queried, validated, and timed against RTO and RPO.** *[AWS WAF REL09-BP04]*
- **Keep backups immutable and encrypted, and secure recovery environments
  like production.** *[Azure WAF Security principles]*

## Health checks

- **Give each dependency check its own timeout, report "degraded" for
  optional dependencies, and keep probe rates far below user traffic.**
  *[Azure AC Health Endpoint Monitoring]*
- **Keep health endpoints read-only and minimal; put diagnostics behind
  authentication.** An obscure path is not access control.
  *[Azure AC Health Endpoint Monitoring; CNSiA ch. 13]*
- **Expose service name, version, and build commit on an info endpoint.**
  *[CNJ ch. 13]* Probe wiring: [Kubernetes](../devops/kubernetes.md).

## Managed queues and asynchronous work

- **Put a queue between a user action and a slow or quota-limited side effect
  such as email.** The consumer retries and stays under provider limits.
  *[Stratospheric ch. 12]*
- **Bound max receive count and alarm on DLQ depth and oldest-message age.**
  Depth alone hides consumers falling behind. *[AWS WAF REL05-BP04;
  Stratospheric ch. 12]*
- **Acknowledge or delete a message only after it succeeds.** Delete-always
  loses failures silently. *[Stratospheric ch. 12; CNSiA ch. 10]*
  Message design: [Event-driven](../architecture/event-driven-and-messaging.md).

## Data services

- **Each service owns its store; integrate through APIs or events, never a
  shared database.** *[CNJ ch. 6, 9, 12]*
- **Choose partition keys with high, even cardinality.** One hot key turns
  scale-out into one throttled partition. *[Stratospheric ch. 14; Azure AC
  Design principles]*
- **Ship schema changes as versioned expand-then-contract migrations that
  release N-1 still runs against, with a written stateful rollback plan.**
  *[CNSiA ch. 5; CNJ ch. 15; Azure WAF Safe deployment]*
  See [Database operations](../data/database-operations.md).

## Deployment and change

- **Replace resources instead of patching them, and shift traffic by canary or
  blue/green.** The old version stays intact and SSH can be off.
  *[AWS WAF REL08-BP04; CNJ ch. 15]*
- **Roll out every change, config and flag flips included, in waves with
  health gates and lengthening bake times; halt on regression.** Gate on
  traffic volume too, so a silent drop is not read as health.
  *[Azure WAF Safe deployment]*
- **Ship small, frequent, reversible changes on trunk, and serialize deploys
  per environment.** *[Azure WAF Safe deployment; Stratospheric ch. 4, 7]*
- **Decommission in stages: confirm idle across a business cycle, snapshot,
  disable, watch through peak, then delete.** *[Azure WAF Safe deployment]*
  Pipelines and promotion: [CI/CD](../devops/ci-cd.md).

## Observability and alarms

- **Define SLIs from the user's side and set per-flow targets below 100%.**
  CPU is not a reliability signal. *[Google WAF Define reliability,
  Set targets; Azure WAF Reliability principles]*
- **Alarm on latency at the load balancer, not only in controllers.**
  *[Stratospheric ch. 17]*
- **Set missing-data behavior per alarm: breaching for continuous metrics,
  not breaching where silence is healthy.** *[Stratospheric ch. 17]*
- **Page on composite alarms, link each to a runbook in the repo, and tune
  thresholds after every postmortem.** *[Stratospheric ch. 17]*
- **Run simple synthetic canaries on the few critical journeys, alarming on
  several consecutive failures.** *[Stratospheric ch. 18]*
- **Mitigate first (roll back), diagnose later, and automate remediation such
  as scaling consumers on queue depth.** *[CNJ ch. 13]*
  Telemetry practice:
  [Observability](../operations/observability-and-reliability.md).

## Environments, local development, and cost

- **Emulate the cloud locally (emulators, real database containers, a local
  OIDC provider), not a shared real account or toggled-off cloud code.**
  *[Stratospheric ch. 9; CNSiA ch. 5]*
- **Tag every resource with owner, workload, environment, and cost center,
  enforced by templates.** *[AWS WAF COST03-BP03]*
- **Turn non-production environments off outside working hours or scale them
  to zero.** *[AWS WAF Cost optimization design principles]*
- **Right-size from measured utilization, delete resources with no traffic or
  no owner tag, and set lifecycle rules that move cold data to colder storage
  tiers.** *[AWS WAF Sustainability design principles]*

## Tensions

- **Env vars for credentials vs secrets managers.** House: env vars for
  non-secret config only; workload identity instead of keys; remaining
  secrets from a vault. *[12-Factor: Config; AWS WAF SEC02-BP03; CNJ ch. 3]*
- **Env vars vs mounted config files.** House: a few simple values as env
  vars; larger or rotating config mounted. *[CNSiA ch. 2, 14]*
- **SSH one-offs vs immutable hosts.** House: one-offs run as platform jobs
  from the release image; SSH off. *[12-Factor: Admin processes;
  AWS WAF REL08-BP04]*
- **Graceful degradation vs avoiding fallback.** House: degrade in the same
  code path with cached or partial data; no incident-only paths.
  *[AWS WAF REL05-BP01; CNJ ch. 12]*
- **Static-stability headroom vs cost.** House: decide per flow by
  criticality. *[AWS WAF REL11-BP05, Cost optimization design principles]*
- **Load shedding vs circuit breaking.** House: shed to protect yourself from
  callers; break to protect yourself from a dependency. *[Google WAF Graceful
  degradation; AWS WAF REL05-BP01]*
- **Readiness on hard dependencies vs local only.** House: include one only
  when no request can succeed without it; CNJ's health endpoint aggregating
  every dependency is the older view. *[CNSiA ch. 13; Azure AC Health
  Endpoint Monitoring; CNJ ch. 7, 13]*
- **In-app service registry vs platform discovery.** CNJ routes through a
  registry with client-side balancing. House: platform DNS and load balancing;
  Ribbon, Hystrix, and Zuul 1 left Spring Cloud in 2020.0, and an in-app
  registry couples code to infrastructure. *[CNJ ch. 7; CNSiA ch. 7]*
- **Security controls vs reliability.** House: design them together; check
  probes can authenticate and egress rules allow dependencies.
  *[Azure WAF Security principles]*

## Sources

- **12-Factor**: The Twelve-Factor App (factors cited by name; text last
  revised 2017, open-sourced 2024), <https://12factor.net>
- **AWS WAF**: AWS Well-Architected Framework (2024-11-06), best practices by
  ID, <https://docs.aws.amazon.com/wellarchitected/latest/framework/>
- **Azure WAF**: Azure Well-Architected Framework (Reliability and Security
  principles; Safe deployment practices),
  <https://learn.microsoft.com/en-us/azure/well-architected/>
- **Azure AC**: Azure Architecture Center (Design principles; Health Endpoint
  Monitoring pattern), <https://learn.microsoft.com/en-us/azure/architecture/>
- **Google WAF**: Google Cloud Well-Architected Framework, Reliability pillar,
  <https://docs.cloud.google.com/architecture/framework>
- **Stratospheric**: Stratospheric: From Zero to Production with Spring Boot
  and AWS (Tom Hombergs, Björn Wilmsmann, Philip Riecks; Leanpub, 2021)
- **CNJ**: Cloud Native Java: Designing Resilient Systems with Spring Boot,
  Spring Cloud, and Cloud Foundry (Josh Long, Kenny Bastani; O'Reilly, 1st
  edition, 2017)
- **CNSiA**: Cloud Native Spring in Action: With Spring Boot and Kubernetes
  (Thomas Vitale; Manning, 2023)
- **Review lessons**: rules distilled from the maintainer's code-review findings
