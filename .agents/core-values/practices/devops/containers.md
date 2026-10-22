# Containers and Docker

> **Load when:** writing or reviewing a Dockerfile, `.dockerignore`, Compose
> file (`compose.yaml`, `docker-compose.yml`), container entrypoint script, or
> image build step in CI; choosing base images, tags, or registries; running,
> hardening, networking, or giving storage to containers; passing config or
> secrets into containers; or debugging a container that will not start, stop,
> answer, or stay healthy.
> **See also:** [Continuous integration and delivery](ci-cd.md),
> [Kubernetes](kubernetes.md),
> [Application and API security](../security/application-security.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Operating systems and Linux](../systems/operating-systems-and-linux.md),
> [Debugging](../core/debugging.md)

## Top rules

1. **Never put a secret in an image layer, `ARG`, or `ENV`, even if a later
   step deletes it.** Every layer persists and `docker history` shows build
   args; use BuildKit `RUN --mount=type=secret` at build time and mounted secret
   files at run time, and rotate any secret that was ever pushed.
   *[DiP ch. 7, 9, 14; DiA2 ch. 12; Review lessons]* (Updated: the books
   predate BuildKit secret mounts.)
2. **Build one environment-agnostic image per commit and promote that exact
   image through every stage.** Inject environment config at run time; an image
   rebuilt per environment means production runs an untested build.
   *[DiA2 ch. 2, 10; DiP ch. 9; DC-Guide ch. 2]*
3. **Use multi-stage builds so the runtime image holds only the artifact and
   its runtime dependencies.** Compilers, SDKs, and package caches in the final
   image add size, CVEs, and attacker tooling. *[DiA2 ch. 8, 10]*
4. **Run as a dedicated non-root user, drop unneeded capabilities, set
   `no-new-privileges`, and never use `--privileged`.** Container root shares
   UIDs and unnamespaced kernel interfaces with the host.
   *[DiA2 ch. 6, 8; DiP ch. 14]*
5. **Treat Docker socket or API access as root on the host.** Do not mount
   `/var/run/docker.sock` into app or CI containers, do not add untrusted users
   to the `docker` group, and never expose the daemon over TCP without TLS
   client certificates. *[DiA2 ch. 6; DiP ch. 2, 14; DC-Guide ch. 2]*
6. **Use the exec (JSON array) form of `ENTRYPOINT` and `CMD`, and run a real
   init (`--init`, tini) when the process spawns children.** The shell form makes
   `/bin/sh` PID 1, so SIGTERM never reaches the app and zombies pile up.
   *[DiA2 ch. 2, 8; DiP ch. 3, 7]*
7. **Deploy immutable tags or digests, never `latest`.** Tags move without
   notice; give each CI build a unique tag (commit plus timestamp) and resolve
   moving tags to a digest before deploy. *[DiA2 ch. 8, 10; DiP ch. 3]*
8. **Order Dockerfile steps from least to most frequently changed, and copy the
   dependency manifest and install before copying source.** One early `COPY . .`
   invalidates the cache for every later step. *[DiP ch. 3]*
9. **Give every long-running service a health check that exercises the app,
   and gate dependants on readiness, not start order.** A running process is not
   a serving process; use `depends_on: condition: service_healthy` and make apps
   retry connections anyway. *[DiA2 ch. 8, 11; DC-Guide ch. 2, 12]*
10. **Keep state in named volumes and set memory and CPU limits on every
    production container.** The container filesystem dies with the container,
    and one unbounded container can starve the host. *[DiA2 ch. 4, 6; DiP ch. 5,
    15; DC-Guide ch. 3]*

## Dockerfile authoring

- **Keep every shipped image's Dockerfile in version control; never ship an
  image made with `docker commit`** (keep it for throwaway exploration).
  Committed images cannot be reproduced, reviewed, or rebuilt. *[DiA2 ch. 7, 8]*
- **Create `.dockerignore` before the first build.** Exclude VCS metadata,
  local env files, build output, and dependency folders so they never enter the
  build context or the image. *[DiA2 ch. 8]*
- **Install and clean up in the same `RUN`.** A deletion in a later layer only
  adds a whiteout; the bytes stay. Chain the package-index update, the install,
  and cache removal (`rm -rf /var/lib/apt/lists/*`, docs) in one step.
  *[DiA2 ch. 7; DiP ch. 3, 7]*
