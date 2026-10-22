# AGENTS.md

Best practices for software work, compiled from the books listed in
[SOURCES.md](SOURCES.md) and from primary web sources for areas the books do
not cover. This file stays small on purpose. The core rules below apply to
every task. Everything else lives in `practices/` and loads only when the task
needs it.

## How to use this library

1. **Apply the core rules below on every task.**
2. **Route before you start.** Match the task, and the files it touches,
   against the routing table and file signals below. Load every file that
   matches; most tasks need one to three.
3. **Read top-down and stop early.** Each practice file opens with
   **Top rules**. Read those first, then only the sections for the subtopics
   the task actually touches.
4. **Re-route when the task changes shape.** A bug fix that turns into a
   schema migration now also needs the data files.
5. **Precedence.** The host project's own instructions and established
   conventions come first, then this library. Inside the library, security and
   data integrity beat correctness, correctness beats performance, and
   performance beats style. A more specific file beats a general one. Each
   file's **Tensions** section gives the house position where sources disagree.

Links are relative to this file. When another project points at this library,
resolve them from this repository's location.

## Core rules (always on)

1. **Understand before you change.** Read the surrounding code, reproduce the
   behavior or bug, and follow the conventions already there.
   [Debugging](practices/core/debugging.md),
   [Code design](practices/core/code-design.md)
2. **Optimize for the next reader.** Prefer deep modules with small
   interfaces, names that state intent, one home for each piece of knowledge,
   and comments that say only what the code cannot.
   [Code design](practices/core/code-design.md)
3. **Build only what the stated requirement needs.** Do the asked task, and
   propose extra scope separately instead of expanding the diff silently.
   [Working with agents](practices/core/working-with-ai-agents.md)
4. **Parse external input at the boundary.** Env vars, flags, query params,
   and bodies go through a parser that rejects bad values and fails fast.
   Never swallow an error.
   [Security](practices/security/application-security.md)
5. **Enforce invariants structurally.** "Only one", "never twice", and "at
   most N" live in types, unique indexes, constraints, or locks, never in a
   comment or an in-process flag.
   [Data modeling](practices/data/data-modeling.md)
6. **Scope every data access to its tenant and authorize on the server.**
   Every query on user- or org-owned data carries the tenant column. Deny by
   default. [Security](practices/security/application-security.md)
7. **Prove changes with tests that check behavior.** Watch a new test fail
   first, reproduce each bug with a failing test, mock only out-of-process
   dependencies, and never weaken a check to get green.
   [Testing](practices/testing/testing.md)
8. **Fix causes, not symptoms, then sweep for siblings.** After a fix, grep
   for the same pattern and fix every instance in the same change.
   [Debugging](practices/core/debugging.md)
9. **Work in small, releasable steps.** Keep one logical change per commit
   and PR, keep branches short-lived, and never rewrite shared history.
   [Version control](practices/core/version-control.md),
   [Process](practices/core/engineering-process.md)
10. **Make "done" checkable, and check it.** Run the tests, linters, and
    build that prove the outcome. Audit every comment, docstring, doc, and PR
    sentence the diff touches so they match the code.
    [Process](practices/core/engineering-process.md)
11. **Bound everything.** Timeouts on every remote call, limits on page size
    and payload, and a cap or pagination on every list: ask what happens at
    10k rows. [Distributed systems](practices/distributed/distributed-systems.md)
12. **Stop and ask before irreversible or outward-facing actions.** That means
    deleting data, changing auth, migrating production schemas, disabling a
    safety check, touching secrets, or force-pushing.
    [Working with agents](practices/core/working-with-ai-agents.md)

## Routing table

### Writing and changing code

| Load when | File |
| --- | --- |
| Writing or reviewing any function, class, or module; naming; placing errors, comments, or config | [core/code-design.md](practices/core/code-design.md) |
| Restructuring code without changing behavior; changing untested or legacy code; migrations and rewrites | [core/refactoring-and-legacy-code.md](practices/core/refactoring-and-legacy-code.md) |
| A test, build, or program fails, crashes, hangs, or is wrong; a bug report or stack trace arrives | [core/debugging.md](practices/core/debugging.md) |
| Running Git beyond status or diff; commits, branches, rebases, PR descriptions, code review | [core/version-control.md](practices/core/version-control.md) |
| Writing, changing, or reviewing tests; mocking; flaky or slow suites; coverage | [testing/testing.md](practices/testing/testing.md) |
| Choosing or implementing a data structure or algorithm; complexity claims | [algorithms/algorithms-and-data-structures.md](practices/algorithms/algorithms-and-data-structures.md) |
| Writing or debugging a regular expression; ReDoS | [tools/regular-expressions.md](practices/tools/regular-expressions.md) |

