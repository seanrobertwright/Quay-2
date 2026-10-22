# Operating systems and Linux

> **Load when:** writing or reviewing code that talks to the OS directly (files and descriptors,
> fork/exec, pipes, signals, mmap, fsync, setuid, temp files, process limits), writing shell
> scripts, systemd units, cron jobs, or container entrypoints, persisting data that must survive
> a crash or power loss, administering or debugging a Linux host (permissions, services, logs, a
> full disk, memory pressure, a process that will not start or will not die), or building and
> installing native software.
> **See also:** [Concurrency and parallelism](../concurrency/concurrency.md),
> [Containers and Docker](../devops/containers.md),
> [Application and API security](../security/application-security.md),
> [Debugging](../core/debugging.md),
> [Observability and reliability](../operations/observability-and-reliability.md),
> [Networking and IoT protocols](networking.md),
> [Distributed systems](../distributed/distributed-systems.md),
> [Database operations, internals, and high availability](../data/database-operations.md),
> [Code and module design](../core/code-design.md)

## Top rules

1. **Never report data as saved because `write()` returned.** It only reached
   the page cache. To replace a file durably, write a temp file in the same
   directory, `fsync` it, `rename` it over the target, then `fsync` the
   directory; check the results of `fsync` and `close`, and treat a failed
   `fsync` as lost data, not as something to retry. *[Doeppner-OSiD ch. 6,
   6.2.1; Bach-UNIX ch. 3, 3.4; Lions ch. 17, 17.2; MOS5 ch. 4, 4.4.4;
   OSCE2 ch. 11, 11.6.2; HLW3 ch. 4, 4.2.5]*
2. **Never pass a string built from external input to a shell.** Use an
   argument vector (`execve`, `posix_spawn`, `subprocess.run([...])`) or the
   library call itself; a semicolon in a "file name" runs commands with your
   privileges. In scripts, quote every expansion and validate any value placed
   in `export` or `eval` as an identifier first. *[MOS5 ch. 9, 9.5.7; HLW3
   ch. 11, 11.2; Review lessons]*
3. **Act on descriptors, not on paths you checked earlier.** Open first and
   then `fstat` the descriptor; use `O_CREAT|O_EXCL` for "must be new" and
   `O_NOFOLLOW` or `openat` in untrusted directories; never `access()` then
   `open()`. A symlink swapped in between is the classic TOCTOU attack.
   *[MOS5 ch. 9, 9.5.8; Doeppner-OSiD ch. 8, 8.2.1; Bach-UNIX ch. 5, 5.16.2]*
4. **Run every process with only the privilege its task needs.** Use `sudo`
   per command rather than a root shell, capabilities rather than full root,
   and drop elevated IDs irrevocably once the privileged step is done.
   *[Doeppner-OSiD ch. 8, 8.2; OSCE2 ch. 13, 13.2; Bach-UNIX ch. 7, 7.6;
   HLW3 ch. 2, 2.20; MOS5 ch. 9, 9.1.2]*
5. **Reap every child process, and give containers a PID 1 that reaps.**
   Unreaped children stay zombies holding process-table slots, and a reused
   PID makes a late `wait` or `kill` hit an unrelated process. Loop on
   `waitpid(..., WNOHANG)` in the SIGCHLD path, signal through a pidfd
   (`pidfd_open`, Linux 5.3+) rather than a stored PID, and run `tini` or
   `--init` as PID 1. *[Bach-UNIX ch. 7, 7.3-7.4; Lions ch. 13, 13.18-13.20;
   xv6 ch. 6, 6.8; Doeppner-OSiD ch. 2, 2.2.1.4; OSCE2 ch. 3, 3.3.2; HLW3
   ch. 17, 17.2.2; pidfd_open(2)]*
6. **Do almost nothing inside a signal handler.** Call only async-signal-safe
   functions (no locks, no `malloc`, no logging); set a flag or write to a
   self-pipe, or receive signals synchronously with `signalfd` or `sigwait`.
   Install handlers with `sigaction`, never the old `signal()`.
   *[Doeppner-OSiD ch. 2, 2.2.5.1; Bach-UNIX ch. 7, 7.2.1; Lions ch. 9, 9.6]*
