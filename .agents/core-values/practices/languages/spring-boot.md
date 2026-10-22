# Spring Boot

> **Load when:** writing, reviewing, or debugging a Spring Boot or Spring
> Framework application (`@SpringBootApplication`, `application.yml` or
> `.properties`, a `pom.xml` or `build.gradle` with Spring starters):
> configuring beans, properties, or profiles; building controllers, Spring
> Data repositories, transactions, Spring Security filter chains, Actuator,
> Spring tests, or WebFlux code; or packaging a Boot app as a JAR or image.
> **See also:** [Java](java.md), [Testing](../testing/testing.md),
> [Application and API security](../security/application-security.md), [HTTP and REST API design](../api/api-design.md),
> [SQL and query performance](../data/sql-and-query-performance.md), [Database operations](../data/database-operations.md),
> [Caching and Redis](../data/caching-and-redis.md), [Microservices](../architecture/microservices.md),
> [Event-driven architecture](../architecture/event-driven-and-messaging.md), [Observability](../operations/observability-and-reliability.md),
> [Containers](../devops/containers.md), [Kubernetes](../devops/kubernetes.md), [Cloud architecture](../cloud/cloud-architecture.md)

Rules target Spring Boot 4.x (Spring Framework 7, Spring Security 7, Java
17+, `jakarta.*`) and hold on 3.x unless a version is named. Most sources
predate both; their APIs are translated to current ones and marked "dated".

## Top rules

1. **Build one artifact and supply every environment-specific value and
   secret from outside it.** Credentials or endpoints in source or a packaged
   property file leak and force rebuilds; inject them from environment
   variables, mounted files, or a secret store. *[LSB3 ch. 1; SBiP ch. 2;
   SBiA ch. 3; MSB2 ch. 2; CNSiA ch. 2; Review lessons]*
2. **Bind settings to a typed, `@Validated` `@ConfigurationProperties`
   record, not scattered `@Value` lookups.** One prefix in one place, checked
   at startup, rejects empty or out-of-range values before first use. *[LSB3 ch. 6; SBiP ch. 2; SBiA ch. 3; CNJ ch. 3; Review lessons]*
3. **Inject collaborators through the constructor into `final` fields.**
   Dependencies become explicit and non-null, and unit tests build the class
   without Spring. *[LSB3 ch. 2; SBiA ch. 3; CNSiA ch. 3; Mockito4Spring ch. 1]*
4. **Customize auto-configuration with properties first, then a bean of the
   type it conditions on, then an explicit exclusion, and confirm the result
   in the conditions report.** A wrong-typed override yields two beans or an
   ignored one. *[SBiA ch. 3; MSB2 ch. 2; LSB3 ch. 1; CNJ ch. 2]*
5. **Manage schema with versioned Flyway or Liquibase migrations and keep
   `ddl-auto` at `validate` or `none` outside throwaway tests.** `create`,
   `create-drop`, and `update` destroy data or make unreviewed changes. *[SBiA ch. 8; SBiP ch. 3; Stratospheric ch. 11; CNSiA ch. 5]*
6. **Scope every query on user- or tenant-owned data by the owner column in
   the WHERE clause, not by a check after loading.** An id-only lookup is an
   IDOR waiting for its next caller. *[CNSiA ch. 12; SBiP ch. 7; Review lessons]*
7. **Declare an explicit `SecurityFilterChain` that denies by default, and
   keep CSRF on for any cookie- or session-authenticated app.** Boot's default
   security is a demo, and tutorials often disable CSRF without cause. *[LSB3 ch. 4; SBiA ch. 3; SBiP ch. 5; CNSiA ch. 11]*
8. **Expose Actuator endpoints by allow-list behind an operations role;
   never `include=*` in production.** `env`, `heapdump`, `beans`, and
   `shutdown` leak internals or stop the process. *[SBiP ch. 4 and ch. 6;
   SBiA ch. 7; MSB2 ch. 3; CNSiA ch. 13]*
9. **Test each layer with the narrowest slice (`@WebMvcTest`,
   `@DataJpaTest`, `@JsonTest`) against real databases in Testcontainers, and
   reserve `@SpringBootTest` for full wiring.** Slices are fast; H2 passing
   proves nothing about production SQL. *[LSB3 ch. 5; SBiP ch. 3; CNSiA ch. 3 and ch. 5; CNJ ch. 4]*
