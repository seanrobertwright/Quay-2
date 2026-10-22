# HTTP and REST API design

> **Load when:** designing, implementing, or reviewing an HTTP API, REST
> resource, route handler, or controller endpoint; choosing URIs, methods,
> status codes, headers, error bodies, pagination, filtering, or versioning;
> writing an OpenAPI or JSON Schema contract; changing a published API; adding
> rate limits, webhooks, or streaming; or choosing REST, RPC, GraphQL, or push.
> **See also:** [Application and API security](../security/application-security.md),
> [Microservices](../architecture/microservices.md),
> [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md),
> [Distributed systems](../distributed/distributed-systems.md),
> [Caching and Redis](../data/caching-and-redis.md),
> [SQL and query performance](../data/sql-and-query-performance.md),
> [Testing](../testing/testing.md),
> [Observability and reliability](../operations/observability-and-reliability.md)

## Top rules

1. **Treat a published API as a contract: change it only additively, and
   reserve a new major version for a genuinely breaking change.** Clients
   hardcode paths, fields, and error codes.
   *[Undisturbed REST ch. 2, 3; Hands-On REST ch. 2, 4; DWA ch. 7]*
2. **Name resources with nouns and let the HTTP method carry the action.**
   `DELETE /users/{id}`, never `/deleteUser?id=`; a verb in the path is only
   for a controller action that maps to no CRUD method.
   *[REST Rulebook ch. 2; Undisturbed REST ch. 7; Hands-On REST ch. 2; DWA ch. 2]*
3. **Use each method for its defined meaning: GET and HEAD never change
   state, PUT replaces, PATCH partially updates, POST creates or runs a
   controller, DELETE removes, and no method is tunneled through another.**
   Caches, proxies, and retry logic rely on those semantics.
   *[REST Rulebook ch. 3; Undisturbed REST ch. 8; Hands-On REST ch. 2, 4; DWA ch. 2]*
4. **Return the most specific correct status code, and never 200 with an
   error in the body.** Clients, retries, and alerting branch on the status
   line. *[REST Rulebook ch. 3; Hands-On REST ch. 2; Undisturbed REST ch. 9]*
5. **Return every error in one machine-readable shape (RFC 9457 Problem
   Details) with a stable error code and an actionable message.** Clients
   branch on the code and never parse message text.
   *[REST Rulebook ch. 5; Undisturbed REST ch. 9; Hands-On REST ch. 2; DWA ch. 4]*
6. **Parse and validate every request part at the handler boundary against a
   schema, and reject bad input with a 4xx before doing any work.** Reject NaN,
   empty strings, malformed ids, and out-of-range values with a clear message.
   *[Hands-On REST ch. 8; DWA ch. 4, 7; Review lessons]*
7. **Put the tenant column in the WHERE clause of every query, update, and
   delete on owned data, and authorize per object and per returned field, not
   only per action.** A globally unique id in the path is attacker-controlled
   input, not proof of ownership. *[Hands-On REST ch. 4, 6; Review lessons]*
8. **Paginate every list endpoint from the first release, with a documented
   default and maximum page size.** Lists that start small grow without bound.
   *[REST Rulebook ch. 2; Hands-On REST ch. 3; DWA ch. 6; Review lessons]*
9. **Make retries safe: PUT and DELETE are idempotent, and non-idempotent
   creates accept an idempotency key enforced by a unique constraint.** A
   client retrying after a lost response must not charge a customer twice.
   *[Hands-On REST ch. 4, 8; REST Rulebook ch. 3; Review lessons]*
10. **Write the contract in OpenAPI before the implementation, and fail CI
    when responses drift from it.** Docs, mocks, SDKs, and validation all
    derive from one source. *[Undisturbed REST ch. 3; Hands-On REST ch. 9; DWA ch. 5, 7]*

## Resources and URIs

- **Model resources before URIs, and give each one archetype: document,
  collection, store, or controller.** A resource mixing two archetypes leaves
  clients unsure which methods apply; split it.
  *[REST Rulebook ch. 2; Hands-On REST ch. 2]*
- **Use plural nouns for collections and stores, singular for a document,
  and a verb only for a controller, placed last in the path.** Offer singular
  only when multiples are truly impossible, and never both forms.
  *[REST Rulebook ch. 2; Undisturbed REST ch. 7; Hands-On REST ch. 2]*