7. **Check every system call's result, and loop on short reads, short writes,
   and `EINTR`.** Pipes, sockets, and terminals return what is available;
   `poll`, `select`, and sleeps fail with `EINTR` even under `SA_RESTART`.
   *[Bach-UNIX Preface; ch. 5, 5.12.3; ch. 6, 6.6.2; OSCE2 ch. 12, 12.3.4]*
8. **Create temp files and secret files with `mkstemp`/`mktemp`, mode 0600,
   and remove them in an EXIT trap.** Predictable names in `/tmp` invite
   symlink attacks and collisions. *[HLW3 ch. 11, 11.8; Lions ch. 18, 18.15;
   Review lessons]*
9. **Open every descriptor close-on-exec, and close the pipe ends a process
   does not use.** A stray inherited write end means the reader never sees
   EOF, and leaked descriptors reach every program you exec. *[Bach-UNIX
   ch. 5, 5.12.4; Lions ch. 21, 21.2; xv6 ch. 1, 1.3]*
10. **Diagnose from evidence before changing anything.** Fix the first error
    in the output, read the journal for the unit, and run the program under
    `strace -f` to see the failing call; do not add packages or settings until
    something works. *[HLW3 ch. 2, 2.15; ch. 7, 7.1; ch. 8, 8.3; ch. 17,
    17.2.5; Lions ch. 1, 1.9]*

## Files, descriptors, and I/O

- **Pass an explicit restrictive mode on create and set the umask on
  purpose.** The final mode is the requested mode masked by the umask; use 077
  for private data, 022 where daemons must read, and never world-writable.
  *[Doeppner-OSiD ch. 1, 1.3.5.7; HLW3 ch. 2, 2.17.1; ch. 13, 13.3.5]*
- **Remember that a forked child shares each inherited file offset, and
  separate opens do not.** Use `dup` (`2>&1`) to point two streams at one
  file and `O_APPEND` for shared logs. *[Doeppner-OSiD ch. 1, 1.3.5;
  Bach-UNIX ch. 7, 7.1; xv6 ch. 1, 1.2]*
- **Keep each record under `PIPE_BUF` when several writers share a pipe.**
  Only writes up to that size are atomic. *[Bach-UNIX ch. 5, 5.12.3]*
- **Ignore SIGPIPE in long-running servers and handle `EPIPE`.** The default
  kills the process on a write to a closed peer; use `MSG_NOSIGNAL` on
  sockets. *[Lions ch. 21, 21.3]*
- **Look for deleted-but-open files when a disk stays full after cleanup.**
  Space is freed only when the last descriptor closes; find holders with
  `lsof +L1`, and make log writers reopen files after rotation. *[Lions
  ch. 18, 18.14-18.15; HLW3 ch. 7, 7.1.3]*
- **Use `O_TMPFILE` or `tmpfile()` for scratch data that must vanish on a
  crash.** It never has a visible name. *[Bach-UNIX ch. 5, 5.16.2; Lions
  ch. 18, 18.15]*
- **Choose `mmap` for large, random-access, or shared file data and
  `read`/`write` for small files or private copies.** Stores into a shared
  mapping are not durable until `msync(MS_SYNC)` or `fsync` returns success.
  *[OSPP-III ch. 9, 9.6; OSCE2 ch. 8, 8.7; Doeppner-OSiD ch. 4]*
- **Prefer descriptor-based IPC (pipes, Unix domain sockets, `memfd`,
  `eventfd`) over System V IPC, and TCP on localhost.** System V objects have
  no close, so crashed programs leave them behind; Unix sockets are guarded
  by file permissions. *[Bach-UNIX ch. 11, 11.2.4; HLW3 ch. 10, 10.10;
  OSCE2 ch. 3, 3.4]*
- **Assume Unix file locks are advisory and use `fcntl` or `flock`.** Every
  cooperating process must take them; the kernel drops them when the holder
  dies. Linux has no mandatory locking. *[OSCE2 ch. 10, 10.1.2; Bach-UNIX
  ch. 11, 11.2.3]*
- **Guard cron jobs and periodic tasks against overlapping runs with a real
  lock (`flock`, a database advisory lock), not an in-memory flag.**
  *[Lions ch. 20, 20.9; Review lessons]*
- **Keep build trees and small-file workloads off network file systems, and
  know their consistency model.** Close-to-open semantics hide other
  clients' writes until reopen. *[OSCE2 ch. 10, 10.5.3; HLW3 ch. 12, 12.3.1]*
