import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunPageAddress, openRunPage } from "./runPage.ts";

test("a run page on the local host's https port is a run page address", () => {
  assert.equal(isRunPageAddress("https://127.0.0.1:7443/"), true);
  assert.equal(isRunPageAddress("https://127.0.0.1:7443/#/runs/wo-6f1c2d3e"), true);
  assert.equal(isRunPageAddress("https://127.0.0.1:1/runs/x?y=1"), true);
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
    "https://praxis-abcdefghij.localhost:7443/#/runs/wo-1",
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
