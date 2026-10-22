# Networking and IoT protocols

> **Load when:** writing or reviewing code that opens sockets or speaks a wire
> protocol (TCP or UDP framing, connection pools, timeouts, retries, DNS, TLS
> settings, proxies, NAT), building MQTT or other IoT device, broker, or
> consumer code, automating network devices (NETCONF, RESTCONF, gNMI, config
> templates), planning subnets, firewall rules, or security zones, or
> diagnosing connectivity, latency, or packet loss.
> **See also:** [Distributed systems](../distributed/distributed-systems.md),
> [Event-driven architecture and messaging](../architecture/event-driven-and-messaging.md),
> [Kubernetes](../devops/kubernetes.md),
> [Application and API security](../security/application-security.md),
> [HTTP and REST API design](../api/api-design.md),
> [Continuous integration and delivery](../devops/ci-cd.md),
> [Debugging](../core/debugging.md)

## Top rules

1. **Give every network call a connect timeout and a read timeout.** A dead
   peer or half-open connection otherwise hangs the caller forever; clients
   that carry a token also disable redirects.
   *[Mastering MQTT, Establishing an MQTT Connection; Review lessons]*
2. **Retry only with capped, randomized exponential backoff and a retry
   budget.** Premature or synchronized retries pile load onto a struggling peer
   until it collapses. *[Kurose-Ross ch. 3, 6]*
3. **Encrypt every hop that carries credentials or user data with TLS from a
   maintained library, internal traffic included, and verify certificate and
   hostname.** TCP, UDP, and plain MQTT are cleartext.
   *[Kurose-Ross ch. 2, 8; NetK8s ch. 1, 5; MQTT Essentials ch. 2]*
4. **Frame messages on TCP with a length prefix or delimiter.** TCP is a byte
   stream; one read can return half a message or three. *[Kurose-Ross ch. 3]*
5. **Make every at-least-once consumer idempotent and deduplicate by an
   application message id.** Retransmission creates duplicates by design.
   *[Kurose-Ross ch. 3; MQTT Essentials ch. 1; Mastering MQTT, QoS]*
6. **Never treat a source IP as identity; authenticate peers
   cryptographically.** Spoofing is trivial and NAT and proxies rewrite
   addresses. *[Kurose-Ross ch. 1, 8; NetK8s ch. 4]*
7. **Default-deny inbound and expose only ports with a documented need; scan
   your own hosts to prove it.** One exposed flawed service loses the host.
   *[Network Warrior ch. 27; Kurose-Ross ch. 3, 8; NetK8s ch. 2]*
8. **Parse every payload, port, URL, and config value at the boundary and
   reject bad input without crashing.** Sockets and brokers deliver any bytes.
   *[MQTT Essentials ch. 3; NPA ch. 5; Review lessons]*
9. **Honor DNS TTLs and re-resolve, and never use DNS round-robin as a load
   balancer.** A pinned or first-record address breaks failover.
   *[Kurose-Ross ch. 2; NetK8s ch. 5]*
10. **Change network config only through a reviewed, diffed, transactional
    path with a tested rollback.** Human error causes most network outages.
    *[NPA ch. 7, 10; Network Warrior ch. 39, 41]*

## Connections, latency, and capacity

- **Budget latency in round trips and reuse connections through pooling.** A
  fresh connection pays the TCP and TLS handshakes first; close idle pooled
  connections after a set timeout. *[Kurose-Ross ch. 2]*
- **Multiplex requests over one connection instead of opening parallel ones,
  and chunk large responses.** Parallel connections waste sockets and one big
  transfer must not block small ones. *[Kurose-Ross ch. 2, 3]*
- **Detect dead peers on long-lived connections with an application
  heartbeat.** A half-open TCP connection accepts writes into nothing.
  *[Mastering MQTT, Keep Alive]*
- **Keep sustained utilization well below saturation (plan WAN links for about
  75%) and size queues for a latency target, not zero loss.** Delay climbs
  steeply near capacity, and an undrained buffer adds latency forever.
  *[Kurose-Ross ch. 1, 4; Network Warrior ch. 32, 40]*
- **Find the bottleneck hop before tuning throughput.** Speeding up any other
  link changes nothing. *[Kurose-Ross ch. 1]*