- **Never write to a raw device or another layer's files while their owner
  is live.** When using `dd`, bound it with `count` and test on a scratch
  file first. *[Bach-UNIX ch. 10, 10.2; HLW3 ch. 3, 3.3]*

## Durability and crash consistency

- **Pick one crash strategy per persistent structure and write it down:
  ordered writes, a write-ahead log, or copy-on-write with one atomic root
  switch.** Mixing them without a design is how corruption gets in.
  *[Doeppner-OSiD ch. 6, 6.2.2; OSCE2 ch. 11, 11.7; MOS5 ch. 4, 4.3.6]*
- **Make the target durable before any durable pointer to it exists.** Write
  the node, then the link; add a new reference before removing the old one;
  durably clear old references before reusing an id. A crash then leaves a
  leak, never a dangling reference. *[Doeppner-OSiD ch. 6, 6.2.2.1;
  Bach-UNIX ch. 5, 5.16.1]*
- **Give a write-ahead log a commit record, idempotent replay, and space
  reserved before the operation starts.** "Mark block free" replays safely;
  "append to free list" does not. *[xv6 ch. 7, 7.4-7.6; MOS5 ch. 4, 4.3.6]*
- **Do not rely on filesystem journaling for your file contents.** Most
  filesystems journal only metadata. *[Doeppner-OSiD ch. 6, 6.2.2.2]*
- **Do every step that can fail before destroying the old state, then commit
  in one step that cannot fail.** *[xv6 ch. 3, 3.8; Lions ch. 12, 12.7;
  MOS5 ch. 12, 12.3.9]*
- **Design for SIGKILL and power loss: cleanup must not depend on a handler
  running.** Use atomic renames and journals, and recover leftovers on the
  next start. *[Lions ch. 13, 13.13; Doeppner-OSiD ch. 6, 6.2.2]*
- **Add end-to-end checksums and tested backups; RAID and replication are
  not integrity.** They do not catch misdirected writes or software that
  overwrites good data. *[Doeppner-OSiD ch. 6, 6.6.6; OSCE2 ch. 9, 9.7.6;
  ch. 11, 11.7.4; MOS5 ch. 4, 4.4.2]*
- **After fixing one missing `fsync`, grep every sibling write path, and make
  any "saved" text in docstrings, logs, or UI match the code.** *[Review
  lessons; Doeppner-OSiD ch. 6, 6.2.1]*

## Processes and signals

- **In a multithreaded process, fork only to exec at once, or use
  `posix_spawn`.** The child gets only the calling thread and may call only
  async-signal-safe functions before exec. *[OSCE2 ch. 4, 4.6.1;
  Doeppner-OSiD ch. 7, 7.3.3]*
- **Wire a child's stdin, stdout, and stderr between fork and exec, or with
  `posix_spawn` file actions.** *[Bach-UNIX ch. 7, 7.5; xv6 ch. 1, 1.1]*
- **Block asynchronous signals in every thread and receive them in one place
  (`sigwait`, `signalfd`, or a self-pipe in the event loop).** Signals then
  become ordinary input. *[Doeppner-OSiD ch. 2, 2.2.5.1; OSCE2 ch. 4, 4.6.2]*
- **Treat a signal as "something happened", never as a count.** Standard
  signals coalesce; drain the real state when one arrives. *[Lions ch. 13,
  13.2-13.3]*
- **Check for a pending event and sleep atomically.** `alarm` then `pause`
  loses a signal that arrives in between; use `sigsuspend`, `ppoll`, or
  `signalfd`. *[Bach-UNIX ch. 6, 6.6.2]*
- **Stop processes with TERM and use KILL only as a last resort; when a
  process will not die, inspect its wait (`D` state, `/proc/<pid>/stack`)
  instead of repeating `kill -9`.** *[HLW3 ch. 2, 2.16.2; Lions ch. 8, 8.11]*
- **Run long-lived jobs under a service manager with all three standard
  streams redirected, not under `nohup` in a terminal.** *[HLW3 ch. 2,
  2.16.4]*
- **Use thread-safe `_r` libc variants and thread-local storage instead of
  static result buffers.** Thread rules beyond the OS boundary are in the
  concurrency file. *[Doeppner-OSiD ch. 2, 2.2.4; MOS5 ch. 2, 2.2.7]*

