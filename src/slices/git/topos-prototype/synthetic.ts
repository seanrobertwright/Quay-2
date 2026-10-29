// PROTOTYPE (#351). A deterministic fake history: main, a long-lived develop,
// feature branches that fork, commit, merge (two-parent and octopus), pull main
// back in, or get abandoned. Built oldest-first with rising timestamps, then
// reversed, so the output is a valid date order (every child before its parents).

import type { Commit, Ref } from "./lanes";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeOid(id: number): string {
  let out = "";
  let x = (id + 1) * 0x9e3779b1;
  for (let i = 0; i < 5; i++) {
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0x45d9f3b) >>> 0;
    out += (x >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

const WORDS = ["lane", "ribbon", "badge", "stage", "rail", "diff", "hunk", "merge", "graph", "cache", "index",
  "status", "theme", "palette", "overlay", "worker", "stream", "socket", "parser", "layout", "scroll", "zoom"];
const AUTHORS = ["Ada", "Grace", "Linus", "Margaret", "Ken", "Barbara", "Edsger", "Frances", "Claude", "Codex"];
const VERBS = ["Fix", "Add", "Refactor", "Tidy", "Speed up", "Document", "Test", "Rename", "Remove", "Guard"];

interface Branch {
  name: string;
  head: number;
  own: number;
}

export interface SyntheticHistory {
  commits: Commit[];
  refs: Ref[];
  defaultBranch: string;
}

export function synthesize(total: number, concurrency: number, seed: number): SyntheticHistory {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const parents: number[][] = [];
  const subjects: string[] = [];
  const authors: string[] = [];
  const times: number[] = [];
  let time = 1_600_000_000;
  let serial = 0;

  const commit = (ps: number[], subject: string): number => {
    time += 30 + Math.floor(rng() * 3600);
    parents.push(ps);
    subjects.push(subject);
    authors.push(pick(AUTHORS));
    times.push(time);
    return parents.length - 1;
  };
  const message = () => `${pick(VERBS)} ${pick(WORDS)} ${pick(WORDS)}`;

  let main = commit([], "Initial commit");
  const develop: Branch = { name: "develop", head: main, own: 0 };
  const active: Branch[] = [];
  const tags: { id: number; name: string }[] = [];

  while (parents.length < total) {
    const r = rng();
    if (active.length < concurrency && r < 0.25) {
      const from = rng() < 0.15 && active.length > 0 ? pick(active).head : rng() < 0.3 ? develop.head : main;
      active.push({ name: `feature/${pick(WORDS)}-${serial++}`, head: from, own: 0 });
      continue;
    }
    const ready = active.filter((b) => b.own > 0);
    const a = rng();
    if (a < 0.5 && active.length > 0) {
      const b = pick(active);
      b.head = commit([b.head], message());
      b.own++;
    } else if (a < 0.62) {
      main = commit([main], message());
      if (parents.length % 400 === 0) tags.push({ id: main, name: `v0.${tags.length}.0` });
    } else if (a < 0.7) {
      develop.head = commit([develop.head], message());
      develop.own++;
    } else if (a < 0.8 && ready.length > 0) {
      const b = pick(ready);
      const pr = rng() < 0.5;
      main = commit([main, b.head], pr ? `Merge pull request #${serial++} from team/${b.name}` : `Merge branch '${b.name}'`);
      if (rng() < 0.8) active.splice(active.indexOf(b), 1);
      else b.own = 0;
    } else if (a < 0.82 && ready.length >= 3) {
      const group = ready.slice(0, 2 + Math.floor(rng() * 2));
      const names = group.map((b) => `'${b.name}'`);
      const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      main = commit([main, ...group.map((b) => b.head)], `Merge branches ${list}`);
      for (const b of group) active.splice(active.indexOf(b), 1);
    } else if (a < 0.86 && ready.length > 0) {
      const b = pick(ready);
      b.head = commit([b.head, main], `Merge branch 'main' into ${b.name}`);
    } else if (a < 0.88 && develop.own > 0) {
      main = commit([main, develop.head], "Merge branch 'develop'");
      develop.own = 0;
    } else if (a < 0.9 && active.length > 0) {
      active.splice(Math.floor(rng() * active.length), 1); // abandoned: unreachable unless merged, so it drops out
    } else {
      main = commit([main], message());
    }
  }

  const n = parents.length;
  const oids = Array.from({ length: n }, (_, i) => fakeOid(i));
  const commits: Commit[] = [];
  for (let i = n - 1; i >= 0; i--) {
    commits.push({ oid: oids[i], parents: parents[i].map((p) => oids[p]), author: authors[i], time: times[i], subject: subjects[i] });
  }
  const refs: Ref[] = [
    { oid: oids[main], name: "refs/heads/main", current: true },
    { oid: oids[parents[main][0] ?? main], name: "refs/remotes/origin/main", current: false },
    { oid: oids[develop.head], name: "refs/heads/develop", current: false },
    ...active.map((b) => ({ oid: oids[b.head], name: `refs/heads/${b.name}`, current: false })),
    ...active.filter(() => rng() < 0.5).map((b) => ({ oid: oids[b.head], name: `refs/remotes/origin/${b.name}`, current: false })),
    ...tags.map((t) => ({ oid: oids[t.id], name: `refs/tags/${t.name}`, current: false })),
  ];
  // Only commits reachable from a ref belong in `git log --branches --remotes --tags HEAD`.
  const reachable = new Set<string>();
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  const stack = refs.map((r) => r.oid);
  while (stack.length > 0) {
    const oid = stack.pop()!;
    if (reachable.has(oid)) continue;
    reachable.add(oid);
    for (const p of byOid.get(oid)!.parents) stack.push(p);
  }
  return { commits: commits.filter((c) => reachable.has(c.oid)), refs, defaultBranch: "main" };
}
