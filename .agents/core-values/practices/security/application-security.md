# Application and API security

> **Load when:** writing or reviewing code that authenticates users, issues or
> checks sessions and tokens, makes authorization or tenant-scoping decisions,
> parses request input, builds SQL, shell commands, or HTML from data, accepts
> file uploads, fetches user-influenced URLs, handles secrets or cryptography,
> or sets CORS, CSP, and other security headers; threat-modeling a feature; or
> triaging a vulnerability report or a dependency CVE.
> **See also:** [HTTP and REST API design](../api/api-design.md),
> [Microservices](../architecture/microservices.md), [Relational and
> analytical data modeling](../data/data-modeling.md), [SQL and query
> performance](../data/sql-and-query-performance.md), [Continuous integration
> and delivery](../devops/ci-cd.md), [Containers and Docker](../devops/containers.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [JavaScript and TypeScript](../languages/javascript-typescript.md), [Regular
> expressions](../tools/regular-expressions.md), [Testing](../testing/testing.md), [LLM applications](../llm/llm-applications.md)

## Top rules

1. **Authorize every request on the server, deny by default, and check the
   caller against the specific record.** Every query, update, or delete on
   user- or org-owned data carries the tenant column in its WHERE clause; a
   globally unique id is never enough. *[OWASP API Top 10: API1; OWASP Top 10:
   A01; ASVS V8; Review lessons]*
2. **Parse every external input at the boundary with a schema parser that
   rejects bad values and fails fast.** Env vars, CLI flags, query params, and
   bodies all go through it; allowlist shapes, never denylist characters.
   *[OWASP CS: Input Validation; WebAppSec ch. 19; Review lessons]*
3. **Keep data out of the command channel.** Parameterized queries for every
   datastore, argv arrays with no shell for processes, and identifiers (table,
   column, sort key) mapped from an allowlist in code. *[OWASP Top 10: A05;
   OWASP CS: Query Parameterization; WebAppSec ch. 25]*
4. **Encode output for its exact context and treat every raw-HTML escape hatch
   as review-blocking.** Escape every value interpolated into HTML; allow only
   `http`, `https`, `mailto`, and relative URLs in `href` and `src`.
   *[OWASP CS: XSS Prevention; WebAppSec ch. 22; Review lessons]*
5. **Use vetted standards and libraries for auth, tokens, password hashing,
   and crypto; never invent your own.** Home-grown schemes repeat solved
   mistakes. *[WebAppSec ch. 7; API Stronghold ch. 1, 5; OWASP Top 10: A04]*
6. **Keep secrets out of source, images, logs, and browser storage.** Inject
   them at runtime from a secrets manager and scan for them in pre-commit and
   CI. *[OWASP CS: Secrets Management; WebAppSec ch. 3; Review lessons]*
7. **Put an explicit bound on everything a request can consume.** Payload
   size, page size, timeouts, nesting depth, rate, and paid third-party calls;
   ask what happens at 10k rows. *[OWASP API Top 10: API4; WebAppSec ch. 26;
   Review lessons]*
8. **Fail closed and say little.** An exception in auth or validation denies
   the request, rolls back partial work, and returns a generic error; detail
   goes to server logs, never to the caller. *[OWASP Top 10: A10; API
   Stronghold ch. 4]*
9. **Ship every security fix with a regression test and a sibling sweep.**
   Grep for the same pattern across all handlers and fix every instance in
   the same change; reopened old bugs are a large share of reports.
   *[WebAppSec ch. 20, 21; Review lessons]*

## Authorization and tenant isolation

- **Put the ownership or tenant check inside the data access, not only at the
  route.** Route-level role checks miss object-level access (IDOR/BOLA).
  *[OWASP API Top 10: API1; ASVS V8]*
- **Check the permission the data being read requires, not only the one the
  action requires.** A "view report" page that loads billing rows needs the
  billing permission. *[Review lessons]*
- **Authorize fields as well as objects.** Select returned fields per role
  instead of serializing whole entities, and bind request bodies to input
  DTOs or field allowlists, never to persistence models. *[OWASP API Top 10:
  API3; OWASP CS: Mass Assignment; ASVS V15]*
- **Derive role and entitlement from the authenticated session, never from
  client-supplied fields.** A payload flag that unlocks paid features is a
  logic bug no scanner finds. *[WebAppSec ch. 19]*
- **Route function-level checks through one central module, and make admin
  controllers inherit a base that enforces the role.** Prefer attribute- or
  relationship-based rules over role sprawl for per-object access.
  *[OWASP API Top 10: API5; OWASP CS: Authorization]*
- **In chained service calls, authorize as the originating user, not the
  calling service.** Trusting "it came from the gateway" makes a confused
  deputy. *[ASVS V8; API Stronghold ch. 7]*
- **Isolate tenants at every tier: queries, cache keys, storage paths, search
  indexes, queues.** A secondary search store must sync permission changes
  and deletions. *[OWASP Top 10: A06; WebAppSec ch. 18]*
- **Grant least privilege by default and enforce partner or internal access
  with real authentication, never by leaving an endpoint undocumented.**
  Design every internal API as if it will reach the internet. *[API
  Stronghold ch. 1, 2, 3]*
- **Write tests that assert denial: default deny, other user, other tenant,
  and error paths.** *[OWASP CS: Authorization; OWASP API Top 10: API1]*
- **Enforce "only one", "never twice", and "at most N" in the database.** Use
  a unique or partial unique index, a conditional update, `SELECT ... FOR
  UPDATE`, or an advisory lock; check-then-act in code is a TOCTOU race.
  *[ASVS V2, V15; Review lessons]*

## Input validation and parsing

- **Validate syntax (type, format, length, range), then semantics (end after
  start, id belongs to caller).** Validation never replaces parameterization
  or output encoding. *[OWASP CS: Input Validation; ASVS V2]*
- **Reject NaN, empty strings, malformed UUIDs, and out-of-range numbers with
  a clear message.** Never convert external input to a number unchecked, and
  check that any value placed in a shell `export` or `eval` is a valid
  identifier. *[Review lessons]*
- **Cap size and parser depth before parsing, decode once, and validate the
  representation you will use.** *[OWASP CS: Input Validation]*
- **Escape user values before building a regex, anchor validation patterns,
  and never run user-supplied patterns.** Use a linear-time engine or a
  timeout that rejects. *[WebAppSec ch. 26; OWASP CS: Input Validation; Review
  lessons]* See [Regular expressions](../tools/regular-expressions.md).
- **Use `Map`, null-prototype objects, and `Object.hasOwn` (not `in`) for
  user-keyed data.** This blocks prototype pollution. *[ASVS V15; Review
  lessons]*
- **Accept one structured format per operation, and never accept a query,
  command, or script from the client.** Map intent onto an allowlist of
  server operations. *[WebAppSec ch. 19, 25]*

## Injection: SQL, shell, deserialization, XML, LLM

- **List every datastore adapter (SQL and NoSQL) and audit each call site for
  interpolation.** A string in a query builder's raw `where` is injection;
  stored procedures running dynamic SQL need binds too. *[WebAppSec ch. 25;
  OWASP CS: Query Parameterization]*
- **Prefer a library to shelling out; otherwise use a fixed executable, an
  argument array, no shell, and `--` before user arguments.** Escaping still
  allows argument injection. *[OWASP CS: OS Command Injection Defense]*
- **Generate server-side filenames, and run helper CLIs under their own
  least-privileged identity.** User filenames enable overwrites and chained
  commands. *[WebAppSec ch. 13, 19, 25]*
- **Never deserialize untrusted data with native object serializers.** Parse
  JSON into DTOs, use safe YAML loaders, and keep polymorphic typing off.
  *[OWASP CS: Deserialization; OWASP Top 10: A08]*
- **Disable DTDs and external entities in every XML parser explicitly,
  including SVG and SOAP bridges.** Prefer JSON for plain payloads.
  *[WebAppSec ch. 12, 24]*
- **Treat LLM output and retrieved content as untrusted input.** Encode it per
  sink, enforce tool permissions in code outside the model, and bind human
  approval to the exact action. *[OWASP CS: LLM Prompt Injection Prevention]*

## XSS and HTML output

- **Rely on framework auto-escaping, and flag every `dangerouslySetInnerHTML`,
  `v-html`, `innerHTML`, or `bypassSecurityTrust*` in review.** *[OWASP CS:
  XSS Prevention]*
- **Insert user data as text through one shared DOM helper whose unsafe-HTML
  option is explicitly named.** User-authored HTML goes through a maintained,
  current sanitizer whose output you do not modify. *[WebAppSec ch. 7, 10, 22;
  OWASP CS: XSS Prevention]*
- **Never interpolate untrusted data into script blocks, event handlers, CSS,
  or string-evaluated timers.** No encoding makes those sinks safe; do not
  accept user stylesheets. *[OWASP CS: XSS Prevention; WebAppSec ch. 22]*
- **Parse user URLs with the URL API and allowlist the scheme; encode
  components, never whole URLs.** *[WebAppSec ch. 22; Review lessons]*
- **Ship a strict nonce- or hash-based CSP with `strict-dynamic`, `object-src
  'none'`, and `base-uri 'none'` from day one.** Roll out in report-only
  mode, and never ship `csp: null` in a desktop-shell config. CSP is a second
  layer, not the fix. *[OWASP CS: Content Security Policy; Review lessons]*

## Authentication and passwords

- **Hash passwords with Argon2id (at least 19 MiB, 2 iterations, parallelism
  1); use scrypt, or PBKDF2-HMAC-SHA-256 at 600,000+ iterations under FIPS.**
  Store parameters with each hash and rehash on login when they change.
  *[OWASP CS: Password Storage; WebAppSec ch. 18 (dated)]*
- **Require 8+ characters (15+ recommended), allow 64+, allow paste, and
  screen against common and breached lists.** No composition rules or forced
  rotation. *[ASVS V6; WebAppSec ch. 18]*
- **Enforce equal strength on login, sign-up, recovery, API keys, and mobile.**
  An MFA fallback must not be weaker than MFA. *[ASVS V6; OWASP Top 10: A07]*
- **Prefer passkeys/WebAuthn, then TOTP; treat SMS and email as weak
  factors.** Rate-limit OTP checks and push approvals. *[ASVS V6; WebAppSec
  ch. 18 (dated)]*
- **Return the same message, with similar timing, for every login, sign-up,
  and recovery outcome.** Throttle without letting attackers lock out users.
  *[OWASP Top 10: A07; OWASP CS: Forgot Password]*
- **Build reset links from a configured base URL, never the Host header.**
  Tokens are CSPRNG, single-use, user-bound, and short-lived. *[OWASP CS:
  Forgot Password]*

## Sessions, tokens, OAuth, and OIDC

- **Session cookies are `Secure`, `HttpOnly`, `SameSite`, and `__Host-`
  prefixed, with 64+ bits of CSPRNG entropy, and never stored in
  localStorage.** Rotate the id at login and privilege change; never accept
  ids from URLs. *[OWASP CS: Session Management; WebAppSec ch. 3]*
- **Enforce idle and absolute timeouts on the server and destroy the session
  on logout.** *[OWASP CS: Session Management; API Stronghold ch. 4]*
- **When verifying a JWT, pin the algorithm per key, reject `alg: none`, and
  check `exp`, `nbf`, `iss`, `aud`, and `typ`.** Never trust key material
  from the header. *[OWASP CS: JSON Web Token; API Stronghold ch. 5]*
- **Keep access tokens short-lived and revoke through refresh tokens or a
  `jti`+`iss` denylist.** *[OWASP CS: JSON Web Token]*
- **Use authorization code with PKCE (`S256`) for OAuth clients and client
  credentials for machines, and match redirect URIs exactly.** Implicit and
  password grants are retired. *[OAuth BCP; API Stronghold ch. 5 (dated)]*
- **Use OAuth for delegation and OIDC ID tokens for identity; clients never
  parse access tokens.** The API still applies its own policy beyond consent,
  and clients request only needed scopes. An API key identifies an app, not a
  user. *[API Stronghold ch. 1, 5]*
- **Authenticate once at the edge and pass a signed identity token each
  service validates.** External clients get opaque tokens swapped for
  internal JWTs at the gateway. *[API Stronghold ch. 7]* See
  [Microservices](../architecture/microservices.md).
- **Use sender-constrained tokens (mTLS-bound or DPoP) for high-value APIs,
  and rotate or sender-constrain refresh tokens issued to public clients.**
  *[OAuth BCP; API Stronghold ch. 5 (dated)]*

## CSRF, CORS, and response headers

- **GET and HEAD never change state.** *[WebAppSec ch. 23; OWASP CS: CSRF
  Prevention]*
- **Protect cookie-authenticated writes with the framework's CSRF defense in
  middleware before every route.** Hand-built tokens are synchronizer or
  HMAC-signed, session-bound double-submit, compared in constant time.
  *[OWASP CS: CSRF Prevention; WebAppSec ch. 23]*
- **Add Fetch Metadata (`Sec-Fetch-Site`) rejection with an Origin allowlist
  fallback.** SameSite is defense in depth. *[OWASP CS: CSRF Prevention]*
- **Scope CORS to named endpoints and origins; never `*` on anything that
  reads or writes state, even on localhost.** *[OWASP CS: HTTP Headers;
  Review lessons]* See [API design](../api/api-design.md).
- **Send CSP `frame-ancestors`, `nosniff`, `Referrer-Policy`, HSTS, and a
  restrictive Permissions-Policy; set `nosniff` on every download route.**
  Give each body an accurate `Content-Type`. *[OWASP CS: HTTP Headers;
  Review lessons]*
- **Serve all traffic over TLS 1.2+ (prefer 1.3) with forward-secret suites,
  and WebSockets over WSS with an Origin check.** Signatures and API keys give
  no confidentiality; turn on hybrid post-quantum key exchange where the TLS
  stack offers it. *[OWASP Top 10: A04; ASVS V4; API Stronghold ch. 9 (dated)]*

## Outbound requests and SSRF

- **Give every outbound HTTP client that carries a token a timeout and
  disabled redirects.** *[Review lessons; OWASP CS: SSRF Prevention]*
- **Build user-influenced fetches from an allowlisted scheme, host, port,
  and path.** Never pass a user's full URL through. *[OWASP CS: SSRF
  Prevention; OWASP API Top 10: API7]*
