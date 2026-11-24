/// <reference types="node" />
// The lint boundary between agent surfaces and Quay's own cards (#712), read from the project's own
// ESLint configuration: only the A2UI module, `src/slices/surface/a2ui`, may import `@a2ui/*`; card
// code may not import the A2UI module; the A2UI module may not import the card shell; and the parts,
// which both are drawn from, import neither. Each fixture is source linted as if it were a file at
// the path it names, since lint over the code itself must pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

const eslint = new ESLint();

/** What lint says of `source` as a file at `path`, one message per problem. */
async function problems(path: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: path });
  return result.messages.map((message) => message.message);
}

const A2UI_PACKAGE = "Only the A2UI module (src/slices/surface/a2ui) may import @a2ui.";
const CARD_TO_A2UI = "Quay's cards may not import the A2UI module: no agent content reaches a path that acts.";
const A2UI_TO_CARD = "The A2UI module may not import the card shell: no agent surface may carry the Quay mark.";
const PARTS_TO_A2UI = "The parts are under the A2UI module's components and Quay's cards, and may import neither.";

test("only the A2UI module may import @a2ui", async () => {
  const source = 'import { A2uiSurface } from "@a2ui/react/v1_0";\nexport const surface = A2uiSurface;\n';
  for (const path of [
    "src/App.tsx",
    "src/slices/companion/ActivityView.tsx",
    "src/slices/surface/SurfaceFrame.tsx",
    "src/slices/cards/PermissionCard.tsx",
    "src/slices/parts/Button.tsx",
  ]) {
    assert.deepEqual(await problems(path, source), [A2UI_PACKAGE], path);
  }
  assert.deepEqual(await problems("src/slices/surface/a2ui/engine.ts", source), []);
  assert.deepEqual(await problems("src/slices/surface/a2ui/catalog/Button.tsx", source), []);
});

test("card code may not import the A2UI module", async () => {
  const path = "src/slices/cards/PermissionCard.tsx";
  for (const from of ["../surface/a2ui/catalog.tsx", "../surface/a2ui/catalog/Button.tsx", "../surface/a2ui", "../../slices/surface/a2ui/engine.ts"]) {
    assert.deepEqual(await problems(path, `export { thing } from "${from}";\n`), [CARD_TO_A2UI], from);
  }
  assert.deepEqual(await problems(path, 'export { Button } from "../parts/Button.tsx";\n'), []);
});

test("the A2UI module may not import the card shell", async () => {
  for (const [path, from] of [
    ["src/slices/surface/a2ui/engine.ts", "../../cards/QuayCard.tsx"],
    ["src/slices/surface/a2ui/engine.ts", "../../cards"],
    ["src/slices/surface/a2ui/catalog/Button.tsx", "../../../cards/QuayBadge.tsx"],
  ]) {
    assert.deepEqual(await problems(path, `export { thing } from "${from}";\n`), [A2UI_TO_CARD], from);
  }
  assert.deepEqual(await problems("src/slices/surface/a2ui/catalog/Button.tsx", 'export { Button } from "../../../parts/Button.tsx";\n'), []);
});

test("the parts import neither the A2UI module nor the cards", async () => {
  for (const from of ["../surface/a2ui/engine.ts", "../cards/QuayCard.tsx"]) {
    assert.deepEqual(await problems("src/slices/parts/Button.tsx", `export { thing } from "${from}";\n`), [PARTS_TO_A2UI], from);
  }
});

test("every way to import a module is held to the boundary", async () => {
  for (const source of [
    'import "@a2ui/web_core";\n',
    'import type { Surface } from "@a2ui/web_core";\nexport type Held = Surface;\n',
    'export * from "@a2ui/web_core";\n',
    'export const load = () => import("@a2ui/web_core");\n',
    "export const load = () => import(`@a2ui/web_core`);\n",
    'export type Held = import("@a2ui/web_core").Surface;\n',
    'import core = require("@a2ui/web_core");\nexport const held = core;\n',
    'export const core = require("@a2ui/web_core");\n',
    'import "@a2ui";\n',
  ]) {
    assert.deepEqual(await problems("src/slices/companion/ActivityView.tsx", source), [A2UI_PACKAGE], source);
  }
});

test("other code may import the A2UI module and the cards, and text that names a module imports nothing", async () => {
  const source = 'export { engine } from "../surface/a2ui/engine.ts";\nexport { QuayCard } from "../cards/QuayCard.tsx";\nexport const named = ["@a2ui/react", "../surface/a2ui"];\n';
  assert.deepEqual(await problems("src/slices/companion/Companion.tsx", source), []);
});