### Planning and process

| Load when | File |
| --- | --- |
| Planning, slicing, or estimating work; defining done; design docs; choosing dependencies; metrics; postmortems | [core/engineering-process.md](practices/core/engineering-process.md) |
| Writing a task spec, prompt, sub-agent brief, skill, or AGENTS.md/CLAUDE.md; deciding when to escalate | [core/working-with-ai-agents.md](practices/core/working-with-ai-agents.md) |

### Design and architecture

| Load when | File |
| --- | --- |
| Applying or removing a design pattern; class hierarchies; SOLID; enterprise patterns (repository, unit of work, DTO) | [design/design-patterns.md](practices/design/design-patterns.md) |
| Choosing system structure, layers, boundaries, dependency direction; ADRs; adopting a framework or platform | [architecture/architecture-fundamentals.md](practices/architecture/architecture-fundamentals.md) |
| Modeling business logic: entities, value objects, aggregates, bounded contexts, ubiquitous language | [architecture/domain-driven-design.md](practices/architecture/domain-driven-design.md) |
| Splitting, calling, or deploying independent services; sagas; API gateways; monolith migration | [architecture/microservices.md](practices/architecture/microservices.md) |
| Publishing or consuming messages or events; queues, outbox, CDC, idempotent consumers, event sourcing, CQRS | [architecture/event-driven-and-messaging.md](practices/architecture/event-driven-and-messaging.md) |
| Designing for growth: capacity estimates, load balancing, sharding, replicas, rate limits, system-design questions | [architecture/scalability-and-system-design.md](practices/architecture/scalability-and-system-design.md) |
| Code that crosses a network or process boundary and must survive failure: timeouts, retries, consistency, clocks, leases | [distributed/distributed-systems.md](practices/distributed/distributed-systems.md) |
| Concurrency: threads, async tasks, locks, atomics, pools, queues; races and deadlocks | [concurrency/concurrency.md](practices/concurrency/concurrency.md) |

### Data

| Load when | File |
| --- | --- |
| Designing or changing a schema, keys, constraints, migrations, multi-tenant data, warehouse models | [data/data-modeling.md](practices/data/data-modeling.md) |
| Writing or tuning SQL or ORM queries, indexes, EXPLAIN plans, N+1 problems, pagination | [data/sql-and-query-performance.md](practices/data/sql-and-query-performance.md) |
| Transactions, isolation, locking, live migrations, connection pools, backup and restore, replication, failover | [data/database-operations.md](practices/data/database-operations.md) |
| Document, wide-column, or key-value stores (MongoDB, Cassandra, DynamoDB-style) | [data/nosql.md](practices/data/nosql.md) |
| Elasticsearch or OpenSearch: mappings, analyzers, queries, relevance, reindexing | [data/search-elasticsearch.md](practices/data/search-elasticsearch.md) |
| Any cache or Redis: keys, TTLs, invalidation, eviction, locks, rate limits, Streams | [data/caching-and-redis.md](practices/data/caching-and-redis.md) |
| Kafka producers, consumers, topics, Streams, ksqlDB, Connect, cluster tuning | [messaging/kafka.md](practices/messaging/kafka.md) |

### APIs and security

| Load when | File |
| --- | --- |
| Designing or reviewing an HTTP or REST API: URIs, methods, status codes, errors, pagination, versioning, OpenAPI | [api/api-design.md](practices/api/api-design.md) |
| Authentication, sessions, tokens, authorization, input handling, injection, uploads, secrets, crypto, CORS, CSP | [security/application-security.md](practices/security/application-security.md) |

### Front end and mobile

| Load when | File |
| --- | --- |
| HTML markup, templates, JSX structure, or any CSS | [frontend/html-and-css.md](practices/frontend/html-and-css.md) |
| UI components and state in React, Next.js, Vue, or Svelte; effects, data fetching, hydration | [frontend/components-and-state.md](practices/frontend/components-and-state.md) |
| Any user-facing UI: forms, controls, dialogs, ARIA, keyboard and focus, color, motion, WCAG | [frontend/accessibility.md](practices/frontend/accessibility.md) |
| Page load, responsiveness, or layout stability; Core Web Vitals; images, fonts, scripts, caching | [frontend/web-performance.md](practices/frontend/web-performance.md) |
| Android, iOS, Flutter, or React Native app code | [mobile/mobile-apps.md](practices/mobile/mobile-apps.md) |

### Languages and frameworks

