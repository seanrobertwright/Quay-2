/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { committerShown, filesNote, keyedTrailers, linkify } from "./commitDetails.ts";

test("http and https URLs become links; the text around them stays text", () => {
  assert.deepEqual(linkify("See https://example.com/issue/1 and http://a.test/x?y=1#z now"), [
    { kind: "text", text: "See ", start: 0 },
    { kind: "link", text: "https://example.com/issue/1", href: "https://example.com/issue/1", start: 4 },
    { kind: "text", text: " and ", start: 31 },
    { kind: "link", text: "http://a.test/x?y=1#z", href: "http://a.test/x?y=1#z", start: 36 },
    { kind: "text", text: " now", start: 57 },
  ]);
});

test("every other scheme stays plain text", () => {
  for (const body of [
    "javascript:alert(1)",
    "JavaScript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:ada@example.invalid",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "xhttps://example.com",
  ]) {
    assert.deepEqual(linkify(body), [{ kind: "text", text: body, start: 0 }], body);
  }
});

test("a sentence's closing punctuation stays out of the link", () => {
  assert.deepEqual(linkify("(see https://example.com/a)."), [
    { kind: "text", text: "(see ", start: 0 },
    { kind: "link", text: "https://example.com/a", href: "https://example.com/a", start: 5 },
    { kind: "text", text: ").", start: 26 },
  ]);
});

test("a scheme with nothing after it, and markup, stay text", () => {
  assert.deepEqual(linkify("https:// is not a link"), [{ kind: "text", text: "https:// is not a link", start: 0 }]);
  assert.deepEqual(linkify('<a href="https://x.test">x</a>'), [
    { kind: "text", text: '<a href="', start: 0 },
    { kind: "link", text: "https://x.test", href: "https://x.test", start: 9 },
    { kind: "text", text: '">x</a>', start: 23 },
  ]);
});

test("empty text has no parts", () => {
  assert.deepEqual(linkify(""), []);
});

test("each trailer's key is its content, with a repeat counted, so it never depends on list position", () => {
  const reviewed = { key: "Reviewed-by", value: "Ada <ada@example.invalid>" };
  const trailers = [reviewed, { key: "Quay-Agent", value: "claude" }, reviewed];
  const keyed = keyedTrailers(trailers);
  assert.deepEqual(keyed.map((k) => k.trailer), trailers, "the trailers keep their order");
  const keys = keyed.map((k) => k.id);
  assert.deepEqual(keys, ["Reviewed-byAda <ada@example.invalid>1", "Quay-Agentclaude1", "Reviewed-byAda <ada@example.invalid>2"]);
  assert.equal(new Set(keys).size, 3, "a repeated trailer still gets its own key");
});

test("the committer shows only when its name or email differs from the author's", () => {
  const ada = { name: "Ada", email: "ada@example.invalid", timeMs: 1_000 };
  assert.equal(committerShown(ada, { ...ada, timeMs: 9_000 }), false, "a later commit time alone isn't a different committer");
  assert.equal(committerShown(ada, { ...ada, name: "Bob" }), true);
  assert.equal(committerShown(ada, { ...ada, email: "bob@example.invalid" }), true);
  assert.equal(committerShown(ada, { ...ada, email: "ADA@example.invalid" }), false, "emails compare case-insensitively");
});

test("a capped file list says how many more files the commit changed", () => {
  assert.equal(filesNote({ total: 3, truncated: false, files: [{}, {}, {}] }), null);
  assert.equal(filesNote({ total: 12_345, truncated: true, files: new Array(5_000).fill({}) }), "7,345 more files not listed");
  assert.equal(filesNote({ total: 5_001, truncated: true, files: new Array(5_000).fill({}) }), "1 more file not listed");
});