- **Set non-interactive mode for package managers** (for example
  `DEBIAN_FRONTEND=noninteractive` on the install command, `apk add --no-cache`).
  A prompt hangs the build. *[DiP ch. 7]*
- **Use `COPY` for local files; fetch a remote artifact only with
  `ADD --checksum=sha256:<hash>` or a `RUN` that downloads, verifies the hash,
  and deletes in one step.** An unpinned remote fetch makes the build
  unreproducible and trusts whatever the URL serves that day. *[DiA2 ch. 8;
  DiP ch. 4; Docker-BP]* (Updated: DiA2 bans remote `ADD`; `--checksum` now
  makes it safe.)
- **Use `COPY --chown` and `--chmod` instead of a later `RUN chown`.** A
  separate chown layer duplicates every file it touches. *[DiA2 ch. 8]*
  (Updated: the book predates these flags.)
- **Put the executable in `ENTRYPOINT` and default arguments in `CMD`.** Users
  override arguments without knowing the entrypoint, which suits packaged tools.
  *[DiA2 ch. 8; DiP ch. 7]*
- **Feed version and build metadata through one `ARG` with a safe default,
  derived from version control by the build script.** One value then drives the
  tag, an `ENV`, and the labels. *[DiA2 ch. 8]*
- **Label images with OCI keys: `org.opencontainers.image.version`,
  `revision`, `created`, `source`.** These make audits and incident triage
  traceable to a commit. *[DiA2 ch. 10]* (Updated: replaces label-schema.org.)
- **Set time zone and locale explicitly; never assume they match the host.**
  Containers usually default to UTC wherever they run. Keep app logic on UTC
  and convert through the project's one date helper. *[DiP ch. 4; Review lessons]*

## Base images and image size

- **Pick the smallest base that has what the app needs: `scratch` or
  distroless for static binaries, `-slim` or Alpine otherwise.** Test Alpine
  for musl and BusyBox differences (no bash, different tar). *[DiP ch. 7;
  DiA2 ch. 8, 9]*
- **Pin base images by digest and let a bot (Renovate, Dependabot) open PRs
  that bump the digest.** Digests make builds reproducible; automated bumps keep
  security patches flowing. *[DiA2 ch. 8; DiP ch. 3, 7; Docker-BP]*
- **Build debug or profiling variants as named stages, always build with an
  explicit `--target`, and make the production stage the last one.** Without a
  target Docker builds the last stage. *[DiA2 ch. 10]*
- **Pin `platform:` or `--platform` (for example `linux/amd64`) for images bound
  for a runtime whose architecture differs from the build machine.** ARM laptop
  builds do not run on amd64 hosts. *[DC-Guide ch. 11]*

## Runtime security and isolation

- **Create the app user and group early in the Dockerfile with a fixed,
  non-system UID, and switch with `USER` after the root-only steps.** If startup
  needs root, drop privileges in the entrypoint with gosu or similar.
  *[DiA2 ch. 8; DiP ch. 14]*
- **Run with a read-only root filesystem and grant only the writable paths the
  app needs:** a volume for state, a size-limited tmpfs for `/tmp`. Find those
  paths with `docker container diff` on a writable run. *[DiA2 ch. 2, 4]*
- **Add specific capabilities instead of `--privileged`, and drop the rest**
  (`--cap-drop ALL` then add back, or at least drop `NET_RAW`). Since Docker
  20.10 a non-root process can bind ports below 1024 on a container network
  without extra capabilities, so that is no reason to stay root.
  *[DiA2 ch. 6; DiP ch. 14]* (Updated: DiA2 names the wrong capability and
  predates this default.)
- **Treat `--network host`, `--pid host`, and similar namespace bypasses as
  equivalent to `--privileged`.** Use them only for measured performance needs or
  short debugging; never for third-party or multitenant workloads.
  *[DiA2 ch. 5; DiP ch. 16; DC-Guide ch. 3]*
- **Start untrusted workloads at maximum isolation and loosen only with a
  stated reason.** Limited user, dropped capabilities, resource limits, a device
  allowlist, and seccomp, AppArmor, or SELinux profiles. Keep SELinux or
  AppArmor enforcing and write a container policy instead of switching it off.
  *[DiA2 ch. 6; DiP ch. 5, 14]*
- **Enable user-namespace remapping or rootless Docker or Podman on hosts that
  run untrusted code.** Container root then maps to an unprivileged host UID.
  *[DiA2 ch. 6; DiP ch. 14]*