- **Commit no per-connection state until the client proves its address, cap
  half-open state, and alert on conntrack fill.** Floods of half-open or
  short-lived connections are an easy denial of service.
  *[Kurose-Ross ch. 3; NetK8s ch. 2]*
- **Balance long-lived HTTP/2 or gRPC connections per request at L7.** An L4
  balancer spreads connections, so survivors of a rollout run hot.
  *[NetK8s ch. 4, 5]*
- **Ask what happens at 10k clients: jitter reconnects after a server or
  broker restart.** A fleet reconnecting in lockstep floods the service it just
  lost. *[Review lessons; Kurose-Ross ch. 6]*

## Retries, reliability, and flow control

- **Derive retry timeouts from measured latency (smoothed mean plus a multiple
  of its variation) and skip samples from retried requests.** A fixed timeout is
  too short or too slow. *[Kurose-Ross ch. 3]*
- **Cap retries per request and per client.** Work dropped at a later hop
  wastes all upstream capacity; see
  [Distributed systems](../distributed/distributed-systems.md).
  *[Kurose-Ross ch. 3]*
- **Prefer an existing reliable protocol (TCP, QUIC); if you must build one,
  use checksums, sequence numbers, acks, and timed retransmission.** Omitting
  any one leaves a failure nothing handles. *[Kurose-Ross ch. 3]*
- **Never reuse a message or sequence id while an old copy could still
  arrive.** Networks reorder and deliver stale packets late.
  *[Kurose-Ross ch. 3]*
- **Keep flow control (slow receiver) separate from congestion control (slow
  network) in code and naming.** *[Kurose-Ross ch. 3]*
- **Verify integrity and completeness at the endpoints even when lower layers
  check.** Per-hop checks are only performance aids. *[Kurose-Ross ch. 4]*
- **Enforce deduplication in durable storage with a unique constraint, not an
  in-process set.** A memory set forgets on restart and is not shared across
  replicas. *[Review lessons; Mastering MQTT, QoS]*

## Transport and protocol design

- **Choose a transport from written loss, throughput, timing, and security
  needs, and use UDP only for a concrete reason.** UDP needs your own rate
  adaptation and a TCP fallback, since many firewalls block it.
  *[Kurose-Ross ch. 2, 3; NetK8s ch. 1]*
- **Design time-sensitive features to adapt to bandwidth and delay.** The
  Internet guarantees neither; voice needs roughly 150 ms one way and well
  under 1% loss. *[Kurose-Ross ch. 2; Network Warrior ch. 30]*
- **Specify an application protocol fully: message types, syntax, semantics,
  units, and when each side sends.** Independent implementations interoperate
  only then. *[Kurose-Ross ch. 2; MQTT Essentials ch. 3]*
- **Plan protocol migrations as long coexistence (dual stack, version
  negotiation), never a flag day.** *[Kurose-Ross ch. 4]*
- **Keep packets within the path MTU and pass ICMPv4 type 3 code 4 and ICMPv6
  Packet Too Big (type 2).** IPv6 routers drop oversized packets instead of
  fragmenting.
  *[Kurose-Ross ch. 4, 5; Network Warrior ch. 25]*

## DNS, proxies, and NAT

- **Lower TTLs before a planned cutover and treat DNS as a critical,
  monitored dependency.** Resolvers serve old records until expiry, and DNS
  misconfiguration causes a large share of cluster incidents.
  *[Kurose-Ross ch. 2; NetK8s ch. 4]*
- **For hot external hosts called from pods, use fully qualified names
  (trailing dot) or enable CoreDNS autopath and scale its memory.** Short names
  walk every search domain first. *[NetK8s ch. 4]*
- **Assume NAT and middleboxes: no inbound reachability and no addresses in
  payloads.** *[Kurose-Ross ch. 4]*
- **Carry the client IP in X-Forwarded-For or the PROXY protocol and trust it
  only from known proxies.** Anyone can forge the header. *[NetK8s ch. 1, 4]*
- **Use session affinity only for cache locality, and survive losing the
  sticky target.** *[NetK8s ch. 2]*

## Transport security and credentials

- **Require TLS 1.3 where supported, with a TLS 1.2 floor limited to ECDHE
  plus AEAD suites, and no MD5 or SHA-1.** The sources' RSA key transport and
  CBC suites are superseded. *[Kurose-Ross ch. 8; MQTT Essentials ch. 2]*