10. **Put a timeout on every outbound call, and keep graceful shutdown with
    `spring.lifecycle.timeout-per-shutdown-phase` below the platform's kill
    timeout.** Calls without timeouts exhaust threads; graceful is the default
    since Boot 3.4 (dated), so never set `server.shutdown=immediate`. *[MSB2 ch. 7 and ch. 10; CNJ ch. 7; CNSiA ch. 7 and ch. 8; SBiP ch. 1; Boot 3.4 release notes]*

## Configuration and profiles

- **Keep safe shared defaults in the base `application.yml` and only the
  differences in `application-{profile}.yml`.** Duplicated per-profile files
  drift apart. *[MSB2 ch. 2; Stratospheric ch. 8; SBiA ch. 3]*
- **Activate profiles from the environment (`SPRING_PROFILES_ACTIVE`) and
  order the list on purpose.** The last active profile wins on duplicate
  keys. *[LSB3 ch. 6; SBiA ch. 8; CNJ ch. 3; Stratospheric ch. 6]*
- **Walk the property precedence order before changing code for a "wrong
  value".** Command-line args beat system properties, then env vars, then
  external files, then packaged ones; `/actuator/env` shows which source won. *[SBiP ch. 2; SBiA ch. 3; MSB2 ch. 2; LSB3 ch. 6]*
- **Use one config format per location; never keep `.properties` and `.yml`
  side by side.** One silently overrides the other, and which one wins has
  changed between versions. *[SBiA ch. 3; MSB2 ch. 2]*
- **Mark a `spring.config.import` target `optional:` only when absence is
  truly fine, and never set `spring.config.name` or `location` inside
  `application.properties`.** Required config must fail fast, and those keys
  are read before that file loads. *[SBiP ch. 2]*
- **Fetch remote config with `spring.config.import=configserver:` and give
  the client timeouts and bounded retries.** `bootstrap.yml` is off by
  default since Spring Cloud 2020.0 (dated). *[CNSiA ch. 4; MSB2 ch. 6]*
- **Inject a `java.time.Clock` bean for "now" and route date parsing through
  one helper.** Zone-less strings parsed in process-local time make tests and
  hosts in different regions disagree. *[Review lessons]*

## Beans, structure, and auto-configuration

- **Put the `@SpringBootApplication` class in the root package and keep it
  minimal.** Component scanning covers only that package and below. *[SBiA ch. 2; MSB2 ch. 1]*
- **Organize by feature (controller, service, repository together), keep
  cross-cutting config in its own package, and default types to
  package-private.** Code that changes together stays together. *[Stratospheric
  ch. 8; CNJ ch. 9; LSB3 ch. 2]*
- **Keep controllers thin: they call a service that owns business logic and
  transactions, never a repository.** *[LSB3 ch. 2; SBiP ch. 3;
  Mockito4Spring ch. 4]*
- **Review each new dependency for the auto-configuration it switches on.**
  H2, the security starter, or Flyway on the classpath changes behavior with
  no code change. *[SBiA ch. 2 and ch. 3]*
- **Add capabilities through starters and let the Boot BOM manage versions;
  override one only through its version property, with the reason beside
  it.** Hand pins leave the tested set and skip coordinated CVE fixes; read
  `dependency:tree`, do not guess. *[LSB3 ch. 1; SBiA ch. 2; MSB2 ch. 1]*
- **Guard shared auto-configuration with `@ConditionalOnMissingBean` and
  register it in `AutoConfiguration.imports`, not `spring.factories`
  (dated).** Unconditional beans cannot be overridden by consumers. *[SBiP ch. 4; MSB2 ch. 2; CNJ ch. 13]*
- **On a Boot 4 upgrade, run `spring-boot-properties-migrator` until startup
  logs no renamed keys, then remove it; move to the modular starters
  (`spring-boot-starter-webmvc` replaces `-web`) and to Jackson 3
  (`tools.jackson` packages).** The old starters are deprecated and Undertow
  is unsupported. *[Boot 4.0 migration guide]*
