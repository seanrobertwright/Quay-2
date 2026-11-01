import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunPageAddress, openRunPage, openRunPageOf } from "./runPage.ts";

test("a run page on the local host's https port is a run page address", () => {
  assert.equal(isRunPageAddress("https://127.0.0.1:7443/"), true);
  assert.equal(isRunPageAddress("https://127.0.0.1:7443/#/runs/wo-6f1c2d3e"), true);
  assert.equal(isRunPageAddress("https://127.0.0.1:1/runs/x?y=1"), true);
});

test("a run page on the host's browser origin, as praxis gives it, is a run page address", () => {
  assert.equal(isRunPageAddress("https://praxis-abcdefghij.localhost:7443/#work-order=wo-1"), true);
  assert.equal(isRunPageAddress("https://praxis-a2b3c4d5e7.localhost:51234/#work-order=wo%3A6f1c"), true);
});

test("any other address is refused", () => {
  for (const address of [
    "http://127.0.0.1:7443/",
    "https://127.0.0.1/",
    "https://127.0.0.1:7443",
    "https://127.0.0.1:0/",
    "https://127.0.0.1:65536/",
    "https://127.0.0.1.example.com:7443/",
    "https://evil.example@127.0.0.1:7443/",
    "https://127.0.0.1:7443@evil.example/",
    "https://localhost:7443/",
    "https://praxis-abcdefghi.localhost:7443/",
    "https://praxis-abcdefghijk.localhost:7443/",
    "https://praxis-ABCDEFGHIJ.localhost:7443/",
    "https://praxis-abcdefgh01.localhost:7443/",
    "https://praxis-abcdefghij.localhost/",
    "https://praxis-abcdefghij.localhost:7443",
    "http://praxis-abcdefghij.localhost:7443/",
    "https://praxis-abcdefghij.localhost.example.com:7443/",
    "https://x.praxis-abcdefghij.localhost:7443/",
    "https://evil.example@praxis-abcdefghij.localhost:7443/",
    "https://praxis-abcdefghij.localhost:7443@evil.example/",
    "https://127.0.0.2:7443/",
    " https://127.0.0.1:7443/",
    "https://127.0.0.1:7443/\nx",
    "javascript:alert(1)",
    "file:///C:/x",
    "",
  ]) {
    assert.equal(isRunPageAddress(address), false, address);
  }
});

test("opening a run page hands the address to the opener", async () => {
  const opened: string[] = [];
  assert.equal(await openRunPage("https://127.0.0.1:7443/#/runs/wo-1", async (url) => void opened.push(url)), true);
  assert.deepEqual(opened, ["https://127.0.0.1:7443/#/runs/wo-1"]);
});

test("a refused address never reaches the opener", async () => {
  const opened: string[] = [];
  assert.equal(await openRunPage("https://example.com/", async (url) => void opened.push(url)), false);
  assert.deepEqual(opened, []);
});

test("a run's page opens at the address praxis gave, without a lookup", async () => {
  const opened: string[] = [];
  const lookup = async () => assert.fail("looked up an address it already had");
  assert.equal(await openRunPageOf("run-1", "https://127.0.0.1:7443/#/runs/wo-1", lookup, async (url) => void opened.push(url)), null);
  assert.deepEqual(opened, ["https://127.0.0.1:7443/#/runs/wo-1"]);
});

test("a run's page without an address opens at the one the lookup finds", async () => {
  const opened: string[] = [];
  const lookup = async () => ({ address: "https://praxis-abcdefghij.localhost:7443/#work-order=wo-1" });
  assert.equal(await openRunPageOf("run-1", null, lookup, async (url) => void opened.push(url)), null);
  assert.deepEqual(opened, ["https://praxis-abcdefghij.localhost:7443/#work-order=wo-1"]);
});

test("opening a run's page says why when the lookup, the address or the opener fails", async () => {
  const opened: string[] = [];
  const open = async (url: string) => void opened.push(url);
  assert.equal(await openRunPageOf("run-1", null, async () => ({ problem: "no host" }), open), "Couldn't find run-1's page: no host");
  assert.equal(
    await openRunPageOf("run-1", "https://example.com/", async () => ({ problem: "unused" }), open),
    "Quay opens only pages on this machine's Praxis host. praxis gave https://example.com/ for run-1.",
  );
  assert.deepEqual(opened, []);
  const broken = async () => {
    throw new Error("no browser");
  };
  assert.equal(
    await openRunPageOf("run-1", "https://127.0.0.1:7443/", async () => ({ problem: "unused" }), broken),
    "Couldn't open run-1's page: Error: no browser",
  );
});