- **Never disable certificate or SSH host-key verification outside a throwaway
  lab, and put the dialed name in the certificate SAN.** Clients check SANs, not
  the Common Name. *[NPA ch. 7; MQTT Essentials ch. 2, 3]*
- **Do not invent a secure channel or use a checksum for tamper detection.**
  Hand-built channels miss sequence-numbered MACs, authenticated close, and
  fresh nonces; use keyed MACs or signatures. *[Kurose-Ross ch. 8]*
- **Pull credentials from a secret store at run time; write any secret file
  0600 under a unique temp name.** Never in source or plain data files.
  *[NPA ch. 9; Review lessons]*
- **Keep a private CA key off deployed hosts, and plan provisioning, renewal,
  and revocation before choosing per-device certificates.** Without a CRL a
  stolen certificate works until expiry. *[MQTT Essentials ch. 2]*
- **Use a public CA for Internet- or browser-reachable endpoints; a private CA
  only for closed fleets.** *[MQTT Essentials ch. 2, 5]*

## Firewalls, segmentation, and exposure

- **Define each zone by which zones may open connections to it, and keep
  databases off the Internet-facing tier.** The DMZ may not reach inside.
  *[Network Warrior ch. 27, 35; Kurose-Ross ch. 8]*
- **Authenticate service-to-service calls inside the perimeter too (mTLS or
  tokens), not only at the firewall.** Pod networks allow everything by
  default; see [Kubernetes](../devops/kubernetes.md) for NetworkPolicy.
  *[NetK8s ch. 4; Kurose-Ross ch. 8]*
- **Put partner links outside the firewall, and block host-to-host traffic on
  management networks except to backup and telemetry servers.** A flat
  management VLAN undoes tier isolation. *[Network Warrior ch. 27, 35]*
- **Bind local-only services to loopback, and never answer `*` CORS on a
  stateful endpoint, even on localhost.** *[Review lessons]*
- **Keep rule sets small, named by purpose and direction, built from named
  groups, and audited for shadowed entries.** First-match lists hide dead rules.
  *[Network Warrior ch. 25, 27]*
- **Allow return traffic and the ICMP types ping, traceroute, and path-MTU
  discovery need.** A handshake fails if the reply cannot route back.
  *[NetK8s ch. 4; Network Warrior ch. 25]*
- **Keep network tools out of production images; use an ephemeral debug
  container.** They help an intruder explore. *[NetK8s ch. 2]*

## MQTT and IoT: connections and sessions

- **Choose MQTT over HTTP polling for many constrained devices on unreliable
  or metered links.** *[MQTT Essentials ch. 1; Mastering MQTT, What is MQTT]*
- **Check that broker and client library support every feature you rely on,
  and pin the protocol version (prefer MQTT 5).** Partial implementations drop
  QoS 2, sessions, or wills silently. *[MQTT Essentials ch. 1, 3]*
- **Give each client a stable, fleet-unique Client ID of `[0-9a-zA-Z]`, at most
  23 bytes.** A duplicate evicts the other client.
  *[MQTT Essentials ch. 1; Mastering MQTT, Establishing an MQTT Connection]*
- **Treat the connection as up only after CONNACK, and surface each refusal
  code separately.** *[MQTT Essentials ch. 1; Mastering MQTT, Establishing an
  MQTT Connection]*
- **Set a non-zero Keep Alive, honor MQTT 5 Server Keep Alive, and reconnect
  when PINGRESP is missing.** Brokers declare a client dead after about 1.5
  intervals, which (plus any MQTT 5 Will Delay Interval) times its will.
  *[Mastering MQTT, Keep Alive]*
- **Subscribe in the on-connect callback, read Session Present, and check each
  SUBACK's granted QoS.** Otherwise a reconnect silently receives nothing.
  *[MQTT Essentials ch. 1, 3; Mastering MQTT, Persistent Session]*
- **Size Session Expiry to the expected offline time, never "forever", and
  persist in-flight QoS 1/2 state durably.** Broker queues are capped and drop
  QoS 0. *[Mastering MQTT, Persistent Session; MQTT Essentials ch. 4]*
- **Keep message handlers short and non-blocking.** Some clients ack only
  after the handler returns, so slow work triggers redelivery.
  *[MQTT Essentials ch. 4]*
