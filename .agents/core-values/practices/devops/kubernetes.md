# Kubernetes

> **Load when:** writing or reviewing Kubernetes manifests, Helm charts, or
> Kustomize overlays (Deployments, StatefulSets, Jobs, CronJobs, DaemonSets,
> Services, Ingress or Gateway API routes, NetworkPolicies, RBAC, ConfigMaps,
> Secrets); adding probes, resource requests, autoscaling, or graceful shutdown
> to a service that runs on Kubernetes; writing a controller, operator, or
> admission policy; choosing, securing, or upgrading a cluster; or debugging
> pods that will not start, keep restarting, or receive no traffic.
> **See also:** [Containers and Docker](containers.md),
> [Continuous integration and delivery](ci-cd.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Cloud architecture](../cloud/cloud-architecture.md),
> [Application and API security](../security/application-security.md),
> [Networking](../systems/networking.md),
> [Microservices](../architecture/microservices.md),
> [Database operations](../data/database-operations.md),
> [Distributed systems](../distributed/distributed-systems.md),
> [Debugging](../core/debugging.md)

## Top rules

1. **Give every container CPU and memory requests, and set the memory limit
   equal to the memory request.** Without requests a Pod is BestEffort and is
   evicted first; see Tensions for CPU limits. *[K8s Patterns ch. 2; K8sBP ch. 1]*
2. **Put a readiness probe on every serving container and keep liveness
   local.** Readiness reflects whether the Pod can do its real job; liveness
   checks only the container itself, never a dependency; slow starters get a
   startup probe. *[K8s Patterns ch. 4; K8sIA2 ch. 6, 11; NetK8s ch. 4]*
3. **Handle SIGTERM: stop taking work, finish in-flight requests, exit inside
   the grace period.** Use exec-form `ENTRYPOINT` so the app is PID 1 and gets
   the signal. *[K8s Patterns ch. 5; K8sIA2 ch. 6; K8sBP ch. 5]*
4. **Deploy only declaratively from version control through CI/CD, with an
   immutable tag or digest traced to the commit.** Ad hoc `kubectl apply`
   drifts; `latest` makes rollback meaningless and flips pull policy to
   `Always`. Promote one image through every environment.
   *[K8sBP ch. 1, 5; K8sIA2 ch. 5, 6, 9; CNDK8s ch. 2]*
5. **Run every Pod with a restricted security context.** `runAsNonRoot`,
   `allowPrivilegeEscalation: false`, drop ALL capabilities, read-only root
   filesystem, seccomp `RuntimeDefault`, never `privileged` for apps.
   *[K8s Patterns ch. 23; K8sIA2 ch. 16]*
6. **Never commit plain Secrets or bake credentials into images, and never
   treat a Secret as encrypted.** Enable encryption at rest, grant `get` only
   on named Secrets, and remember Pod-creation rights expose every Secret in
   the namespace. *[K8s Patterns ch. 20, 25, 26; K8sBP ch. 1, 4; K8sIA2 ch. 9]*
7. **Start every namespace with a default-deny NetworkPolicy and allow flows
   by label.** The pod network is allow-all, and a CNI that does not enforce
   policy ignores it silently. *[K8s Patterns ch. 24; K8sBP ch. 8; NetK8s ch. 4]*
8. **Grant RBAC by least privilege.** No Role unless the code calls the API,
   no wildcards, no cluster-admin on workloads, and
   `automountServiceAccountToken: false` elsewhere. *[K8s Patterns ch. 26; K8sBP ch. 4]*
9. **Make every release safe to run beside the previous one.** Rolling,
   canary, and blue-green all serve two versions; use expand-then-contract
   schemas, or `Recreate` with accepted downtime.
   *[K8s Patterns ch. 3; K8sBP ch. 5; K8sIA2 ch. 14]*
10. **Never rely on `replicas: 1` or a StatefulSet alone for "never twice".**
    ReplicaSets favour availability and a force-delete breaks StatefulSet
    identity; enforce exclusivity with a Lease or a database lock or unique
    index. *[K8s Patterns ch. 10, 12; K8sIA2 ch. 15; Review lessons]*