## Secrets and configuration

- **Inject environment-specific values (hosts, tenant database names,
  credentials) at run time; ship no environment defaults that could make two
  tenants share one database.** *[DiA2 ch. 2; DC-Guide ch. 2]*
- **Deliver secrets as files on an in-memory mount (`/run/secrets/<name>`) with
  tight owner and mode, and pass only the path in env (`DB_PASSWORD_FILE`).**
  Env vars are inherited by children and leak into debug output and crash dumps.
  *[DiA2 ch. 12; DC-Guide ch. 11]*
- **Put scratch secrets (keys, upload buffers) on tmpfs with an explicit
  `tmpfs-size` and a restrictive `tmpfs-mode`.** The defaults are unlimited and
  world-writable. *[DiA2 ch. 4]*
- **Write any secret the entrypoint must materialize to a uniquely named file
  with mode 0600, never a predictable path.** *[Review lessons]*
- **Before choosing a secret mechanism, check encryption at rest, encryption in
  transit, who can read it, how it appears in the container, and whether access
  is audited.** Kubernetes Secrets are only base64 unless etcd encryption or an
  external store is on. *[DiP ch. 13]*
- **Bootstrap the first secret from platform workload identity (OIDC, cloud
  IAM roles) and a secret manager, not from a file shipped with the app.**
  *[DiA2 ch. 12]*
- **Encrypt any secret source kept in a repository (sops with a KMS);
  plaintext secret files belong only on a developer machine.** *[DC-Guide ch. 11]*

## Process lifecycle, signals, and health

- **Write an entrypoint that validates preconditions and fails fast with a
  clear message, then `exec`s the app.** Check required env vars, secret files,
  mounts, user, and dependencies; reject empty, NaN, and out-of-range values
  rather than defaulting silently. *[DiA2 ch. 8; Review lessons]*
- **Validate any value used in a shell `export` or `eval` in an entrypoint as an
  identifier first, and quote every expansion.** Env and secret contents are
  external input. *[Review lessons]*
- **Handle SIGTERM and exit within the stop grace period.** `docker stop` sends
  SIGTERM (or `STOPSIGNAL`) and SIGKILL after 10 seconds by default; tune with
  `--time` or `stop_grace_period`. Keep `docker kill` for emergencies.
  *[DiA2 ch. 2; DiP ch. 5; Docker-stop]* (Updated: DiA2 says SIGHUP.)
- **Run one main process per container; if you truly need several, use a real
  supervisor, never a hand-written shell loop.** Home-made scripts re-implement
  init badly. *[DiP ch. 3; DiA2 ch. 8]*
- **Make the health check cheap, dependency-free, and exit only 0 or 1;**
  probe a `/health` or `/ping` endpoint with a tool that fails on non-2xx
  (`curl -f`) or a built-in health subcommand, and set interval, timeout,
  retries, and start period. *[DiA2 ch. 8; DC-Guide ch. 2]*
- **Choose the restart policy on purpose:** `on-failure:N` caps retries,
  `unless-stopped` respects a manual stop, `always` ignores it. A restart policy
  in backoff blocks `exec`, so pair it with logs that explain the exit.
  *[DiP ch. 2; DiA2 ch. 2]*

## Storage, volumes, and resources

- **Persist data in named volumes declared at the top level; use bind mounts
  only for host-edited config on workstations or special hosts.** Bind mounts tie
  the container to one host's layout. *[DiA2 ch. 4; DC-Guide ch. 3]*
- **Give each data directory exactly one writer, and mount it read-only (`:ro`)
  in every other container,** such as backup sidecars. Two database instances
  or services sharing one log file corrupt it. *[DiA2 ch. 4; DiP ch. 5;
  DC-Guide ch. 3]*
- **Pin a stateful service to the node that holds its local-driver volume, or
  use a replicating volume driver.** Local volumes exist on one node, so a
  rescheduled task starts empty. *[DiA2 ch. 11, 13; DC-Guide ch. 3]*
- **Use `--rm` for one-off containers, remove anonymous volumes with the
  container, and prune exited containers, dangling images, and orphaned volumes
  on a schedule,** filtering by project label so other work survives.
  *[DiA2 ch. 2, 4; DiP ch. 6; DC-Guide ch. 2]*