- **List the actions consumers need, grouped by domain object, before
  drawing URIs, and reject any endpoint that mirrors one table or internal
  service one-to-one.** Endpoints that mirror internal systems leak
  implementation and block backend change.
  *[Undisturbed REST ch. 2; Hands-On REST ch. 2, 3; DWA ch. 4]*
- **Write paths in lowercase with hyphens, no underscores, no trailing slash,
  and no file extensions.** Paths are case-sensitive; format belongs in
  `Accept` and `Content-Type`. Redirect non-canonical forms with 301 or 308
  instead of serving duplicates. *[REST Rulebook ch. 2; Hands-On REST ch. 2]*
- **Use one name, one type, and one identifier form per concept everywhere.**
  Not `users` here and `members` there, not an integer id in one response and
  an object in another. When extending an API, follow its existing names.
  *[Hands-On REST ch. 2; DWA ch. 4, 7]*

## Methods and idempotency

- **Use POST to a collection when the server picks the new URI, and PUT when
  the client names it.** Prefer an error over PUT-creates-if-missing; if you
  allow it, return 201 and do it the same way everywhere.
  *[REST Rulebook ch. 3; Undisturbed REST ch. 8]*
- **Never use PUT for a partial update; use PATCH with JSON Merge Patch or
  JSON Patch.** PUT clears omitted fields. (Updated: the Rulebook predates
  PATCH.) *[Undisturbed REST ch. 8; DWA ch. 2; REST Rulebook ch. 3]*
- **Make DELETE really remove the resource, so a later GET returns 404.**
  Return 204, 200 with a result body, or 202 when queued. Model soft delete
  as a controller POST or a state field. *[REST Rulebook ch. 3; Undisturbed REST ch. 8; DWA ch. 2]*
- **Accept an `Idempotency-Key` header on POST creates and other unsafe
  controllers, store the result under it, and replay it on retry.** Enforce
  the key with a tenant-scoped unique index so concurrent retries cannot both
  succeed. Treat PATCH as non-idempotent unless the patch format makes it so.
  (Updated: Hands-On REST wrongly calls PATCH idempotent; the header's IETF
  draft expired, but it is the de facto convention.) *[Hands-On REST ch. 4, 8; Review lessons]*
- **Disallow or tightly restrict PUT, PATCH, and DELETE on whole
  collections.** One mistaken call can wipe every record; expose bulk changes
  as an explicit batch resource with per-item results.
  *[Undisturbed REST ch. 8; Hands-On REST ch. 4]*
- **Answer OPTIONS with `Allow`, return 405 with `Allow` for any unsupported
  method, and never dispatch unknown methods to a handler.**
  *[REST Rulebook ch. 3; Undisturbed REST ch. 8; Hands-On REST ch. 2, 8]*

## Status codes

- **201 plus `Location` for a create; 202 plus `Location` to a pollable status
  resource for long-running work; 204 for an intentionally empty body.**
  *[REST Rulebook ch. 3, 4; Hands-On REST ch. 2; Undisturbed REST ch. 8]*
- **401 when credentials are missing or invalid (with `WWW-Authenticate`),
  403 when the caller is known but not permitted.** Return 404 instead of 403
  when revealing that the resource exists would leak information.
  *[REST Rulebook ch. 3; Hands-On REST ch. 2]*
- **404 unknown resource, 405 wrong method, 406 no acceptable representation,
  415 unsupported request body type.** Each tells the client which part of the
  request to fix. *[REST Rulebook ch. 3; Hands-On REST ch. 2; Undisturbed REST ch. 7]*
- **409 for a state conflict, 412 for a failed `If-Match`, 422 for a
  well-formed body that fails semantic validation, 428 when a required
  precondition is missing, 429 with `Retry-After` for rate limits.**
  (Updated: 422, 428, and 429 postdate the Rulebook.)
  *[REST Rulebook ch. 3; Undisturbed REST ch. 9; DWA ch. 6]*
- **Use 400 only when no more specific 4xx fits, and 5xx only for real server
  faults.** An unknown id is 404, never 500; a validation failure is never 5xx.
  *[REST Rulebook ch. 3; Hands-On REST ch. 3]*
- **Redirect with 303 to a result, 307 or 308 to keep the method, and 301 for
  a permanent move; avoid 302.** *[REST Rulebook ch. 3; Hands-On REST ch. 2, 4]*

## Request parsing and validation

