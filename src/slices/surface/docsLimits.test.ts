/// <reference types="node" />
// The limits the docs state of surfaces against the constants Quay holds them to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const GUIDE = read("docs/guide/surfaces.md");
const CLIS = read("docs/features/agent-support.md");
const TOOLS = read("docs/features/a2a-orchestration.md");

/** The constant `name` of a Rust file: a number, a product of numbers, or a count of seconds. */
function rustConstant(file: string, name: string): number {
  const [, value] = new RegExp(`const ${name}: \\w+ = (?:Duration::from_secs\\()?([\\d_]+(?: \\* [\\d_]+)*)\\)?;`).exec(read(`src-tauri/src/slices/${file}`)) ?? [];
  assert.ok(value !== undefined, `${name} in ${file}`);
  return value.split(" * ").reduce((product, factor) => product * Number(factor.replace(/_/g, "")), 1);
}

const states = (page: string, words: string) => assert.ok(page.includes(words), words);

test("the surfaces page states how much a surface and a terminal may have", () => {
  const live = rustConstant("surface/place.rs", "MOST_LIVE");
  states(GUIDE, `| ${live} in the Surface view, ${live} in stage tabs and ${live} on its pane |`);
  states(GUIDE, `| Locked surfaces of one terminal | ${rustConstant("surface/store.rs", "MOST_LOCKED")};`);
  states(GUIDE, `| Components in a surface | ${rustConstant("surface/past_limit.rs", "MOST_COMPONENTS")} |`);
  const data = rustConstant("surface/past_limit.rs", "MOST_DATA");
  assert.equal(rustConstant("surface/unsent.rs", "UNSENT_LIMIT"), data);
  states(GUIDE, `| ${data / 1024} kB each |`);
  const image = rustConstant("surface/image_file.rs", "MOST_BYTES") / (1024 * 1024);
  states(GUIDE, `| Images in a surface | ${rustConstant("surface/past_limit.rs", "MOST_IMAGES")}, each up to ${image} MB |`);
});

test("the docs state how long a call waits, a CLI has to connect and a day's record is kept", () => {
  const wait = rustConstant("surface/timing.rs", "WAIT");
  for (const page of [GUIDE, TOOLS]) states(page, `up to ${wait} seconds`);
  const limit = rustConstant("surface/timing.rs", "CLI_LIMIT");
  states(CLIS, `to ${limit} seconds, so the ${wait}-second wait`);
  states(CLIS, `Where the ${limit} s limit is set`);
  const grace = rustConstant("pty/handshake.rs", "HANDSHAKE_GRACE");
  states(GUIDE, `${grace} seconds after it was launched`);
  states(GUIDE, `A connected Antigravity gets its ${grace} seconds`);
  states(GUIDE, `kept for ${rustConstant("surface/daily_record/writer.rs", "DAYS_KEPT")} days`);
});

test("the A2A page states how many errors a rejection lists", () => {
  states(TOOLS, `the first ${rustConstant("surface/rejection.rs", "MOST_LISTED")} errors`);
});