## Resources and capacity

- **Treat requests as the scheduling contract and measure them.** Scheduling
  and HPA percentages use requests; start high, tune from load tests and VPA
  recommendations. *[K8s Patterns ch. 2, 29; K8sBP ch. 1]*
- **Choose QoS on purpose.** Guaranteed for production-critical Pods;
  Burstable or BestEffort only where eviction is fine. *[K8s Patterns ch. 2]*
- **Size heaps and thread pools from container limits, not the node.** An
  autoscaler cannot rescue a bad heap setting. *[K8s Patterns ch. 29; K8sIA2 ch. 9]*
- **Put a ResourceQuota and LimitRange on every shared namespace.**
  `maxLimitRequestRatio` caps overcommit. *[K8s Patterns ch. 2; K8sBP ch. 2]*
- **Use PriorityClass sparingly.** Preemption ignores PodDisruptionBudgets;
  give node-critical DaemonSets a high class, and use `preemptionPolicy: Never`
  for queue priority without eviction. *[K8s Patterns ch. 2; K8sIA2 ch. 16]*
- **Set `sizeLimit` on every emptyDir.** Memory-backed ones count against
  the Pod's memory. *[K8sIA2 ch. 7]*

## Health probes

- **Make readiness check the real resource.** A probe on `/` can pass while
  the cache or generated data is not ready. *[K8sIA2 ch. 11]*
- **Fail liveness only for conditions a restart cures.** A dependency check
  restarts every replica at once into CrashLoopBackOff. *[K8s Patterns ch. 4; NetK8s ch. 4]*
- **Keep probe endpoints unauthenticated, cheap, and fast.** The default
  timeout is about one second; raise `failureThreshold` instead of retrying
  inside the handler. *[K8sIA2 ch. 6]*
- **Add readiness gates when a load balancer must register the Pod first.**
  Otherwise a rollout can leave it with no healthy targets. *[K8s Patterns ch. 4; NetK8s ch. 4]*
- **Record why a container died.** Use `/dev/termination-log` or
  `terminationMessagePolicy: FallbackToLogsOnError`. *[K8s Patterns ch. 4]*

## Lifecycle and Pod composition

- **Bridge the endpoint-removal race.** Endpoint removal reaches proxies while
  SIGTERM arrives, so serve a few seconds after TERM or use the built-in
  `preStop` `sleep` action (newer than the books). *[K8sIA2 ch. 6; K8sBP ch. 5]*
- **Lengthen, never shorten, the grace period when draining needs time.** It
  covers `preStop` plus the TERM-to-KILL window. *[K8s Patterns ch. 5; K8sIA2 ch. 6]*
- **Make hooks idempotent and keep critical logic out of them.** A failing
  `preStop` only emits an Event and the kill proceeds. *[K8s Patterns ch. 5; K8sIA2 ch. 6]*
- **Move one-off setup into small, idempotent init containers.** They keep
  setup tools out of the app image; their requests count too. *[K8s Patterns ch. 5, 15; K8sIA2 ch. 5]*
- **Declare proxies and agents as native sidecars.** Init containers with
  `restartPolicy: Always` start first and do not block Jobs (newer than the
  books). *[K8s Patterns ch. 16; K8sIA2 ch. 5]*
- **Run one process per container; split Pods unless containers share host,
  lifecycle, and scaling.** *[K8sIA2 ch. 2, 5; NetK8s ch. 3]*

## Rollouts and releases

- **Run stateless services as a Deployment with at least two replicas.**
  Never bare Pods or hand-made ReplicaSets. *[K8sBP ch. 1; K8sIA2 ch. 13, 14]*
- **Set `maxSurge`, `maxUnavailable`, and `minReadySeconds` explicitly.** A
  version failing after startup then stalls instead of replacing every Pod. *[K8s Patterns ch. 3; K8sIA2 ch. 14]*
- **Alert on `ProgressDeadlineExceeded` and roll back yourself.** Kubernetes
  never auto-rolls back; `rollout undo` reverts only the Pod template. *[K8sIA2 ch. 14]*