- **Never write production data from `CommandLineRunner` or other startup
  beans; leave schema and reference data to the migration tool.** Every
  replica reruns that code; gate demo seeding behind a one-off profile and
  order runners with `@Order`. *[LSB3 ch. 7; SBiP ch. 2; SBiA ch. 8]*

## Web layer, validation, and errors

- **Validate bodies with Bean Validation and `@Valid`, and type path and
  query parameters (`UUID`, bounded numbers) so malformed input is rejected
  before your code runs.** Put business rules in custom constraints. *[SBiP ch. 2 and ch. 7; CNSiA ch. 3; Review lessons]*
- **Map exceptions in one `@RestControllerAdvice` returning RFC 9457
  `ProblemDetail`, and keep `server.error.include-stacktrace` and
  `include-message` at `never`.** Users never see internals. *[SBiP ch. 7;
  CNJ ch. 6; SBiA ch. 3; CNSiA ch. 3]*
- **Use records for request and response DTOs, separate from JPA
  entities.** One class for both couples the API to the schema. *[LSB3 ch. 3]*
- **Paginate every collection endpoint with `Pageable` and cap the size
  with `spring.data.web.pageable.max-page-size`.** Ask what happens at 10k
  rows. *[SBiP ch. 3; LSB3 ch. 3; Review lessons]*
- **Pick one API versioning strategy (path, header, or media type) and
  configure it through Framework 7's built-in support
  (`spring.mvc.apiversion.*`), not hand-rolled mappings.** Add a version only
  for breaking changes. *[SBiP ch. 7; Boot 4.0 release notes]*
- **Configure CORS for named origins on named paths; never `*` on an
  endpoint that reads or writes state.** *[CNJ ch. 8; Review lessons]*
- **Keep Spring Security's default headers (including `nosniff`) on every
  route, download routes included, and add a Content-Security-Policy.** It
  now sends `X-XSS-Protection: 0`; CSP replaces it (dated). *[SBiP ch. 5; Review lessons]*

## Data access and transactions

- **Use derived finders for fixed criteria, `@Query` with named `@Param`s
  once names grow long, and Query By Example or Querydsl when criteria vary
  per request.** Positional binding breaks on reorder; branching between
  finders explodes. *[LSB3 ch. 3; SBiP ch. 3]*
- **Bound every finder with `TopN` or `Pageable`, return projections when
  only some columns are needed, and check optional filters for real text.**
  An empty contains-match returns the table; use `IsNull`, not `= null`. *[LSB3 ch. 3; SBiP ch. 3]*
- **Annotate update and delete `@Query` methods with `@Modifying` and run
  them in a transaction.** *[SBiP ch. 3]*
- **Know the `@Transactional` defaults: REQUIRED propagation and rollback on
  unchecked exceptions only.** Add `rollbackFor` when a checked exception
  must roll back. *[Mockito4Spring ch. 1]*
- **Remember that `@Transactional`, `@Async`, and `@Cacheable` work only
  through the proxy.** A call within the same bean skips the advice; put the
  annotations on concrete classes, as Spring's reference docs advise. *[Mockito4Spring ch. 1 and ch. 5]*
- **Default reads to `readOnly = true` at class level, opt writes in per
  method, and give long lock-holding transactions a timeout.** The
  attributes do nothing when joining an existing transaction. *[Mockito4Spring ch. 1]*
- **Enforce "only one" and "never twice" in the database: unique indexes for
  usernames and emails, `@Version` for optimistic locking, row or advisory
  locks for serialized work.** In-process checks race across replicas. *[SBiP ch. 6; CNSiA ch. 5; Review lessons]*
- **Point the auto-configured HikariCP pool at the database through
  `spring.datasource.*`, and after deploy verify which database you hit.**
  With properties missing, Boot falls back to any in-memory database on the
  classpath. *[SBiA ch. 3 and ch. 8; SBiP ch. 3]*
- **Never edit an applied migration; add a new version, and ship schema
  changes expand-then-contract.** Old and new instances share the database
  during a rolling deploy. *[SBiA ch. 8; CNSiA ch. 5]*

## Security

