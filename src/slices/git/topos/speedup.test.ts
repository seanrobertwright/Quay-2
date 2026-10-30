import { test } from "node:test";
import assert from "node:assert/strict";
import { offerSpeedup, progressLine, SPEEDUP_COMMANDS, type SpeedupCheck } from "./speedup.ts";

const everything: SpeedupCheck = { items: ["commitGraph", "fsmonitor", "untrackedCache"], suppressed: false };
const quiet = { slowFirstRows: false, rowsLoaded: 120, moreRemain: false, dismissed: false };

test("a repo whose first rows took longer than 1 s is offered the speed-ups", () => {
  assert.equal(offerSpeedup(everything, quiet), false);
  assert.equal(offerSpeedup(everything, { ...quiet, slowFirstRows: true }), true);
  // Slow first rows warrant the banner even when a commit-graph is already there.
  assert.equal(offerSpeedup({ items: ["untrackedCache"], suppressed: false }, { ...quiet, slowFirstRows: true }), true);
});

test("a repo with more than 50k commits is offered the speed-ups only while it has no commit-graph", () => {
  const large = { ...quiet, rowsLoaded: 50_000, moreRemain: true };
  assert.equal(offerSpeedup(everything, large), true);
  assert.equal(offerSpeedup(everything, { ...quiet, rowsLoaded: 50_001 }), true);
  // Exactly 50k commits, all loaded, is not more than 50k.
  assert.equal(offerSpeedup(everything, { ...quiet, rowsLoaded: 50_000 }), false);
  assert.equal(offerSpeedup({ items: ["fsmonitor", "untrackedCache"], suppressed: false }, large), false);
});

test("the banner stays away when the repo is suppressed, dismissed, unchecked or has nothing left", () => {
  const slow = { ...quiet, slowFirstRows: true };
  assert.equal(offerSpeedup({ ...everything, suppressed: true }, slow), false);
  assert.equal(offerSpeedup(everything, { ...slow, dismissed: true }), false);
  assert.equal(offerSpeedup(null, slow), false);
  assert.equal(offerSpeedup({ items: [], suppressed: false }, slow), false);
});

test("each item shows the exact command #369 names", () => {
  assert.deepEqual(SPEEDUP_COMMANDS, {
    commitGraph: "git commit-graph write --reachable --split",
    fsmonitor: "git config core.fsmonitor true",
    untrackedCache: "git config core.untrackedCache true",
  });
});

test("the dialog's progress line follows the job's progress events", () => {
  assert.equal(progressLine({ event: "progress", phase: "Writing out commit graph in 3 passes", percent: 45 }), "Writing out commit graph in 3 passes: 45%");
  assert.equal(progressLine({ event: "progress", phase: "Setting core.untrackedCache" }), "Setting core.untrackedCache…");
  assert.equal(progressLine({ event: "stalled" }), "git has printed nothing for 30 s; it is still running.");
  assert.equal(progressLine({ event: "output", chunk: "warning: x\n" }), null);
  assert.equal(progressLine({ event: "done" }), null);
});