- **Resolve once, verify the IP is public, connect to that IP, and back it
  with egress rules blocking internal ranges and cloud metadata.** Never
  return the raw fetched body. *[OWASP CS: SSRF Prevention; ASVS V15]*
- **Validate third-party API responses as strictly as user input.** *[OWASP
  API Top 10: API10]*

## File uploads

- **Allowlist extensions after decoding, ignore client `Content-Type`,
  rename to generated ids, and store outside any executable or web root.**
  *[OWASP CS: File Upload; API Stronghold ch. 4]*
- **Cap sizes after decompression, re-encode images, and process risky
  formats in an isolated process.** *[OWASP CS: File Upload; ASVS V15;
  WebAppSec ch. 27]*

## Resource limits and abuse

- **Cap and paginate queries whose cost grows with user-controlled data, and
  make timeouts cancel the database work.** *[WebAppSec ch. 14, 26]*
- **Limit GraphQL depth or cost, and disable introspection in production
  unless the API is public.** *[ASVS V4]*
- **Protect flows that harm when automated (checkout, sign-up, OTP) with
  flow-specific anti-automation, and cap spend on paid third-party APIs.**
  *[OWASP API Top 10: API4, API6]*
- **Enforce multi-step flows in order on the server, inside transactions
  that fully commit or roll back.** *[ASVS V2; OWASP Top 10: A10]*