- **Use the lambda DSL (`SecurityFilterChain` bean, `authorizeHttpRequests`,
  `requestMatchers`).** Security 6 removed `WebSecurityConfigurerAdapter` and
  `antMatchers`; Security 7 removed the `.and()` chain style (dated). *[LSB3
  ch. 4; SBiP ch. 5; SBiA ch. 3]*
- **Match verb and path for state-changing routes, end with a catch-all
  deny, and order multiple chains from most specific to most generic.** A
  forgotten route fails closed; a catch-all chain first shadows the rest. *[LSB3 ch. 4; SBiP ch. 5]*
- **Disable CSRF only on stateless token-only APIs, preferably in a separate
  chain from the session-based web app, and make logout a POST.** *[LSB3 ch. 4; SBiP ch. 5; CNSiA ch. 11]*
- **Hash passwords with the delegating encoder from
  `PasswordEncoderFactories`, and load users from your own
  `UserDetailsService` or an OIDC provider.** Never use
  `withDefaultPasswordEncoder()` or a no-op encoder. *[LSB3 ch. 4; SBiP
  ch. 5; Stratospheric ch. 10]*
- **Enforce ownership and OAuth2 scopes with `@EnableMethodSecurity` and
  `@PreAuthorize` as a second layer over owner-scoped queries.** *[LSB3 ch. 4; SBiP ch. 7]*
- **Make downstream APIs stateless OAuth2 resource servers that validate a
  JWT; never use HTTP Basic or the password grant in production.** Use
  authorization code with PKCE for users and client credentials for
  services. *[SBiP ch. 7; CNSiA ch. 12; CNJ ch. 8]*
- **Keep SPA tokens server-side in a BFF, and store its sessions and
  authorized clients in Spring Session with Redis once it has two
  replicas.** Return 401 to XHR rather than a login redirect. *[CNSiA ch. 9,
  ch. 11, and ch. 12; CNJ ch. 5]*
- **On OIDC logout, also end the provider session
  (`OidcClientInitiatedLogoutSuccessHandler`).** Otherwise the next login is
  silent. *[Stratospheric ch. 10]*
- **Keep login-failure counters and rate-limit buckets in a shared store,
  fed by Spring Security authentication events.** In-process counts hold on
  one instance only. *[SBiP ch. 6; MSB2 ch. 13; Review lessons]*

## Testing

- **Unit-test services as plain objects with constructor-injected mocks; no
  Spring context.** *[SBiA ch. 4; MSB2 ch. 11; CNJ ch. 4; Mockito4Spring ch. 4]*
- **Test controllers through MockMvc, asserting status, content type, JSON
  fields, and redirect targets.** A direct method call skips mapping,
  binding, validation, and advice. *[SBiP ch. 7; SBiA ch. 4; Mockito4Spring
  ch. 3; LSB3 ch. 5]*
- **Run repository tests on the production engine and version with
  Testcontainers and `@ServiceConnection`.** Since Boot 3.4 `@DataJpaTest`
  keeps a container database; add `@AutoConfigureTestDatabase(replace = NONE)`
  only for other real databases or older Boot (dated). Test your queries, not
  Spring Data. *[LSB3 ch. 5; CNSiA ch. 5; Boot 3.4 release notes]*
- **Replace only boundary collaborators with `@MockitoBean`.** `@MockBean`
  was deprecated in Boot 3.4 and removed in 4.0 (dated). *[CNJ ch. 4; MSB2
  ch. 11; Boot 4.0 migration guide]*
- **Test security with the filter chain active: unauthenticated, wrong-role,
  and right-role requests per protected route, using `@WithMockUser`, JWT or
  OIDC mutators, and `.with(csrf())`.** Never disable CSRF to pass a test. *[LSB3 ch. 5; SBiA ch. 4; CNSiA ch. 11]*
- **Start in-server tests on `RANDOM_PORT` with `@LocalServerPort`; never
  hard-code 8080.** *[SBiA ch. 4]*
- **Never assert row order for a query without ORDER BY.** *[LSB3 ch. 5]*

## Actuator, logging, and observability

- **Add Actuator to every service and serve health, info (with the git
  commit), metrics, and loggers on one base path or a management port.**
  Change log levels through `loggers` instead of redeploying. *[SBiA ch. 7; CNJ ch. 13; SBiP ch. 4]*