- **Use a progressive-delivery controller for canary and blue-green.** Start
  with rolling updates until you have traffic shifting and baselines.
  *[K8s Patterns ch. 3; K8sBP ch. 5; K8sIA2 ch. 14; CNDK8s ch. 1]*
- **Leave `replicas` out of manifests an autoscaler owns.** Every apply
  resets it. *[K8sIA2 ch. 14]*
- **Keep version labels out of the immutable selector.** Stamp app version,
  image version, and CD release ID as labels. *[K8sBP ch. 6]*
- **Roll out region by region.** Canary region first, waiting about twice the
  historical time-to-detect per stage. *[K8sBP ch. 7]*

## Manifests, images, and review gates

- **Keep one parameterized chart or overlay set in the app's repository.**
  Copied per-environment directories drift. *[K8sBP ch. 1, 5, 7]*
- **Lint and validate manifests in CI before an image is pushed.** Run the
  production admission policies in dev too. *[K8sBP ch. 5; K8s Patterns ch. 23; Review lessons]*
- **Use the `app.kubernetes.io/*` labels everywhere.** Domain-prefix custom
  keys, put owner and commit in annotations, and quote values YAML would read
  as booleans or numbers. *[K8sIA2 ch. 10; K8s Patterns ch. 1; K8sBP ch. 1; NetK8s ch. 5]*
- **Name every port and check `targetPort` matches a listening port.** A
  mismatch leaves endpoints that refuse connections. *[K8sIA2 ch. 5, 11; NetK8s ch. 5]*
- **Build in-cluster only with rootless builders.** Never mount the runtime
  socket. *[K8s Patterns ch. 30]*
- **Audit claims against manifests.** Docs and PR text saying "non-root",
  "HA", or "zero-downtime" must match; no hand-typed counts. *[Review lessons]*
- **Sweep siblings after a manifest fix.** Grep every chart and overlay for
  the same gap and fix all in one commit. *[Review lessons]*
- **Scope policy exemptions to one workload, with a reason.** Never weaken a
  correctness or security policy cluster-wide. *[Review lessons; K8sBP ch. 9]*

## Configuration and secrets

- **Keep configuration out of the image.** Per-environment values live in
  ConfigMaps. *[K8s Patterns ch. 19; K8sIA2 ch. 9; K8sBP ch. 5]*
- **Parse configuration at startup and fail fast.** Reject empty, NaN, and
  out-of-range values with a clear message. *[Review lessons]*
- **Version ConfigMaps and Secrets by name or hash and mark them
  `immutable`.** A new name rolls Pods and keeps rollback.
  *[K8s Patterns ch. 3, 20; K8sBP ch. 1, 4; K8sIA2 ch. 9]*
- **Know which mode reloads.** Env vars never update; volumes do except via
  `subPath`; mounts hide image files. *[K8sBP ch. 4; K8sIA2 ch. 9; K8s Patterns ch. 20]*
- **Create referenced ConfigMaps and Secrets before the Pod.** A missing key
  blocks startup; `envFrom` skips bad names silently. *[K8sBP ch. 4]*
- **Inject Pod metadata and limits through the Downward API.** The app stays
  unaware of Kubernetes and sizes itself to its limits. *[K8s Patterns ch. 14; K8sIA2 ch. 9]*
- **Mount Secrets as read-only files with a tight `defaultMode`.** Env vars
  leak into crash reports and child processes. *[K8sIA2 ch. 9; Review lessons]*
- **Store secrets in Git only client-side encrypted, or sync from a vault.**
  *[K8s Patterns ch. 25; K8sBP ch. 4]*

## Pod and node security

- **Fix volume ownership with `fsGroup` (`fsGroupChangePolicy: OnRootMismatch`)
  or a short init container; listen above port 1024.** App containers then run
  non-root. *[K8s Patterns ch. 23; CNDK8s ch. 2; NetK8s ch. 2]*
- **Enforce Pod Security Standards with namespace labels.** Start at enforce
  `baseline` plus warn on `restricted`, then enforce `restricted` on app
  namespaces once warnings are clear. *[K8s Patterns ch. 23]*