| Load when | File |
| --- | --- |
| JavaScript or TypeScript, Node.js, package and compiler config | [languages/javascript-typescript.md](practices/languages/javascript-typescript.md) |
| Python code, typing, packaging, asyncio | [languages/python.md](practices/languages/python.md) |
| Java code, JVM tuning, Java concurrency, JUnit | [languages/java.md](practices/languages/java.md) |
| Spring Boot or Spring Framework apps | [languages/spring-boot.md](practices/languages/spring-boot.md) |

### Delivery and operations

| Load when | File |
| --- | --- |
| CI pipeline config, merge gates, CI secrets, artifact promotion, deployment and release strategy | [devops/ci-cd.md](practices/devops/ci-cd.md) |
| Dockerfiles, Compose files, images, running or debugging containers | [devops/containers.md](practices/devops/containers.md) |
| Kubernetes manifests, Helm, Kustomize, probes, autoscaling, RBAC, operators, cluster debugging | [devops/kubernetes.md](practices/devops/kubernetes.md) |
| Logs, metrics, traces, SLOs, alerts, runbooks, health checks, overload handling, incidents | [operations/observability-and-reliability.md](practices/operations/observability-and-reliability.md) |
| Services on a public cloud or PaaS; infrastructure as code; IAM; networking; managed services; cost | [cloud/cloud-architecture.md](practices/cloud/cloud-architecture.md) |
| Load, stress, or soak tests; microbenchmarks; performance budgets and CI gates | [testing/performance-and-load-testing.md](practices/testing/performance-and-load-testing.md) |

### Systems

| Load when | File |
| --- | --- |
| Talking to the OS directly: files, processes, signals, fsync, temp files; shell scripts; systemd; Linux hosts | [systems/operating-systems-and-linux.md](practices/systems/operating-systems-and-linux.md) |
| Sockets, wire protocols, DNS, TLS, proxies; MQTT and IoT; network automation | [systems/networking.md](practices/systems/networking.md) |

### Machine learning and LLMs

| Load when | File |
| --- | --- |
| Application code that calls an LLM API or SDK: prompts, structured output, tool calling, agent loops, RAG and embeddings, prompt injection, MCP | [llm/llm-applications.md](practices/llm/llm-applications.md) |
| Building or reviewing evals for an LLM feature: eval sets, metrics, LLM-as-judge, model selection, regression gates | [llm/llm-evaluation.md](practices/llm/llm-evaluation.md) |
| Latency, throughput, or cost of LLM calls; prompt caching, batch APIs, model routing; self-hosting or serving models | [llm/inference-and-serving.md](practices/llm/inference-and-serving.md) |
| Deciding whether to finetune; preparing or generating training data; running or reviewing a finetune | [llm/finetuning-and-data.md](practices/llm/finetuning-and-data.md) |
| Building, evaluating, deploying, or monitoring an ML model or pipeline, or code that acts on predictions | [ml/ml-systems.md](practices/ml/ml-systems.md) |

## File signals

When a task touches these files, load the matching practice files even if
the request does not name the domain.

| Files touched | Load |
| --- | --- |
| `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `package.json`, `tsconfig*.json` | JavaScript/TypeScript; for UI files also components-and-state and accessibility |
| `*.html`, `*.css`, `*.scss`, templates | HTML and CSS, accessibility |
| `*.py`, `pyproject.toml` | Python |
| `*.java`, `pom.xml`, `build.gradle*` | Java; Spring Boot if Spring starters are present |
| `*.sql`, migration directories, ORM models | Data modeling, SQL and query performance, database operations |
| `Dockerfile`, `compose*.yaml` | Containers |
| Kubernetes YAML, Helm charts, Kustomize | Kubernetes |
| `.github/workflows/*`, `.gitlab-ci.yml`, `Jenkinsfile` | CI/CD, security |
| Terraform, CDK, CloudFormation, Bicep, Pulumi | Cloud architecture |
| `*.kt`, `*.swift`, `*.dart`, Android or iOS project files | Mobile apps |
| Route handlers, controllers, OpenAPI specs | API design, security |
| `*_test.*`, `*.test.*`, `*.spec.*`, `tests/` | Testing |
| `*.sh`, systemd units, crontabs | Operating systems and Linux |
| Imports of an LLM SDK (`anthropic`, `openai`, `@anthropic-ai/sdk`, `google-genai`, LangChain, an MCP SDK), prompt templates, eval sets | LLM applications, security; LLM evaluation for eval sets |

## Maintaining this library

See [CONTRIBUTING.md](CONTRIBUTING.md) for the practice-file format and how to
add a file. Run `python build/check_library.py` before committing. The
pre-commit hook in `.githooks/` runs it along with markdownlint.