## Shell scripts

- **Keep shell scripts short and switch to a real language once you need
  parsing, arithmetic, or data structures.** *[HLW3 ch. 11, 11.1.1, 11.14]*
- **Start non-trivial scripts with `set -euo pipefail` and lint them with
  ShellCheck as an error-level gate.** Current practice; the shell chapter
  predates both. *[Review lessons]*
- **Quote every expansion (`"$var"`, `"$@"`) and single-quote literal
  patterns.** Unquoted values split, glob, and break `[` tests when empty.
  *[HLW3 ch. 11, 11.2, 11.5.1]*
- **Parse arguments and environment variables at the top and fail fast** on
  empty, non-numeric, or out-of-range values with a clear message.
  *[Review lessons]*
- **Test `$?` immediately and read the exit-code contract.** `grep` and
  `diff` return 1 for "no match" and 2 for a real error. *[HLW3 ch. 11,
  11.4]*
- **Pass file lists null-delimited (`find -print0 | xargs -0`, `find -exec`)
  and put `--` before file arguments.** Never parse `$(ls)`. *[HLW3 ch. 11,
  11.7, 11.10.4]*
- **Dry-run `rsync --delete` with `-nv` and decide on the trailing slash on
  purpose.** `dir/` copies contents; `dir` copies the directory. *[HLW3
  ch. 12, 12.2.2-12.2.5]*
- **Keep shared startup files short and silent.** Never print, set
  `LD_LIBRARY_PATH`, or alias default flags in them. *[HLW3 ch. 13,
  13.1-13.6]*

## Privilege, permissions, and hardening

- **Edit sudoers only with `visudo` and scope rules to commands.**
  Passwordless rules belong only to narrow automation accounts. *[HLW3
  ch. 2, 2.20.2]*
- **Keep setuid binaries few, never setuid an interpreter, and verify a
  privilege drop with `getresuid`.** *[HLW3 ch. 7, 7.9.2; Bach-UNIX ch. 7,
  7.6; Doeppner-OSiD ch. 8, 8.2.1]*
- **Hand privileged helpers open descriptors, not names to resolve.** A
  helper resolving names with its own rights is a confused deputy.
  *[Doeppner-OSiD ch. 8, 8.2.3; OSCE2 ch. 15, 15.11.2]*
- **Never treat `chroot` as a security boundary.** Use namespaces, seccomp,
  dropped capabilities, or a VM. *[Doeppner-OSiD ch. 8, 8.2.1]*
- **Never put `.` or a user-writable directory in `PATH`; call privileged
  helpers by absolute path.** *[HLW3 ch. 13, 13.3.1; OSCE2 ch. 14, 14.2.1]*
- **Audit permissions knowing only the first matching class applies.** Mode
  077 denies the owner. *[Lions ch. 19, 19.10]*
- **Read users and groups through NSS (`getpwuid`) and authenticate through
  PAM, never by parsing `/etc/passwd`.** *[HLW3 ch. 7, 7.9.4, 7.10]*
- **Copy untrusted data across a privilege boundary once, then validate the
  copy with overflow checks on size arithmetic; check root callers and your
  own on-disk data the same way.** Re-reading a length from caller memory is
  a double-fetch bug. *[MOS5 ch. 9, 9.5.6, 9.5.9; xv6 ch. 3, 3.8; ch. 4, 4.6;
  Lions ch. 19, 19.9; ch. 20, 20.12]*
- **Reject unknown codes at every dispatch table, and let the privileged
  side choose its entry points.** Undocumented ioctl or admin codes are trap
  doors. *[Lions ch. 12, 12.4; Doeppner-OSiD ch. 8, 8.1.1; xv6 ch. 2, 2.2]*
- **Leave W^X, ASLR, and stack protectors on; build native code as PIE with
  `-fstack-protector-strong` and `-D_FORTIFY_SOURCE=3` (current flags).**
  *[MOS5 ch. 9, 9.8.3; OSCE2 ch. 14, 14.2.4]*
- **Run as few network services as possible behind a default-deny
  firewall, loaded atomically (`nft -f`) on remote hosts.** A DROP typed one
  rule at a time locks you out. *[HLW3 ch. 9, 9.25.3; ch. 10, 10.7]*