- **Validate path, query, headers, and body against the declared schema with
  one shared library that also formats the error.** Reject before any side
  effect, and log rejections; repeated failures are an attack signal.
  *[Hands-On REST ch. 8; DWA ch. 4, 7]*
- **Never convert query or path values with a bare numeric cast.** Parse with
  a function that rejects NaN, empty strings, fractional or negative counts,
  and values above the cap, and return 400 naming the parameter.
  *[Review lessons]*
- **Validate ids as the expected format (for example UUID) before a query,
  escape any id used in a regular expression, and test key presence on plain
  request objects with an own-property check, not `in`.** *[Review lessons]*
- **Reject a body whose `Content-Type` is unsupported (415) or does not match
  its content, and cap payload size and nesting depth at the edge.**
  *[Hands-On REST ch. 2, 8; Undisturbed REST ch. 7, 11]*
- **Parse every date in a request through the project's single date helper,
  and treat a timezone-less timestamp as UTC or reject it.** Never interpret
  one in server-local time. *[Review lessons]*

## Errors

- **Serve errors as `application/problem+json` (RFC 9457) with `type`,
  `title`, `status`, `detail`, and a stable machine code as an extension
  member.** (Updated: replaces RFC 7807, WRML, vnd.error, and bespoke shapes.)
  *[REST Rulebook ch. 5; Undisturbed REST ch. 9; DWA ch. 4]*
- **Make codes narrow and messages actionable**: `token_revoked` or
  `charge_already_refunded` rather than `invalid_auth`, and say how to fix it,
  with a link to the docs. Return all validation failures at once, keyed by
  field; on a scope failure, name the scope required and the scopes held.
  *[Undisturbed REST ch. 9; DWA ch. 3, 4]*
- **Never leak internals (stack traces, SQL errors, hostnames); wrap
  dependency failures in one consistent retryable error.** Log the detail
  server-side under a correlation id that the error body echoes.
  *[DWA ch. 4; Hands-On REST ch. 9]*

## Collections: pagination, filtering, sorting, bulk

- **Put filtering, sorting, and pagination in the query string, never in the
  path or in identity.** `/stocks?cursor=...`, not `/stocks/page/2`.
  *[REST Rulebook ch. 2; Hands-On REST ch. 2, 3]*
- **Use opaque cursor (keyset) pagination on a unique, indexed sort key for
  large or changing collections.** Offset paging skips or repeats rows under
  writes and slows on deep pages; keep it for shallow, static lists.
  *[DWA ch. 6; Hands-On REST ch. 3]*
- **Return a next cursor or next link, with null meaning the end, and never
  put sensitive data in a cursor.** Clients can decode it.
  *[DWA ch. 6; Undisturbed REST ch. 10]*
- **Make the sort order total (append the id as a tiebreaker), and make the
  documented order match the query exactly.** A doc that says "newest first"
  must match the `ORDER BY`. Add the index each filter and sort needs, and
  ask what the endpoint does at 10k rows. *[DWA ch. 6; Review lessons]*
- **Use one parameter convention on every collection**: one `sort` taking a
  comma-separated field list with direction, and one operator syntax for range
  filters. Move criteria that outgrow the query string to the `QUERY` method
  where your framework, gateway, and clients support it; otherwise use a POST
  search controller, documented as safe, with explicit cache headers.
  (Updated: `QUERY`, a safe, cacheable method with a body, is RFC 10008.)
  *[Hands-On REST ch. 2, 8; Undisturbed REST ch. 3; REST Rulebook ch. 2]*
- **Offer bulk-fetch by id list and batch endpoints for operations clients
  repeat per item.** This removes N+1 fan-out from clients and composite
  services. *[Hands-On REST ch. 4, 7; DWA ch. 6]*
- **Let clients trim responses with a `fields` parameter and inline related
  resources with an `embed` parameter** rather than adding endpoints per
  screen. *[REST Rulebook ch. 6; Hands-On REST ch. 2; DWA ch. 6]*

## Headers, caching, and concurrency

- **Label every response's cacheability with `Cache-Control`**: a short
  `max-age` for hot reads, `private` for per-user data, `no-store` for
  sensitive data, and `Vary` on any header that changes the representation.
  (Updated: drop `Expires` and `Pragma`; `no-cache` means revalidate, not
  "do not store".) *[REST Rulebook ch. 4; Undisturbed REST ch. 7; Hands-On REST ch. 1, 6]*
- **Send an `ETag` derived from the representation (never host-local data)
  and honor `If-None-Match` with 304.** *[REST Rulebook ch. 4; Hands-On REST ch. 2]*
