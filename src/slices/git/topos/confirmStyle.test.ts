/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmButtonClass } from "./confirmStyle.ts";

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

/** `--name` in the index.css block that opens with `selector`. */
function cssVar(css: string, selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `index.css has a ${selector} block`);
  const block = css.slice(start, css.indexOf("}", start));
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(block);
  assert.ok(match, `${selector} sets ${name}`);
  return match[1];
}

const css = readFileSync(new URL("../../../index.css", import.meta.url), "utf8");
// The dark theme draws the dialog on #161b22; the light set is measured on white, as its lanes are.
const THEMES = [
  { selector: ":root", panel: "#161b22" },
  { selector: ':root[data-theme="light"]', panel: "#ffffff" },
];

test("in both themes the danger button's label reaches 4.5:1 and the button 3:1 on the dialog, hovered or not", () => {
  for (const { selector, panel } of THEMES) {
    const fg = cssVar(css, selector, "--topos-danger-fg");
    for (const name of ["--topos-danger-bg", "--topos-danger-bg-hover"]) {
      const bg = cssVar(css, selector, name);
      assert.ok(contrast(fg, bg) >= 4.5, `${selector} ${name} label ${contrast(fg, bg).toFixed(2)}:1`);
      assert.ok(contrast(bg, panel) >= 3, `${selector} ${name} on the dialog ${contrast(bg, panel).toFixed(2)}:1`);
    }
  }
});

test("the danger button is red, not Stage's green, in both themes", () => {
  for (const { selector } of THEMES) {
    const bg = cssVar(css, selector, "--topos-danger-bg");
    const [r, g] = [parseInt(bg.slice(1, 3), 16), parseInt(bg.slice(3, 5), 16)];
    assert.ok(r > 2 * g, `${selector} --topos-danger-bg ${bg} is red`);
  }
});

test("a destructive confirm's button takes the danger colors, and any other keeps Stage's green", () => {
  const danger = confirmButtonClass(true);
  assert.match(danger, /bg-\[var\(--topos-danger-bg\)\]/);
  assert.match(danger, /hover:bg-\[var\(--topos-danger-bg-hover\)\]/);
  assert.match(danger, /text-\[var\(--topos-danger-fg\)\]/);
  assert.doesNotMatch(danger, /#238636/);
  assert.match(confirmButtonClass(false), /bg-\[#238636\]/);
});