- **Set `PermitRootLogin no` and (current practice) `PasswordAuthentication
  no` in `sshd_config`, and throttle failed attempts.** *[HLW3 ch. 10, 10.3.2-10.3.3]*

## Services, configuration, and time

- **Put local changes in `/etc`, preferably as `*.d` drop-ins, never in
  vendor files under `/usr` or `/lib`, and edit the generator of any
  generated file.** Upgrades overwrite the vendor side. *[HLW3 ch. 6, 6.3.3;
  ch. 7, 7.2, 7.10.2]*
- **Use `Wants=` unless failure must propagate, and `After=` only where order
  matters.** `Requires=` spreads one unit's failure. *[HLW3 ch. 6, 6.3.6]*
- **Set `Type=notify` when dependents need the service ready, otherwise
  `Type=exec`; avoid `simple` in new units.** `simple` reports "started" at
  fork, so a missing binary looks like success; `exec` (newer than the book)
  waits for `execve`. *[HLW3 ch. 6, 6.3.5; systemd.service(5)]*
- **Sandbox every service unit (`NoNewPrivileges=yes`, `ProtectSystem=strict`,
  `PrivateTmp=yes`, a narrow `CapabilityBoundingSet=`, or `DynamicUser=yes`)
  and check it with `systemd-analyze security <unit>`.** *[systemd.exec(5);
  systemd-analyze(1)]*
- **Run `systemctl daemon-reload` after editing a unit and `enable` units
  with an `[Install]` section.** *[HLW3 ch. 6, 6.3.4]*
- **Prefer systemd timers to cron for system jobs.** They log to the journal
  and get process tracking. *[HLW3 ch. 7, 7.6.4, 7.8]*
- **Keep the hardware clock in UTC, correct drift with NTP, and measure
  durations with a monotonic clock.** Wall time can jump; route calendar time
  through one date helper that treats zone-less strings as UTC. *[HLW3 ch. 7,
  7.5; Bach-UNIX ch. 8, 8.3.5; Review lessons]*
- **Reference filesystems by UUID or label, never `/dev/sdX`, and never
  `fsck` a mounted read-write filesystem.** *[HLW3 ch. 4, 4.2.4, 4.2.8,
  4.2.11; Lions ch. 20, 20.6]*

## Memory and resource limits

- **Do not assume a successful allocation is backed.** Linux overcommits, so
  exhaustion arrives later as an OOM kill; critical services reserve and
  touch memory at startup. *[Doeppner-OSiD ch. 7, 7.3.4]*
- **Treat paging to storage as a failure to alert on.** Watch major faults,
  swap-in, and memory pressure stall time (`/proc/pressure/memory`, or
  `memory.pressure` per cgroup; PSI is newer than the books), not free
  memory. *[OSPP-III ch. 9, 9.7; HLW3 ch. 8, 8.5.4; OSCE2 ch. 8, 8.6]*
- **When working sets exceed RAM, shed or suspend work instead of adding
  parallelism.** *[OSPP-III ch. 9, 9.7.2; Doeppner-OSiD ch. 7, 7.3.1;
  Bach-UNIX ch. 9, 9.3]*
- **Give each tenant a hard memory limit (cgroup v2) and tell inner memory
  managers their real budget.** Size heaps and buffer pools to the container
  limit; on current JVMs use `-XX:MaxRAMPercentage`, not a host-sized `-Xmx`.
  *[OSPP-III ch. 9, 9.7.1; ch. 10, 10.5]*
- **Read load average relative to core count, and attribute memory with PSS,
  not summed RSS.** *[HLW3 ch. 8, 8.5.3; Bach-UNIX ch. 8, 8.3.4]*
- **Use separate high and low watermarks for reclaim, eviction, and
  autoscaling triggers.** One threshold oscillates. *[Bach-UNIX ch. 9,
  9.2.2; Lions ch. 14, 14.2]*

## Performance, building, and containers

- **Traverse large arrays in storage order.** Column-wise walks of row-major
  data touch a new page per access. *[OSPP-III ch. 8, 8.3.2; OSCE2 ch. 8,
  8.9.5]*
- **Cut I/O cost with batching, vectored I/O, and `sendfile`, `splice`, or
  `io_uring` for large streams; never modify a buffer while its I/O is in
  flight.** Keep a fallback: Docker's default seccomp profile blocks
  `io_uring`. *[OSCE2 ch. 12, 12.7, 12.4.2; OSPP-III ch. 10, 10.1; Docker seccomp]*
