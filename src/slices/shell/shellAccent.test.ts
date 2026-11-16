/// <reference types="node" />
// Unit tests for the shell accent (#652): the one token the pie palette sets, Spectrum's hue per
// module icon, and WCAG contrast for every palette on every surface the accent sits on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PIE_PALETTES } from "../pie/piePalettes.ts";
import { MODULES } from "./modules.ts";
import { accentTokens, moduleAccent } from "./shellAccent.ts";

test("the accent is the pie palette's first colour", () => {
  assert.equal(accentTokens("cyber")["--quay-accent"], "#00f0ff");
  assert.equal(accentTokens("sunset")["--quay-accent"], "#ff3d81");
  assert.equal(accentTokens("spectrum")["--quay-accent"], "#7df9ff");
});

test("with Spectrum each module icon takes its own hue, the first the pie's N wedge hue", () => {
  const hues = MODULES.map((module) => moduleAccent("spectrum", module));
  assert.equal(hues[0], "hsl(170 100% 62%)");
  assert.equal(new Set(hues.map((h) => h?.split(" ")[0])).size, MODULES.length, `hues ${hues.join(", ")}`);
});

test("with any other palette every module icon takes the accent", () => {
  for (const palette of PIE_PALETTES.filter((p) => p.id !== "spectrum")) {
    for (const module of MODULES) assert.equal(moduleAccent(palette.id, module), null, `${palette.id} ${module}`);
  }
});

// WCAG 2.x relative luminance and contrast ratio, from the definitions in the spec, for `#rrggbb`
// and `hsl(h s% l%)` colours.
function rgb(color: string): [number, number, number] {
  const hsl = /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/.exec(color);
  if (hsl) {
    const [h, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  assert.match(color, /^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
}
const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The surfaces lit parts sit on: the stage, the bar and panels, and a raised or hovered row. */
const SURFACES = ["#0d1117", "#161b22", "#21262d"];

test("the accent and every module hue reach 4.5:1 on every surface, in every palette", () => {
  for (const palette of PIE_PALETTES) {
    const colors = [accentTokens(palette.id)["--quay-accent"], ...MODULES.map((m) => moduleAccent(palette.id, m) ?? "")].filter(Boolean);
    for (const color of colors) {
      for (const surface of SURFACES) {
        const ratio = contrast(color, surface);
        assert.ok(ratio >= 4.5, `${palette.id}: ${color} on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