- **Register callbacks and TLS before connect, and run exactly one
  network-loop strategy per client.** *[MQTT Essentials ch. 3, 4]*

## MQTT: delivery and QoS

- **Never treat a publish or PUBACK as proof a subscriber got the message.**
  For confirmation, use MQTT 5 Response Topic and Correlation Data, and
  subscribe to the reply before sending the request.
  *[MQTT Essentials ch. 1, 3; Mastering MQTT, Publish-Subscribe Pattern]*
- **Choose QoS per flow: 0 for loss-tolerant telemetry, 1 with idempotent
  handlers for commands and state, 2 rarely.** Delivered QoS is the lower of
  publish and subscription QoS. *[MQTT Essentials ch. 1; Mastering MQTT, QoS]*
- **Deduplicate with a per-publisher counter or unique id, never a timestamp
  or the DUP flag, and send "set to X" rather than toggles.**
  *[Mastering MQTT, QoS]*
- **Do not document delivery as "exactly once" end to end.** QoS 2 holds per
  hop while both sides keep session state; docstrings must match the code.
  *[MQTT Essentials ch. 1; Review lessons]*
- **Retain only current-state topics, and set MQTT 5 message expiry on
  commands.** A retained command replays a stale action to every new
  subscriber. *[MQTT Essentials ch. 1, 4; Mastering MQTT, Persistent Session]*
- **Track presence with a retained "online" and a retained "offline" will on
  one topic, publishing "offline" yourself before a clean disconnect.** A clean
  DISCONNECT discards the will.
  *[MQTT Essentials ch. 4; Mastering MQTT, Will Message]*
- **Load-balance consumers with `$share/<group>/...` and avoid overlapping
  subscriptions on one client.** Overlaps deliver one copy per match.
  *[Mastering MQTT, MQTT Topics and Wildcards]*

## MQTT: topics and payloads

- **Use one `/` hierarchy with the same level order and casing for every
  device of a kind, in plain ASCII with no leading slash or `$`.**
  *[MQTT Essentials ch. 1; Mastering MQTT, MQTT Topics]*
- **Keep levels few, name logical entities rather than hosts, and put
  variants always consumed together in the payload.**
  *[Mastering MQTT, MQTT Topics; MQTT Essentials ch. 5]*
- **Subscribe with the narrowest valid filter and never `#` in production.**
  Escape topic segments before building a `RegExp` matcher.
  *[MQTT Essentials ch. 1; Mastering MQTT, MQTT Wildcards; Review lessons]*
- **Document payload schema, command vocabulary, and units beside the topic
  tree; in the handler, route on the received topic and dispatch from a lookup
  table that rejects unknown commands.** *[MQTT Essentials ch. 1, 3]*
- **Write payload timestamps through the project's one date helper, in UTC
  with an explicit zone.** *[Review lessons]*

## MQTT: broker security

- **Disable anonymous access and grant publish and subscribe rights per topic,
  scoped by tenant.** A stray publisher on an actuator topic can cause physical
  harm. *[MQTT Essentials ch. 2; Mastering MQTT, Establishing an MQTT
  Connection; Review lessons]*
- **Use 8883 and `wss://` in production, never plaintext 1883 or `ws://`.**
  Topic names carry device identity. *[MQTT Essentials ch. 2, 5, 6]*
- **Secure and audit every listener separately.** A new listener inherits no
  TLS settings. *[MQTT Essentials ch. 5, 6]*
- **Pair server TLS with client auth: mutual TLS where identity must be
  cryptographic, tokens for browsers.** *[Mastering MQTT, Establishing an MQTT
  Connection]*
- **Cap connections and subscribers on public brokers and ACL-protect `$SYS`.**
  *[MQTT Essentials ch. 2; Mastering MQTT, MQTT Topics]*

## Network automation and configuration as code

- **Document the manual workflow first, and start with read-only jobs.**
  *[NPA ch. 2]*
- **Use structured device APIs (NETCONF, RESTCONF, gNMI), not screen-scraping,
  and test each on every platform and OS version.** *[NPA ch. 2, 7]*
- **Apply changes transactionally: candidate, validate, commit.** One-at-a-time
  commands leave partial config. *[NPA ch. 2, 7; Kurose-Ross ch. 5]*
- **Choose merge or replace on purpose, scoping replace to subtrees you
  own.** A misplaced replace wipes unrelated config. *[NPA ch. 7, 10]*