## Secrets, cryptography, and data protection

- **Prefer workload identity or short-lived credentials; never put secrets in
  code, config, Dockerfile `ENV`/`ARG`, or pipeline files.** *[OWASP CS:
  Secrets Management]* See [Containers](../devops/containers.md).
- **Write secrets to uniquely named temp files with owner-only (0600)
  permissions, never a predictable path.** *[Review lessons]*
- **Run secret scanners in pre-commit and CI, plus a grep that blocks
  personal identifiers such as home-directory paths and email addresses.**
  *[OWASP CS: Secrets Management; Review lessons]*
- **Use AEAD ciphers and a CSPRNG, never reuse an IV under one key, and
  retire MD5, SHA-1, and CBC.** *[OWASP Top 10: A04]*
- **Store only the sensitive fields a feature reads, truncate or tokenize
  card and ID numbers, and send `Cache-Control: no-store` on sensitive
  responses.** `no-cache` still stores. *[OWASP Top 10: A04; WebAppSec ch. 18]*

## Errors, logging, and alerting

- **Log authn, authz, and validation failures, admin actions, and privilege
  changes with who, what, when, and a correlation id.** Strip CR/LF from
  untrusted values. *[OWASP CS: Logging; OWASP Top 10: A09]*
- **Never log passwords, session ids, tokens, keys, or card data.** *[OWASP
  CS: Logging]*