- **Set memory limits from measured use under real load (`docker stats`), and
  check that the host can hold the sum of all limits.** A limit caps; it does
  not reserve. Size runtime heaps from the limit, not the host: on current
  container-aware JVMs set `-XX:MaxRAMPercentage` rather than a fixed `-Xmx`,
  and set Node's `--max-old-space-size` below the limit. *[DiA2 ch. 6; DiP
  ch. 15]* (Updated: DiP predates container-aware JVM defaults.)

## Networking

- **Create a user-defined network per application and address peers by service
  name; never use the default bridge, `links`, `localhost`, or hard-coded IPs.**
  User-defined networks give DNS discovery and isolation.
  *[DiA2 ch. 5; DiP ch. 2, 10; DC-Guide ch. 2, 3]*
- **Segment a stack by concern (public, data, monitoring) and attach each
  service only to the networks it needs.** *[DC-Guide ch. 3, 5, 8; DiA2 ch. 13]*
- **Assume every container on a shared Docker network can reach every other,
  and authenticate service-to-service calls in the app.** Docker networks have
  no firewall between peers; use Kubernetes NetworkPolicy for enforcement.
  *[DiA2 ch. 5, 13]*
- **Leave out `ports:` for services only other containers call, and bind
  published ports to `127.0.0.1` when only the host should reach them.** The
  short form publishes on every interface. *[DC-Guide ch. 5; DiA2 ch. 5]*
- **Make the server listen on `0.0.0.0` inside the container.** A service bound
  to the container's loopback ignores published-port traffic. *[DiP ch. 7]*

## Tags, registries, and promotion

- **Publish overlapping version tags (`1`, `1.9`, `1.9.2`), point `latest` only
  at the newest stable release, and document what each moving tag means.**
  `latest` is just the default name and can point at an old build.
  *[DiA2 ch. 7, 10; DiP ch. 3]*
- **Gate promotion by retagging or copying the image to the next stage's
  registry or repository only when a stage passes.** *[DiP ch. 9, 13]*
- **Scan images and block production promotion on results, but do not treat a
  clean scan as proof of safety.** Rank CVEs by exploitability as well as
  severity; use a maintained scanner such as Trivy, Grype, or Docker Scout.
  *[DiP ch. 13, 14]*
- **Attach an SBOM and provenance to every published image**
  (`docker buildx build --sbom=true --provenance=true`) so you can find affected
  images when a CVE lands. *[DiP ch. 13]* (Updated: postdates the book.)
- **Verify signatures (cosign, Notation) at deploy or admission, separately
  from scanning.** A scan says what is inside; a signature says it is the image
  you approved. *[DiP ch. 13]* (Updated: replaces Notary v1.)

## Image build pipeline

- **Run image builds through one scripted pipeline that developers and CI both
  call:** clean checkout, lint the Dockerfile (hadolint), scan the build
  context for committed secrets, build, structure-test, scan, tag, publish,
  stopping on any failure. *[DiA2 ch. 10; Review lessons]* Pipeline mechanics
  live in [Continuous integration and delivery](ci-cd.md).
- **Structure-test the built image:** required files exist with the right owner
  and mode, key commands report expected versions, required labels are present,
  and every claim in comments, README, or labels (runs as non-root, read-only,
  port) holds for the built image. *[DiA2 ch. 10; Review lessons]*
- **Build in CI without mounting the host Docker socket;** prefer rootless
  BuildKit, Buildah, or a remote builder. *[DiP ch. 8, 14]* (Updated: DiP
  mounts the socket into CI agents; Kaniko is no longer maintained upstream.)
- **Export the BuildKit cache to the registry or the CI cache (`cache-to`,
  `cache-from`) and set a job timeout.** Caching the Docker data directory is
  fragile. *[DC-Guide ch. 9; DiP ch. 8]*

## Docker Compose

- **Use `docker compose` (v2) and drop the top-level `version:` key.** V1
  `docker-compose` is end of life; current Compose treats `version:` as
  obsolete and warns. *[DC-Guide ch. 1; DiA2 ch. 11; Compose-spec]*
- **Describe services, networks, volumes, configs, and secrets declaratively in
  version control, and change the stack by editing the file.** Imperative
  changes are undone on the next deploy. *[DiA2 ch. 11; DiP ch. 10]*
- **Run `docker compose config` before debugging or deploying** to see merged
  files, resolved paths, implicit defaults, and full resource names.
  *[DC-Guide ch. 4, 7]*
- **Prefer Compose subcommands (`ps`, `logs`, `down`, `events`) over raw
  `docker` commands;** they are scoped to the project's labels.
  *[DC-Guide ch. 1, 4]*