- **Require `If-Match` on updates to shared resources: 412 on mismatch, 428
  when missing.** Without it, two clients silently overwrite each other.
  *[REST Rulebook ch. 4; Hands-On REST ch. 2]*
- **Never let a custom header change a method's meaning or be required to
  interpret a request,** and do not use the deprecated `X-` prefix.
  *[REST Rulebook ch. 4; Hands-On REST ch. 2]*
- **Always send an accurate `Content-Type` (UTF-8 charset for text), and set
  `X-Content-Type-Options: nosniff`, above all on binary and download routes.**
  *[REST Rulebook ch. 4; Hands-On REST ch. 2, 3; Review lessons]*

## Representations and media types

- **Return the resource directly as strict JSON, with no envelope that repeats
  status or headers.** A collection object holding `data` plus paging links
  is fine. *[REST Rulebook ch. 5; Hands-On REST ch. 2]*
- **Pick one field-name case for the whole API, send numbers as numbers, and
  emit every declared field from the first release, null when empty.** Making
  a sometimes-missing field always present later breaks clients that test for
  the key. *[REST Rulebook ch. 5; DWA ch. 7]*
- **Encode instants as RFC 3339 strings in UTC with an explicit offset, and
  calendar dates as `YYYY-MM-DD` with the zone they belong to documented.**
  *[REST Rulebook ch. 5; Review lessons]*
- **If you add hypermedia, use an established format (HAL, JSON:API), include
  a `self` link, and advertise only actions valid in the current state.**
  *[REST Rulebook ch. 5; Undisturbed REST ch. 10; Hands-On REST ch. 1, 2]*

## Versioning and evolution

- **Ship additive changes in place without a version bump**: new endpoints,
  optional fields, and optional parameters. Expose no minor versions.
  *[Undisturbed REST ch. 3, 7; Hands-On REST ch. 2, 4; DWA ch. 7]*
- **Count as breaking any removal, rename, type change, behaviour change,
  new required input, or change to error codes or rate limits.**
  *[DWA ch. 6, 7; Hands-On REST ch. 4]*
- **Choose one versioning mechanism per organization, build it in on day one
  if breaking changes are likely, and reject unsupported versions clearly.**
  Send `Vary` when the version travels in a header.
  *[Hands-On REST ch. 4; DWA ch. 4, 7]*
- **Deprecate with targeted notice from usage logs, a published minimum
  support period, and `Deprecation` and `Sunset` response headers.**
  (Updated: DWA predates both: `Deprecation` is RFC 9745, `Sunset` is RFC
  8594, and sunset must not precede deprecation.) *[DWA ch. 7]*

## Contract, documentation, and tests

- **Design contract-first in OpenAPI 3.1 or later (3.2 is current; both use
  JSON Schema 2020-12), have real consumers use a mock, and fix the spec
  before patching the code.** Define pagination, errors, and common
  parameters once as shared components. (Updated: RAML, Swagger 2, and JSON
  Schema draft-04 are superseded.) *[Undisturbed REST ch. 3, 4, 5; Hands-On REST ch. 9; DWA ch. 5]*
- **Validate every response in CI against strict schemas with no undeclared
  properties, require review for any change to API output, and check that
  each touched spec sentence (ordering, nullability, limits) matches the
  code.** *[DWA ch. 7; Review lessons]*
- **Test negative paths as thoroughly as happy paths**: wrong credentials,
  another tenant's ids, bad parameters, boundaries. Assert status and side
  effects, and read back state after writes.
  *[Hands-On REST ch. 6; Review lessons]*
- **When you fix a handler defect, grep every sibling route for the same
  pattern and fix them in the same change.** *[Review lessons]*
- **Document each endpoint with parameters, sample request and response,
  status codes, errors, and required scope, generated from the spec; aim for
  a first successful call within five minutes, with a sandbox.**
  *[Undisturbed REST ch. 12; DWA ch. 4, 9; Hands-On REST ch. 2]*

## Access control and abuse protection at the API surface

Full coverage lives in [Application and API security](../security/application-security.md);
these are the rules an endpoint author must apply directly.