- **Baseline normal traffic and alert on deviation and on attempts against a
  known open vulnerability.** *[API Stronghold ch. 11; WebAppSec ch. 17]* See
  [Observability](../operations/observability-and-reliability.md).

## Dependencies and supply chain

- **Commit a lockfile pinning the whole tree and install from it.**
  *[WebAppSec ch. 27 (dated)]*
- **Scan the transitive tree on every change and on a schedule, with
  risk-based patch deadlines, from intended registries only.** *[OWASP Top
  10: A03, A08; WebAppSec ch. 27]* Pipelines: [CI/CD](../devops/ci-cd.md).
- **Merge dependency updates only on a green test suite; while an urgent
  patch is in review, add a compensating control (input limit, WAF rule, or
  feature switched off).** *[API Stronghold ch. 10]*

## Design, review, and vulnerability handling

- **Threat-model each feature before coding: how data travels, is stored, is
  presented, and is transformed.** *[WebAppSec ch. 17, 18; OWASP Top 10: A06]*
- **Harden framework defaults: no public DB listeners, version headers,
  sample apps, or `.git` in the web root.** *[WebAppSec ch. 19; OWASP Top 10:
  A02]*
- **Check that each new sibling endpoint (bulk, v2, admin) carries every
  control the original has.** *[WebAppSec ch. 4, 7; OWASP API Top 10: API9]*