- **Review a dry-run diff before commit, and make tasks idempotent.** A second
  run must report zero changes. *[NPA ch. 9, App. B]*
- **Keep data in a source of truth, syntax in templates, and logic out of
  templates.** *[NPA ch. 2, 6]*
- **Validate config data against a schema, load YAML safely, and validate
  inventory values as identifiers before putting them in shell or CLI.**
  *[NPA ch. 5; Review lessons]*
- **Route every change through branch, CI checks, peer review, and a lab run
  with the production tool, then roll out to a subset first.**
  See [Continuous integration and delivery](../devops/ci-cd.md).
  *[NPA ch. 9, 10]*
- **Arm an automatic rollback before a remote change, and check app-level
  health afterwards.** Reverting Git does not revert devices.
  *[Network Warrior ch. 18, 39; NPA ch. 10]*

## Addressing, time, and device hygiene

- **Number networks from private or owned space, with non-overlapping CIDRs
  for every network you may peer.** *[Network Warrior ch. 36; NetK8s ch. 4]*
- **Sync time with NTPv4 (NTS where supported) from four or more upstream
  pool names through a peered internal pair.** *[Network Warrior ch. 38]*
- **Configure link ends identically and set spanning-tree roots and redundancy
  priorities explicitly.** *[Network Warrior ch. 3, 8, 13]*

## Troubleshooting and change safety

- **Debug layer by layer: physical and L3, DNS, port, listener, TLS, app.**
  *[NetK8s ch. 2; Network Warrior ch. 39]*
- **Ask what changed, log each action with a timestamp, and prove every "it
  can't be X".** *[Network Warrior ch. 39]*
- **Monitor standbys and test failover on a schedule.**
  *[Network Warrior ch. 28, 39]*
- **After fixing a missing timeout or disabled verification, grep for siblings
  and fix them together.** *[Review lessons]*

## Tensions

- **QoS 2 vs QoS 1 with idempotent handlers.** Use QoS 1 plus an application
  command id; QoS 2 wins only when a handler cannot be idempotent and both ends
  keep durable session state. *[MQTT Essentials ch. 1; Mastering MQTT, QoS]*
- **Purpose-first vs identity-first topics.** Put tenant and device first so
  ACLs and wildcards match one subtree; purpose-first suits small single-tenant
  fleets. *[MQTT Essentials ch. 4; Mastering MQTT, MQTT Topics]*
- **Replace vs merge.** Merge by default; replace wins on subtrees the
  pipeline fully owns, where it removes drift. *[NPA ch. 7, 10]*
- **Pipeline-only vs outage access.** Pipeline only, plus a documented
  break-glass for outages, reconciled into source of truth. *[NPA ch. 10, 11]*
- **Perimeter vs zero trust.** Keep firewall rules and authenticate inside
  traffic too. *[Kurose-Ross ch. 8; Network Warrior ch. 27; NetK8s ch. 4]*
- **Client certificates vs per-device tokens.** Tokens from a provisioning
  service by default; certificates win for high-assurance fleets with
  automated rotation and revocation. *[MQTT Essentials ch. 2]*
- **Dated sources.** The books show TLS 1.2-era ciphers, the wrong PMTUD ICMP
  types, NTPv3, MQTT 3.1.1 only, and disabled verification in examples; the
  rules above state current practice instead.
  *[Kurose-Ross ch. 8; Network Warrior ch. 25, 38; NPA ch. 7]*

## Sources

- **Kurose-Ross**: Computer Networking: A Top-Down Approach (James F. Kurose,
  Keith W. Ross, 8th ed.)
- **Network Warrior**: Network Warrior (Gary A. Donahue, 2nd ed.)
- **NPA**: Network Programmability and Automation (Jason Edelman, Scott S.
  Lowe, Matt Oswalt, 1st ed.)
- **NetK8s**: Networking and Kubernetes: A Layered Approach (James Strong,
  Vallery Lancey, 1st ed.)
- **MQTT Essentials**: MQTT Essentials: A Lightweight IoT Protocol (Gastón C.
  Hillar, 1st ed.)
- **Mastering MQTT**: Mastering MQTT: Your Ultimate Tutorial for MQTT (EMQ
  eBook)
- **Review lessons**: rules distilled from the maintainer's code-review
  findings
