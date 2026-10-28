# Platform minimums and release qualification — engine v1

Status: finalized M4 target requirements, 2026-09-09. No platform is certified by this
document. A release may claim a matrix cell only after its native acceptance tests pass.

## Runtime and operating systems

Engine runtime: Node.js 24 LTS, minimum 24.0.0 API baseline, with the current security
patch bundled and pinned in each release manifest. Do not install the original 24.0.0
binary merely because it satisfies the API floor. The manifest pins Node, engine,
native dependency, database library, schema and artifact hashes per architecture.
Users need no global Node/TypeScript toolchain for packaged operation. A later Node
major requires the full platform/storage/worker suite before becoming a supported runtime.
SDK language runtimes are independent clients, not alternative engine implementations.

| Target | Minimum product version | Architectures | Native verification |
|---|---|---|---|
| Windows | Windows 11 25H2, vendor-supported servicing edition and current security updates | x64, arm64 | Separate native packages and real OS process/ACL/IPC tests for both |
| macOS | macOS 15 Sequoia on Apple-supported hardware, current security updates | Intel x64, Apple Silicon arm64 | Signed/notarized native package on each architecture; Rosetta is not arm64 evidence |
| Ubuntu | Ubuntu 24.04 LTS, current standard security updates | amd64, arm64 | Each native package on the minimum distro |
| Debian | Debian 13, current security updates | amd64, arm64 | Each native package on the minimum distro |
| Docker | Linux image based on Debian 13, digest-pinned release | linux/amd64, linux/arm64 | Native-architecture image with durable local volumes, private worker IPC and loopback UI |

Linux support is distro-specific, not a claim for every system with matching libc.
Node's own ABI floor is Linux kernel 4.18/glibc 2.28, but the higher distribution floors
above are the product requirement. Alpine/musl, 32-bit, Windows Server and emulated
architectures are not initial qualified targets. Windows arm64 is an explicit product
target despite Node classifying it Tier 2; release is blocked for that cell until native
dependencies and process behavior pass. Native Windows must not require WSL.

Newer OS major releases are compatibility candidates until the matrix is run; `>=`
does not mean untested future releases are certified. A vendor-EOL release leaves
support even if it meets the numeric floor. Raising a product floor requires a documented
release change and migration path; do not silently make an existing data directory
unreadable. Existing work can be inspected/exported without unsafe dispatch where possible.

Docker on desktop hosts uses a vendor-supported Linux-container runtime for that host
version and CPU. The installer preflight checks the actual runtime; the release manifest
records tested runtime versions rather than inventing a timeless Docker Desktop minimum.
Docker on Linux requires a maintained OCI-compatible runtime, with the same manifest
qualification. Container support does not establish native-host support. VM-backed
desktop volumes must pass durability/restore tests. A production database lives on a
local durable volume, not an SMB/NFS/share or synchronized cloud folder.

## Installation contract and machine resources

One launcher creates the coordinator and its local workers, with an exclusive
installation writer lock. Installation directories are separated into binaries,
configuration/identity, database, immutable artifacts and task workspaces. Use Windows
owner ACLs and Unix owner-only permissions for sensitive directories; reject unsafe
symlink/reparse targets. One owner-only helper makes and checks them. A directory it
creates has mode 0700 on Unix, and on Windows a protected access list (`D:P`) whose one
rule, not inherited, gives the service identity's SID full control. An existing
directory with broader access is refused with `UNSAFE_STATE_PERMISSIONS`, naming the
fix, and is never changed. A file that carries trust is owner-only when, on Windows,
every rule in its access list, inherited or direct, allows that SID and names no one
else (SYSTEM and Administrators included), and on Unix when the identity owns it with
no group or other access. Stated limit: on Windows the check reads the access list,
not the owner, which `icacls /save` does not export; an administrator can take
ownership of any file regardless. The uninstaller preserves state unless the human explicitly
chooses data removal after export. Upgrade and restore follow [MIGRATIONS.md](./MIGRATIONS.md).

Preflight validates OS/architecture, supported patched runtime/native modules, writable
local volume, locking/fsync behavior, available space, private IPC, TLS trust, configured
authenticator/secret provider, and requested task containment. Missing required capability
is an actionable failure, never an insecure fallback. System services require an explicit
service identity and compatible secret provider; desktop keychain availability is not
assumed for an unattended service or container.

There is no fixed product maximum for tasks/workflows or recommended retention change:
ED-05/ED-15 remain binding. Initial sizing guidance for the coordinator is two CPU cores,
4 GiB RAM and 10 GiB free local disk, excluding task tools, artifacts and history; these
are a starting installation allowance, not a throughput promise or workload admission
limit. The human selects worker/concurrency budgets; scheduler backpressure enforces
them and real resource availability. Low disk blocks new dispatch safely while preserving
control/recovery space. No automatic deletion may sacrifice active/unresolved evidence.

## Required matrix per release

Run the following on every claimed native cell and both image architectures. Record
OS build, CPU, runtime/dependency hashes, filesystem, auth/credential/containment adapter,
test revision and results in the release manifest. Test the minimum and the newest
claimed OS version separately. An untested cell remains planned, not passing.

1. Clean install, signature/integrity verification, owner enrollment, CLI/web parity,
   TLS/origin/CSRF tests, logout/revocation and provider outage.
2. Local child launch/IPC, handle inheritance, workspace isolation, Unicode/long paths,
   symlink/reparse attacks, permissions and secret absence from argv/logs/backups.
3. Same-parent concurrent reservation, worker stop/checkpoint, unknown outcome, task
   crash, coordinator crash, sleep/wake, clock adjustment and machine restart.
4. Upgrade from every supported engine schema, interrupted migration, incompatible
   schema rejection, verified backup/restore and retained outstanding responsibility.
5. Long waits releasing eligible slots, elapsed deadlines across downtime, low disk,
   large history/artifact paging and user-selected concurrency/backpressure.

Sources checked for the target choice: [Node v24 build/platform requirements](https://github.com/nodejs/node/blob/v24.x/BUILDING.md),
[Node release lifecycle](https://nodejs.org/en/about/previous-releases),
[Windows release lifecycle](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information),
[Apple Sequoia compatibility](https://support.apple.com/en-us/120282),
[Ubuntu lifecycle](https://ubuntu.com/about/release-cycle), and
[Debian releases](https://www.debian.org/releases/). Product floors and sizing allowances
are this project's choices, not upstream guarantees of engine correctness.
