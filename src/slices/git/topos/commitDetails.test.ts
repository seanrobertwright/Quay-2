/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { committerShown, filesNote, linkify } from "./commitDetails.ts";

test("http and https URLs become links; the text around them stays text", () => {
  assert.deepEqual(linkify("See https://example.com/issue/1 and http://a.test/x?y=1#z now"), [
    { kind: "text", text: "See " },
    { kind: "link", text: "https://example.com/issue/1", href: "https://example.com/issue/1" },
    { kind: "text", text: " and " },
    { kind: "link", text: "http://a.test/x?y=1#z", href: "http://a.test/x?y=1#z" },
    { kind: "text", text: " now" },
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
    assert.deepEqual(linkify(body), [{ kind: "text", text: body }], body);
  }
});

test("a sentence's closing punctuation stays out of the link", () => {
  assert.deepEqual(linkify("(see https://example.com/a)."), [
    { kind: "text", text: "(see " },
    { kind: "link", text: "https://example.com/a", href: "https://example.com/a" },
    { kind: "text", text: ")." },
  ]);
});

test("a scheme with nothing after it, and markup, stay text", () => {
  assert.deepEqual(linkify("https:// is not a link"), [{ kind: "text", text: "https:// is not a link" }]);
  assert.deepEqual(linkify('<a href="https://x.test">x</a>'), [
    { kind: "text", text: '<a href="' },
    { kind: "link", text: "https://x.test", href: "https://x.test" },
    { kind: "text", text: '">x</a>' },
  ]);
});

test("empty text has no parts", () => {
  assert.deepEqual(linkify(""), []);
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