- **Keep `hostPath`, `hostNetwork`, and `hostPort` out of app workloads.**
  They tie Pods to a node and enable host takeover. *[K8sIA2 ch. 7, 16; NetK8s ch. 3]*
- **Keep shells and network tools out of production images; use `kubectl debug`.** *[NetK8s ch. 2]*
- **Run production in its own cluster.** Namespaces only scope names.
  *[K8sIA2 ch. 10]*

## RBAC and service accounts

- **Give each API-calling app its own ServiceAccount and namespaced Role.**
  Bind shared ClusterRoles through RoleBindings. *[K8sBP ch. 4; K8s Patterns ch. 26]*
- **Never grant `list` or `watch` on Secrets to apps.** Use `get` with
  `resourceNames`. *[K8sBP ch. 4]*
- **Authenticate humans via OIDC with MFA and just-in-time elevation.**
  Standing admin rights are the usual escalation path. *[K8sBP ch. 4]*
- **Give each CI/CD tool its own ServiceAccount and short-lived federated
  credentials.** Audit logs then name the pipeline. *[K8sBP ch. 4; Review lessons]*
- **Authorize with the Node and RBAC modes only; no ABAC or authz webhooks.**
  An unreachable authz webhook blocks every request. *[K8sBP ch. 10]*

## Services, DNS, and traffic

- **Address workloads by Service DNS name.** Never pod IPs or injected
  `*_SERVICE_HOST` variables. *[NetK8s ch. 4; K8s Patterns ch. 13]*
- **Pick the simplest Service type.** ClusterIP by default, LoadBalancer for
  non-HTTP external, NodePort only behind a load balancer, headless only for
  client-side selection. *[K8s Patterns ch. 13; K8sBP ch. 8; NetK8s ch. 5]*
- **Pair a StatefulSet with a headless Service for peers and a normal
  Service for clients.** Peers need every member; clients only ready ones. *[K8sIA2 ch. 15]*
- **Use Gateway API for new HTTP routing.** Community ingress-nginx stopped
  receiving fixes in March 2026; on Ingress, set `ingressClassName` and run one
  maintained HA controller. *[K8sBP ch. 8; K8sIA2 ch. 12; NetK8s ch. 5]*
- **Scope CORS at the edge to named origins on stateful routes.** Never a wildcard. *[Review lessons]*
- **Balance gRPC and HTTP/2 per request at L7.** kube-proxy balances per
  connection. *[NetK8s ch. 4, 5]*
- **Run CoreDNS as critical infrastructure.** Set requests and alert on
  latency. *[NetK8s ch. 4]*
- **Adopt a service mesh only for a named need (mTLS, L7 authz, traffic
  shifting).** Check whether CNI-level mTLS covers it first. *[K8sBP ch. 8; NetK8s ch. 5]*

## Network policy

- **List `policyTypes` explicitly and allow DNS on egress.** Write ingress
  rules first. *[K8s Patterns ch. 24; K8sBP ch. 8; NetK8s ch. 4]*
- **Check whether selectors share one peer entry (AND) or two (OR).** One
  YAML dash flips the meaning. *[NetK8s ch. 4]*
- **Lock the labels policies match behind RBAC or admission.** Anyone who can
  label a namespace can join another team's allow rule. *[NetK8s ch. 4]*
- **Enforce "every workload has a policy" with admission control.** A
  convention enforces nothing. *[NetK8s ch. 4; Review lessons]*
- **Keep few, clearly purposed policies per namespace.** All selecting rules
  union, so many small ones become unreadable. *[NetK8s ch. 4; K8sBP ch. 8]*
- **Layer mTLS or tokens on top.** IP rules are not authentication. *[NetK8s ch. 4; K8s Patterns ch. 24]*

## Storage and stateful workloads

- **Prefer a managed database; self-host with a StatefulSet plus operator.**
  StatefulSets give identity, not failover or quorum changes. *[K8sBP ch. 1; CNDK8s ch. 1; K8sIA2 ch. 15]*
- **Ship PersistentVolumeClaims with a portable storage class.** Never PVs
  in app manifests. *[K8sIA2 ch. 8; K8sBP ch. 1]*