- **Benchmark cold and warm, and repeat across separate runs.**
  *[OSPP-III ch. 9, 9.3.1, 9.4]*
- **Trace production with eBPF tools and `perf`, not breakpoints or
  permanent debug prints, and keep core dumps.** *[OSCE2 ch. 2, 2.8.1, 2.8.3]*
- **Never set `LD_LIBRARY_PATH` globally; embed the path with `-Wl,-rpath`
  (`$ORIGIN` for relocatable builds).** *[HLW3 ch. 15, 15.1.3]*
- **Install self-built software under its own prefix or as a package, never
  over distribution files, and isolate language dependencies in a `venv`.**
  *[HLW3 ch. 16, 16.4; ch. 17, 17.3]*
- **Pin container base images by digest, keep data and logs out of the
  writable layer, set CPU and memory limits, and run rootless where you
  can.** *[HLW3 ch. 17, 17.2.1, 17.2.5]*

## Tensions

- **`fork` versus `posix_spawn`.** The classic sources treat fork plus exec
  as the way to create processes. This library uses `posix_spawn` (or fork
  followed at once by exec) in multithreaded or large processes.
  *[Bach-UNIX ch. 7; OSCE2 ch. 4, 4.6.1]*
- **`mmap` versus explicit I/O for buffer management.** The OS text favours
  letting the kernel manage mapped pages. This library uses mmap for
  read-mostly data and `pread`/`pwrite` with `fsync` when the program must
  control write order and see I/O errors. *[OSPP-III ch. 9, 9.6]*
- **Swap versus no swap.** Swapless hosts go straight to the OOM killer. Keep
  small swap or zram on general hosts; go swapless only where monitoring and
  load balancing keep nodes off the edge. *[HLW3 ch. 4, 4.3.3]*
- **Huge pages versus latency.** Transparent huge pages can cause compaction
  stalls. Use explicit huge pages for large hot regions, and follow a
  datastore's advice to disable THP. *[OSPP-III ch. 8, 8.3.2]*
- **Threads per stream versus an event loop.** Use blocking threads for a few
  streams and an event loop or async runtime at high connection counts,
  never blocking inside a handler. *[Doeppner-OSiD ch. 2, 2.1; MOS5 ch. 2,
  2.3]*
- **Fail-stop panic versus graceful degradation.** Kernels panic on broken
  invariants; services crash only the failing process and let a supervisor
  restart it. *[Lions ch. 5, 5.10; xv6 ch. 7, 7.15]*

## Sources

- **HLW3**: How Linux Works: What Every Superuser Should Know, 3rd Edition (Brian Ward; No Starch Press, 2021)
- **OSPP-III**: Operating Systems: Principles and Practice, 2nd Edition, Volume III: Memory Management (Thomas Anderson, Michael Dahlin)
- **MOS5**: Modern Operating Systems, 5th Edition (Andrew S. Tanenbaum, Herbert Bos)
- **OSCE2**: Operating System Concepts Essentials, 2nd Edition (Abraham Silberschatz, Peter B. Galvin, Greg Gagne; Wiley, 2014)
- **Doeppner-OSiD**: Operating Systems in Depth (Thomas W. Doeppner; Wiley, 2011)
- **Bach-UNIX**: The Design of the UNIX Operating System (Maurice J. Bach; Prentice-Hall, 1986)
- **Lions**: A Commentary on the Sixth Edition UNIX Operating System (John Lions; University of New South Wales, 1977)
- **xv6**: xv6: a simple, Unix-like teaching operating system (Russ Cox, Frans Kaashoek, Robert Morris; RISC-V edition)
- **Review lessons**: rules distilled from the maintainer's code-review findings
- **systemd.service(5)**: systemd manual, systemd.service (<https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html>)
- **systemd.exec(5)**: systemd manual, systemd.exec (<https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html>)
- **systemd-analyze(1)**: systemd manual, systemd-analyze (<https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html>)
- **pidfd_open(2)**: Linux man-pages, pidfd_open(2) (<https://man7.org/linux/man-pages/man2/pidfd_open.2.html>)
- **Docker seccomp**: Docker documentation, Seccomp security profiles for Docker (<https://docs.docker.com/engine/security/seccomp/>)
