/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fnv1a32, SLOT_COUNT, slotColor, trackSlot } from "./laneColors.ts";

test("fnv1a32 matches the published FNV-1a 32-bit test vectors", () => {
  assert.equal(fnv1a32(""), 0x811c9dc5);
  assert.equal(fnv1a32("a"), 0xe40c292c);
  assert.equal(fnv1a32("foobar"), 0xbf9cf968);
});

test("fnv1a32 hashes the key's UTF-8 bytes", () => {
  // Computed over the bytes c3 bc 6e c3 af 63 6f 64 65.
  assert.equal(fnv1a32("ünïcode"), 0x45f2402b);
});

test("the default branch always takes slot 0", () => {
  assert.equal(trackSlot({ kind: "default", key: "main" }, []), 0);
  assert.equal(trackSlot({ kind: "default", key: "trunk" }, [1, 11]), 0);
});

test("a named branch keeps its pure-hash slot, 1 + hash mod 11, whatever its neighbours", () => {
  assert.equal(trackSlot({ kind: "named", key: "feature" }, []), 9);
  assert.equal(trackSlot({ kind: "named", key: "main" }, []), 7);
  assert.equal(trackSlot({ kind: "named", key: "topic" }, [3, 4]), 3);
});

test("derived and anonymous tracks step by 5 (mod 11) until no neighbour is within one hue", () => {
  // topic hashes to slot 3.
  assert.equal(trackSlot({ kind: "derived", key: "topic" }, []), 3);
  assert.equal(trackSlot({ kind: "derived", key: "topic" }, [6]), 3);
  assert.equal(trackSlot({ kind: "derived", key: "topic" }, [3]), 8);
  assert.equal(trackSlot({ kind: "derived", key: "topic" }, [4]), 8);
  // 3, then 8 (next to 8), 2 (next to 2), 7 (next to 8), 1 (next to 2), 6.
  assert.equal(trackSlot({ kind: "anonymous", key: "topic" }, [8, 2]), 6);
});

test("hues wrap around, so slots 1 and 11 both sit next to the default branch's slot 0", () => {
  // k10 hashes to slot 1 and k11 to slot 11.
  assert.equal(trackSlot({ kind: "anonymous", key: "k10" }, [0]), 6);
  assert.equal(trackSlot({ kind: "anonymous", key: "k11" }, [0]), 5);
  assert.equal(trackSlot({ kind: "named", key: "k11" }, [0]), 11);
});

test("slots name the CSS variables each theme defines", () => {
  assert.equal(slotColor(0), "var(--topos-lane-0)");
  assert.equal(slotColor(11), "var(--topos-lane-11)");
});

/** WCAG 2 relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The `--topos-lane-N` values in the CSS block that opens with `selector`. */
function palette(css: string, selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `index.css has a ${selector} block`);
  const block = css.slice(start, css.indexOf("}", start));
  return Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const match = new RegExp(`--topos-lane-${slot}:\\s*(#[0-9a-f]{6})`).exec(block);
    assert.ok(match, `${selector} sets --topos-lane-${slot}`);
    return match[1];
  });
}

test("each theme's 12 lane colors reach at least 4.7:1 on its background", () => {
  const css = readFileSync(new URL("../../../index.css", import.meta.url), "utf8");
  const sets = [
    { selector: ":root", background: "#0d1117" },
    { selector: ":root[data-theme=\"light\"]", background: "#ffffff" },
  ];
  for (const { selector, background } of sets) {
    const colors = palette(css, selector);
    assert.equal(new Set(colors).size, SLOT_COUNT, `${selector} has 12 distinct colors`);
    for (const [slot, color] of colors.entries()) {
      assert.ok(contrast(color, background) >= 4.7, `${selector} slot ${slot} ${color} on ${background}`);
    }
  }
});