- **Pick access modes deliberately.** ReadWriteOnce is per node; replicas
  cannot share one writable volume. *[K8s Patterns ch. 11; K8sIA2 ch. 7, 15]*
- **Set reclaim and PVC retention policies explicitly.** Dynamic volumes
  default to Delete. *[K8sIA2 ch. 8, 15; K8s Patterns ch. 12]*
- **Stage StatefulSet updates with `rollingUpdate.partition`.** Under
  OrderedReady one unready Pod stalls everything. *[K8s Patterns ch. 12; K8sIA2 ch. 15; NetK8s ch. 5]*
- **Add a PodDisruptionBudget to quorum workloads.** `maxUnavailable: 0`
  blocks node drains. *[K8s Patterns ch. 10]*

## Jobs, CronJobs, and DaemonSets

- **Run finite work as a Job with `backoffLimit` and `activeDeadlineSeconds`.**
  Add `podFailurePolicy` for non-retryable exit codes; keep the TTL long
  enough to read logs. *[K8s Patterns ch. 7; K8sIA2 ch. 17]*
- **Use one Job with a work queue or Indexed Job, not one Job per item.**
  Thousands of Jobs load the control plane. *[K8s Patterns ch. 7; Review lessons]*
- **Set `timeZone` (IANA name), `concurrencyPolicy`, and
  `startingDeadlineSeconds` on every CronJob.** The default allows overlap and
  a recovered controller fires missed runs at once. *[K8s Patterns ch. 8; K8sIA2 ch. 17]*
- **Make scheduled code safe against duplicate and missed runs.** Derive
  "today" through the project date helper in an explicit zone.
  *[K8s Patterns ch. 8; Review lessons]*
- **Run node agents and log forwarders as DaemonSets.** Per-Pod log sidecars
  cost far more. *[K8s Patterns ch. 9; K8sBP ch. 3]*

## Scheduling and autoscaling

- **Steer placement with the least policy that works.** Requests and labels,
  then affinity, then spread; taints for dedicated nodes; never `nodeName`. *[K8s Patterns ch. 6]*
- **Spread replicas across three zones with topology spread constraints.**
  A zone is one fault domain. *[K8s Patterns ch. 6; NetK8s ch. 6; CNDK8s ch. 3]*
- **Autoscale on a metric that falls as replicas rise, never raw memory.**
  Memory rarely drops, so the HPA runs to its maximum. *[K8s Patterns ch. 29]*
- **Never let VPA and HPA act on the same CPU or memory signal.** They
  double-scale; run VPA in recommendation mode unless in-place resize (on by
  default since 1.33, newer than the book) avoids restarts. *[K8s Patterns ch. 29]*
- **Scale in order: app tuning, requests, HPA, cluster autoscaler.** Each
  layer depends on the one before. *[K8s Patterns ch. 29]*

## Admission control, controllers, and operators

- **Prefer in-tree CEL admission policies (GA 1.30, after the book) for simple
  rules.** Webhooks delay every matching request. *[K8sBP ch. 9, 10]*
- **Enforce on the Pod and roll new policies out in warn or audit first.**
  Deny at once breaks running workloads. *[K8sBP ch. 9; K8s Patterns ch. 23]*
- **Make mutating webhooks idempotent and never overlap on a field.**
  Mutators run in no fixed order; validate the final object. *[K8sBP ch. 10]*
- **Scope webhooks with an opt-in `namespaceSelector` and a deliberate
  `failurePolicy`.** Exclude kube-system and the webhook's own namespace, and
  make no external calls in the admit path. *[K8sBP ch. 9, 10]*
- **Write controllers as level-based reconcile loops with leader election.**
  Log each reconcile decision. *[K8s Patterns ch. 27]*
- **Give CRDs a full schema and a `status` subresource.** Build an operator
  only for a declarative domain. *[K8s Patterns ch. 28]*
- **Scope controller lists and watches to namespaces or labels, and
  paginate them.** Ask what happens at 10k objects. *[Review lessons; K8s Patterns ch. 27]*
- **Read EndpointSlices, not the Endpoints API.** Endpoints was deprecated
  in 1.33, after the book. *[NetK8s ch. 5]*