- **Set `management.endpoint.shutdown.access=none` unless an orchestrator
  needs it; `management.endpoint.<id>.enabled` is the pre-3.4 form (dated).** *[SBiA ch. 7; MSB2 ch. 3; Boot 3.4 release notes]*
- **Set health `show-details=when-authorized` and keep env and configprops
  `show-values` at `never`, the Boot 3 default.** Older key-name masking
  missed tokens. *[SBiP ch. 4; SBiA ch. 7]*
- **Point Kubernetes probes at `/actuator/health/liveness` and `readiness`,
  and keep external dependencies out of liveness.** One downstream outage
  must not restart every pod. *[CNSiA ch. 13; SBiP ch. 9; MSB2 ch. 3]*
- **Write a `HealthIndicator` for each hard dependency with a short probe
  timeout and no secrets in its details.** *[SBiP ch. 4; SBiA ch. 7; MSB2 ch. 3]*
- **Log through SLF4J on the default Logback, set levels per package with
  `logging.level.*`, and name custom files `logback-spring.xml`.** Keep
  production at INFO. *[MSB2 ch. 2; SBiA ch. 3; SBiP ch. 2]*
- **Emit JSON logs to stdout in deployed profiles
  (`logging.structured.format.console`, Boot 3.4+), and add request context
  through the MDC, cleared after each request.** Reused threads otherwise
  carry stale fields. *[Stratospheric ch. 15; CNSiA ch. 13]*
- **Pick Micrometer meters by meaning (Counter, Gauge, Timer) with
  low-cardinality tags, increment them in event listeners, and disable
  export locally.** *[SBiP ch. 4; Stratospheric ch. 16; SBiA ch. 7]*
- **Trace with Micrometer Tracing and an OpenTelemetry bridge, with trace
  and span ids in every log line.** Sleuth ended with Boot 2 (dated). *[MSB2 ch. 15; CNJ ch. 13]*

## Outbound calls, resilience, and messaging

- **Use `RestClient` or `@HttpExchange` interface clients (WebClient when
  reactive) as shared beans; write no new `RestTemplate` code.** Only beans
  get tracing, metrics, and load-balancing interceptors, and `RestTemplate`
  is slated for deprecation in Framework 7.1 (dated). *[LSB3 ch. 4; MSB2
  ch. 6; CNJ ch. 6; Spring HTTP clients]*
- **Give token-carrying clients connect and read timeouts, disabled
  redirects, and wire logging at NONE or BASIC.** Redirects and full logs
  leak tokens. *[MSB2 ch. 8; CNJ ch. 7; Review lessons]*
- **Use Resilience4j through Spring Cloud CircuitBreaker, ordered time
  limiter, breaker, retry; retry only idempotent calls and never 4xx.**
  Hystrix and Zuul are gone (dated). *[CNSiA ch. 9; MSB2 ch. 10; CNJ ch. 12]*
- **For in-process method retry, use Framework 7's `@Retryable` and
  `@ConcurrencyLimit` (enabled by `@EnableResilientMethods`), limited to
  transient exception types.** Spring Retry's `@Retryable` is the older
  form (dated). *[CNJ ch. 12; Spring resilience docs]*
- **Run scheduled jobs under a distributed lock or cluster-aware scheduler.**
  Otherwise every replica runs the job. *[CNJ ch. 11]*
- **Give Spring Cloud Stream consumers a group and a durable subscription,
  acknowledge only on success when a DLQ exists, and make them
  idempotent.** Without a group every instance gets every message. *[CNJ ch. 10; CNSiA ch. 10; Stratospheric ch. 12]*

## Reactive (WebFlux)

- **Keep the whole chain non-blocking with R2DBC or reactive drivers; never
  call JDBC or `block()` on event-loop threads.** *[LSB3 ch. 10; SBiP ch. 8; CNSiA ch. 8]*
- **Return `Mono` or `Flux` and let the framework subscribe; use `flatMap`
  for steps that return a publisher.** `map` there nests publishers and the
  side effect never runs. *[LSB3 ch. 9 and ch. 10]*