- **Run seeding and schema setup as a one-shot init service, and gate app
  services on `condition: service_completed_successfully`.** *[DC-Guide ch. 2, 8]*
- **Keep connection settings in env vars and longer sets in `env_file`; never
  commit a real `.env`.** *[DC-Guide ch. 2; Review lessons]*
- **Use `profiles` or `include` to switch optional services (monitoring, mocks)
  on and off; use `extends` instead of copying a service block.** If you split
  files with `-f`, the first file sets the project directory and name, so set
  `name:` explicitly. *[DC-Guide ch. 7]* (Updated: profiles and include
  postdate the book.)
- **Pass `--remove-orphans` after renaming or removing a service, and know that
  `down -v` deletes named volumes and `--rmi all` deletes pulled bases.**
  *[DC-Guide ch. 4]*
- **In CI, bring the stack up with `docker compose up --wait`, run an
  end-to-end smoke test whose failure fails the job, and always print
  `docker compose logs`.** Never use fixed `sleep` or `--ignore-pull-failures`
  in a gate. *[DC-Guide ch. 4, 9]* (Updated: `--wait` postdates the book.)
- **Do not make `docker compose up` against a remote host the production
  deploy path;** use it to share or test work. Target remote engines with
  named Docker contexts, not ad hoc `DOCKER_HOST` exports. *[DC-Guide ch. 10]*

## Debugging containers

- **Start with `docker inspect`** to confirm the actual ports, mounts, networks,
  user, and env match what you meant to start. *[DiP ch. 5]*
- **When "the port is open but nothing answers", check the listen address,
  the published interface, and which network each side is on.** *[DiP ch. 7;
  DiA2 ch. 5]*
- **Read logs with `--timestamps --tail=N` and watch `events` for restarts and
  recreations;** ship logs to a central store because container-local logs die
  with the container. *[DC-Guide ch. 4; DiP ch. 13, 15]* See
  [Observability and reliability](../operations/observability-and-reliability.md).

## Tensions

- **Pin by digest vs take base-image patches automatically.** Pin by digest and
  let a bot open bump PRs, so builds are reproducible and patches still arrive
  through review. Unpinned tags are acceptable only for throwaway local work.
  *[DiA2 ch. 8; DiP ch. 3, 7]*
- **Small images vs one large shared corporate base.** This library prefers
  minimal or distroless runtime images for attack surface and CVE noise. A
  shared larger base wins only for big fleets on one registry, and then it must
  be reliable, tested, and changelogged. *[DiP ch. 7, 13; DiA2 ch. 8]*
- **One process per container vs supervised multi-process containers.** One
  main process plus `--init` is the default. A supervisor is acceptable as a
  temporary step when migrating a legacy monolith. *[DiP ch. 3; DiA2 ch. 8]*
- **Env vars vs files for configuration.** Non-secret config goes in env vars;
  secrets go in mounted files with a `*_FILE` pointer. A key/value store is
  worth it only for config that must change without a redeploy.
  *[DiA2 ch. 12; DiP ch. 9; DC-Guide ch. 2]*
- **Swarm vs Kubernetes for orchestration.** DiA2's Swarm principles (rollback
  on failed rollout, reservations, placement, versioned configs) still hold;
  apply them through [Kubernetes](kubernetes.md). DC-Guide's Compose ECS and
  ACI integrations were retired in 2023; deploy with IaC tools instead.
  *[DiA2 ch. 11-13; DC-Guide ch. 11-12]*

## Sources

- **DiA2**: Docker in Action, 2nd Edition (Jeff Nickoloff, Stephen Kuenzli;
  Manning, 2019)
- **DiP**: Docker in Practice, 2nd Edition (Ian Miell, Aidan Hobson Sayers;
  Manning, 2019)
- **DC-Guide**: A Developer's Essential Guide to Docker Compose (Emmanouil
  Gkatziouras; Packt, 1st edition, 2022)
- **Docker-BP**: Docker Docs, "Building best practices"
  (<https://docs.docker.com/build/building/best-practices/>)
- **Docker-stop**: Docker Docs, "docker container stop" CLI reference
  (<https://docs.docker.com/reference/cli/docker/container/stop/>)
- **Compose-spec**: Docker Docs, "Version and name top-level elements"
  (<https://docs.docker.com/reference/compose-file/version-and-name/>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
