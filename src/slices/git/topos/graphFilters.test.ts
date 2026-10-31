/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchRef,
  filterChips,
  graphRefSet,
  isRemoteRef,
  NO_FILTERS,
  pruneFilters,
  RESET,
  showOnly,
  toggleAgent,
  toggleBranch,
  type FilterState,
} from "./graphFilters.ts";
import type { RefBadge } from "./graphRefs.ts";

const none: FilterState = { filters: NO_FILTERS, agents: [] };

test("with no filter there are no chips and the graph walks its default ref set", () => {
  assert.deepEqual(filterChips(none), []);
  assert.deepEqual(graphRefSet(NO_FILTERS, "C:/repo/wt"), { kind: "branches" });
});

test("Show only on a local or remote badge filters to that one branch", () => {
  assert.equal(branchRef({ kind: "local", name: "main" }), "refs/heads/main");
  assert.equal(branchRef({ kind: "remote", name: "origin/main" }), "refs/remotes/origin/main");
  assert.equal(branchRef({ kind: "tag", name: "v1" }), null);
  assert.equal(branchRef({ kind: "head", name: "wt" }), null);
  assert.equal(isRemoteRef("refs/remotes/origin/main"), true);
  assert.equal(isRemoteRef("refs/heads/main"), false);

  const twoBranches = toggleBranch(toggleBranch(NO_FILTERS, "refs/heads/a"), "refs/heads/b");
  assert.deepEqual(showOnly(twoBranches, "refs/remotes/origin/main").branches, ["refs/remotes/origin/main"]);
});

test("each active filter is a chip with an accessible name, and removing it clears only that filter", () => {
  const state: FilterState = {
    filters: { branches: ["refs/heads/main", "refs/remotes/origin/topic"], remotes: false, tags: true },
    agents: ["claude"],
  };
  const chips = filterChips(state);
  assert.deepEqual(
    chips.map((c) => [c.label, c.name]),
    [
      ["main", "Remove branch filter main"],
      ["origin/topic", "Remove branch filter origin/topic"],
      ["Remotes hidden", "Show remotes again"],
      ["Tags shown", "Hide tags again"],
      ["Highlight claude", "Stop highlighting claude commits"],
    ]
  );
  assert.deepEqual(new Set(chips.map((c) => c.key)).size, chips.length, "chip keys are unique");

  const withoutMain = chips[0].remove(state);
  assert.deepEqual(withoutMain.filters.branches, ["refs/remotes/origin/topic"]);
  assert.equal(withoutMain.filters.remotes, false);
  assert.deepEqual(withoutMain.agents, ["claude"]);
  assert.equal(chips[2].remove(state).filters.remotes, true);
  assert.equal(chips[3].remove(state).filters.tags, false);
  assert.deepEqual(chips[4].remove(state).agents, []);
  assert.deepEqual(chips[4].remove(state).filters, state.filters);
});

test("Reset filters clears every filter and highlight", () => {
  assert.deepEqual(RESET, none);
  assert.deepEqual(filterChips(RESET), []);
});

test("toggling a branch or an agent kind twice leaves things as they were", () => {
  assert.deepEqual(toggleBranch(toggleBranch(NO_FILTERS, "refs/heads/x"), "refs/heads/x"), NO_FILTERS);
  assert.deepEqual(toggleAgent(toggleAgent([], "human"), "human"), []);
  assert.deepEqual(toggleAgent(["claude"], "human"), ["claude", "human"]);
});

test("a filter walks its branches, its toggles and the selected worktree's HEAD", () => {
  assert.deepEqual(graphRefSet({ branches: ["refs/heads/main"], remotes: true, tags: false }, "C:/repo/wt"), {
    kind: "filtered",
    branches: ["refs/heads/main"],
    remotes: true,
    tags: false,
    worktreePath: "C:/repo/wt",
  });
  assert.deepEqual(graphRefSet({ branches: [], remotes: false, tags: false }, null), {
    kind: "filtered",
    branches: [],
    remotes: false,
    tags: false,
    worktreePath: null,
  });
});

test("pruning drops filtered branches the refs no longer list, and keeps the same filters when none went", () => {
  const refs: RefBadge[] = [
    { kind: "local", name: "main", oid: "a" },
    { kind: "remote", name: "origin/main", oid: "a" },
    { kind: "tag", name: "gone", oid: "b" },
  ];
  const filters = { branches: ["refs/heads/main", "refs/heads/gone", "refs/remotes/origin/main"], remotes: false, tags: true };
  assert.deepEqual(pruneFilters(filters, refs), { branches: ["refs/heads/main", "refs/remotes/origin/main"], remotes: false, tags: true });
  const kept = { ...filters, branches: ["refs/heads/main"] };
  assert.equal(pruneFilters(kept, refs), kept);
  // A tag of the same name is not the branch.
  assert.deepEqual(pruneFilters({ ...filters, branches: ["refs/heads/gone"] }, refs).branches, []);
});