- **Use OAuth 2.x with authorization code plus PKCE; never accept user
  passwords through a public API or hand-roll an auth scheme.** Send tokens in
  `Authorization`, never in the URL. Check token validity and scope on every
  request, and issue short-lived access tokens with rotating refresh tokens.
  (Updated: RFC 9700 forbids the password grant and steers clients off the
  implicit grant, both shown in the books; the OAuth 2.1 draft drops them.)
  *[Undisturbed REST ch. 6; DWA ch. 3; Hands-On REST ch. 4]*
- **Scope CORS to named origins on the endpoints that need it; never `*` on
  an endpoint that reads or writes state.** Never implement JSONP.
  *[Undisturbed REST ch. 11; REST Rulebook ch. 6; Review lessons]*
- **Rate-limit per app or user (per IP when anonymous), with tighter limits
  on expensive endpoints, and report limit, remaining, and reset.** Dark-launch
  new limits and start low. Send `Retry-After` on every 429; the IETF
  `RateLimit` fields are still a draft. *[DWA ch. 6; Undisturbed REST ch. 11]*
- **Give outbound HTTP clients that carry a token a timeout, and disable
  redirect following.** *[Review lessons]*

## Webhooks, push, and streaming

- **Sign webhook bodies with an HMAC under a rotatable per-app secret plus a
  timestamp, and verify with a constant-time compare and a short tolerance.**
  (Updated: DWA omits the timing-safe compare.) *[DWA ch. 3]*
- **Prefer thin webhook payloads (event id and type) and never send secrets
  in them.** The receiver fetches details through the authenticated API.
  *[DWA ch. 3]*
- **Retry delivery with exponential backoff, include an event id for receiver
  dedup, and auto-disable persistently failing endpoints with notice.**
  *[DWA ch. 2, 6]*

## Choosing a paradigm

- **Pick REST for resource CRUD, RPC for many actions that fit no single
  resource, GraphQL for flexible client querying, and events for change
  notification; record what you rejected.** Offer push when clients poll;
  add query cost and depth limits before exposing GraphQL externally.
  *[DWA ch. 2, 6]*
- **Add a backend-for-frontend or facade only when client types truly
  differ**; otherwise it is duplicated surface. *[Hands-On REST ch. 4]*

## Tensions

- **Version in the URI vs in the media type or a header.** The Rulebook
  rejects `/v1/`; Undisturbed REST and most public APIs use it; DWA endorses
  dated, account-pinned versions. House position: a major version in the
  path for most APIs, a dated header for long-lived public platforms, one
  mechanism per organization, and additive change in between.
  *[REST Rulebook ch. 6; Undisturbed REST ch. 7; Hands-On REST ch. 4; DWA ch. 7]*
- **Full HATEOAS vs documented endpoints.** The Rulebook and Hands-On REST
  treat hypermedia as essential; Undisturbed REST admits clients hardcode
  paths. House position: document endpoints in OpenAPI, and add `self`,
  pagination, and state-sensitive action links where they pay off.
  *[REST Rulebook ch. 5; Undisturbed REST ch. 10; Hands-On REST ch. 1]*
- **Offset vs cursor pagination.** The Rulebook and Hands-On REST show offset.
  House position: cursor by default; offset only for shallow static lists.
  *[REST Rulebook ch. 2; Hands-On REST ch. 3; DWA ch. 6]*
- **Honor `Accept` vs echo the request format.** House position: honor it and
  return 406. *[Undisturbed REST ch. 7; REST Rulebook ch. 4]*
- **Open CORS vs CORS off by default.** House position: off until needed,
  then named origins only on named endpoints.
  *[Undisturbed REST ch. 11; REST Rulebook ch. 6; Review lessons]*
- **Immutable spec vs iterative spec.** Undisturbed REST forbids changing the
  spec once coding starts. House position: the spec stays the source of truth
  and changes through review, enforced by contract tests in CI.
  *[Undisturbed REST ch. 3; DWA ch. 7]*

## Sources

- **REST Rulebook**: REST API Design Rulebook (Mark Masse, O'Reilly, 1st ed.)
- **Undisturbed REST**: Undisturbed REST: A Guide to Designing the Perfect API
  (Michael Stowe, MuleSoft, first-look edition)
- **Hands-On REST**: Hands-On RESTful API Design Patterns and Best Practices
  (Harihara Subramanian, Pethuru Raj, Packt, 1st ed.)
- **DWA**: Designing Web APIs: Building APIs That Developers Love (Brenda Jin,
  Saurabh Sahni, Amir Shevat, O'Reilly, 1st ed.)
- **Review lessons**: rules distilled from the maintainer's code-review findings