- **Run SAST in CI with project rules (every endpoint imports the authz
  check) and DAST against staging.** *[WebAppSec ch. 20]*
- **Reproduce reports in staging, prefer one app-wide fix, and ticket any
  unfixed surface before closing.** *[WebAppSec ch. 21]*
- **Verify every "secure", "never throws", or "tenant-scoped" claim in a
  docstring or PR against the code.** *[Review lessons]*

## Tensions

- **bcrypt vs Argon2id.** WebAppSec recommends bcrypt. House position:
  Argon2id; bcrypt only for legacy, at cost 10+ with its 72-byte input cap
  enforced. *[WebAppSec ch. 18; OWASP CS: Password Storage]*
- **Host-allowlist CSP vs strict CSP.** House position: nonce- or hash-based
  with `strict-dynamic`, plus Trusted Types. *[WebAppSec ch. 22; OWASP CS:
  Content Security Policy]*
- **SameSite as the CSRF fix vs tokens.** House position: framework token or
  Fetch Metadata plus Origin. *[WebAppSec ch. 23; OWASP CS: CSRF Prevention]*
- **JWT vs server sessions.** House position: sessions for first-party web;
  short-lived JWTs plus refresh for APIs. *[OWASP CS: JSON Web Token; API
  Stronghold ch. 7]*
- **Review every dependency line vs patch fast.** House position: lockfile,
  SCA, tests, staged rollout. *[API Stronghold ch. 10; OWASP Top 10: A03]*
- **Random vs sequential ids.** House position: either; authorization is
  mandatory regardless. *[OWASP API Top 10: API1]*
- **Sanitize on input vs encode on output.** House position: validate at the
  boundary, store raw, encode per sink. *[WebAppSec ch. 7; OWASP CS: XSS
  Prevention; Review lessons]*

## Sources

- **WebAppSec**: Web Application Security: Exploitation and Countermeasures
  for Modern Web Applications (Andrew Hoffman, O'Reilly, 1st ed., 2020)
- **API Stronghold**: Securing the API Stronghold: The Ultimate Guide to API
  Security (Nordic APIs, 2015)
- **OWASP Top 10**: OWASP Top 10:2025, <https://top10.owasp.org/2025/>
- **OWASP API Top 10**: OWASP API Security Top 10 2023,
  <https://api-security.owasp.org/editions/2023/en/>
- **OWASP CS**: OWASP Cheat Sheet Series (cited by sheet name),
  <https://cheatsheetseries.owasp.org/>
- **OAuth BCP**: RFC 9700, Best Current Practice for OAuth 2.0 Security
  (IETF, 2025), <https://www.rfc-editor.org/rfc/rfc9700>
- **ASVS**: OWASP Application Security Verification Standard 5.0.0 (cited by
  chapter), <https://github.com/OWASP/ASVS/tree/master/5.0/en>
- **Review lessons**: rules distilled from the maintainer's code-review findings