- **Order operators as `timeout`, `onErrorResume` for business errors,
  `retryWhen` with backoff, then a fallback.** *[CNSiA ch. 8]*

## Packaging and deployment

- **Ship an executable JAR, a WAR only for an existing servlet container,
  and never shade dependencies.** *[LSB3 ch. 7; SBiA ch. 8; CNJ ch. 1]*
- **Build non-root images with `spring-boot:build-image` or a layered-JAR
  (`-Djarmode=tools extract --layers`) multi-stage build.** *[LSB3 ch. 7;
  SBiP ch. 9; CNSiA ch. 6]*
- **Tag images with a unique commit-derived id; never deploy `latest`.** *[LSB3 ch. 7; MSB2 ch. 12; Stratospheric ch. 7]*
- **Keep DevTools a development-only dependency; never set a remote
  DevTools secret.** *[SBiP ch. 4; SBiA Appendix A]*
- **Use Boot's built-in AOT for native images, not Spring Native, and
  remember profiles and conditions are fixed at build time.** *[LSB3 ch. 8;
  CNSiA ch. 16]*

## Tensions

- **Environment-named vs capability-named profiles.** LSB3, Stratospheric,
  and SBiA use environment profiles; CNSiA names profiles by capability.
  This library keeps safe defaults in the base file, injects production
  values from the platform, and prefers capability profiles plus a platform
  profile when needed. *[LSB3; Stratospheric; SBiA; CNSiA]*
- **Post-load authorization vs owner-scoped queries.** SBiP uses
  `@PostAuthorize`; this library scopes the query and keeps method security
  as a second layer. *[SBiP; CNSiA; Review lessons]*
- **H2 and mocked DAOs vs real databases.** CNJ and Mockito4Spring accept
  substitutes; this library uses Testcontainers for repositories. *[CNJ; Mockito4Spring; LSB3; CNSiA]*
- **WebFlux vs virtual threads.** Use virtual threads
  (`spring.threads.virtual.enabled=true`, Java 21+) for blocking services;
  use WebFlux for streams and backpressure. *[LSB3; CNSiA]*
- **Package by layer vs by feature.** Feature packages, layers inside. *[Mockito4Spring; Stratospheric; CNJ]*
- **Rolling log files vs stdout.** Stdout in containers; capped rolling
  files only where no collector exists. *[SBiP; CNSiA; CNJ]*
- **Config Server and Eureka vs platform-native config and discovery.** On
  Kubernetes prefer ConfigMaps, Secrets, and Services. *[MSB2; CNJ; CNSiA]*

## Sources

- **LSB3**: Learning Spring Boot 3.0, Third Edition (Greg L. Turnquist; Packt, 2022)
- **SBiP**: Spring Boot in Practice (Somnath Musib; Manning, MEAP, 2021)
- **SBiA**: Spring Boot in Action (Craig Walls; Manning, 2016; Boot 1.3)
- **MSB2**: Mastering Spring Boot 2.0 (Dinesh Rajput; Packt, 2018)
- **CNSiA**: Cloud Native Spring in Action (Thomas Vitale; Manning, 2023)
- **CNJ**: Cloud Native Java (Josh Long, Kenny Bastani; O'Reilly, 2017)
- **Stratospheric**: Stratospheric: From Zero to Production with Spring Boot and AWS (Tom Hombergs, Björn Wilmsmann, Philip Riecks; Leanpub, 2021)
- **Mockito4Spring**: Mockito for Spring (Sujoy Acharya; Packt, 2015)
- **Review lessons**: rules distilled from the maintainer's code-review findings
- **Boot 3.4 release notes**: Spring Boot 3.4 Release Notes (<https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes>)
- **Boot 4.0 release notes**: Spring Boot 4.0 Release Notes (<https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Release-Notes>)
- **Boot 4.0 migration guide**: Spring Boot 4.0 Migration Guide (<https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide>)
- **Spring HTTP clients**: The state of HTTP clients in Spring, spring.io blog (<https://spring.io/blog/2025/09/30/the-state-of-http-clients-in-spring>)
- **Spring resilience docs**: Spring Framework reference, Resilience Features (<https://docs.spring.io/spring-framework/reference/core/resilience.html>)