## Choosing and running clusters

- **Question whether Kubernetes is warranted.** Under about five services
  (the author's heuristic) try clusterless containers first. *[K8sIA2 ch. 1; CNDK8s ch. 1]*
- **Use a managed Kubernetes service.** Self-host only for a written
  requirement, with a standard installer. *[CNDK8s ch. 3; K8sIA2 ch. 1]*
- **Schedule upgrades as recurring work in a maintenance window.** Stay on a
  supported minor version; re-check HA and security after each. *[CNDK8s ch. 3]*
- **Run private nodes behind NAT and limit API access to known ranges.** *[NetK8s ch. 6; CNDK8s ch. 3]*
- **Plan pod, service, and node CIDRs for maximum cluster size.** Re-IP is
  disruptive. *[K8sBP ch. 8; NetK8s ch. 6]*
- **Page on SLO symptoms, not single Pod failures.** Kubernetes self-heals. *[K8sBP ch. 3]*

## Troubleshooting

- **Read status conditions and Events first.** `ErrImagePull` means a bad
  image reference or credentials. *[K8sIA2 ch. 4; CNDK8s ch. 2]*
- **For a Service with no traffic, check endpoints, selector, ports,
  readiness, NetworkPolicy, then DNS.** Each layer fails quietly. *[NetK8s ch. 5]*
- **Relabel a bad replica out of its selector instead of deleting it.** The
  controller replaces it while you inspect. *[K8sIA2 ch. 13; NetK8s ch. 5]*

## Tensions

- **No CPU limits vs request equal to limit.** House: memory limit equals
  request; CPU gets a limit only when platform policy or Guaranteed QoS
  needs one. *[K8s Patterns ch. 2; K8sBP ch. 1]*
- **Liveness everywhere vs none.** House: readiness and startup always;
  liveness only for hangs the app cannot detect. *[K8sBP ch. 5; K8sIA2 ch. 6]*
- **Readiness on dependencies vs local only.** House: warm-up, overload, and
  in-pod deps; degrade in-app for external outages.
  *[K8s Patterns ch. 4; K8sIA2 ch. 11]*
- **State in the cluster vs managed services.** House: managed by default,
  operator when self-hosted. *[K8sBP ch. 1; CNDK8s ch. 1; K8sIA2 ch. 15]*
- **Managed vs self-hosted control plane.** House: managed; regulated,
  air-gapped, and edge sites win the exception. *[CNDK8s ch. 3; K8sIA2 ch. 1]*
- **Namespaces vs clusters per environment.** House: production separate;
  non-production may share hardened namespaces. *[K8sIA2 ch. 10; K8sBP ch. 2]*
- **Log sidecars vs DaemonSet.** House: DaemonSet; sidecar only when the app
  cannot log to stdout. *[K8s Patterns ch. 16; K8sBP ch. 3]*
- **Ingress vs Gateway API.** House: Gateway API for new work; the books
  predate its GA and the ingress-nginx retirement. *[K8sBP ch. 8; NetK8s ch. 5]*
- **Staging vs testing in production.** House: both, staging first, then
  progressive rollout. *[K8sBP ch. 5, 7]*

## Sources

- **K8s Patterns**: Kubernetes Patterns, 2nd Edition (Bilgin Ibryam, Roland
  Huß; O'Reilly, 2023)
- **K8sBP**: Kubernetes Best Practices, 2nd Edition, Early Release (Brendan
  Burns, Eddie Villalba, Dave Strebel, Lachlan Evenson; O'Reilly, 2023)
- **CNDK8s**: Cloud Native DevOps with Kubernetes, 2nd Edition, Early Release
  chapters 1-3 (John Arundel, Justin Domingus; O'Reilly, 2021)
- **K8sIA2**: Kubernetes in Action, 2nd Edition, MEAP (Marko Luksa; Manning,
  2023)
- **NetK8s**: Networking and Kubernetes: A Layered Approach (James Strong,
  Vallery Lancey; O'Reilly, 2021)
- **Review lessons**: rules distilled from the maintainer's code-review findings
