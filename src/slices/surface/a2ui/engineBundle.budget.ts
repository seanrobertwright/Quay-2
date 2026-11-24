/// <reference types="node" />
// How large the engine is in a bundle (#725), React external: the last case of the spec's table of engine
// 0.16.1. Not a `*.test.ts` file, so it builds with nothing else running (`test:budget`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const CORE = 'export { A2uiSurface, createComponentImplementation } from "@a2ui/react"; export { MessageProcessor, STRICT_VALIDATION, mapErrorToRendererMessage } from "@a2ui/web_core/v1_0";';

/** The size of the minified bundle of a module whose source is `source`, in kB, and of its gzip. */
async function sizes(source: string): Promise<{ kb: number; gzip: number; lit: boolean }> {
  const entry = "\0entry.ts";
  const built = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [{ name: "entry", resolveId: (id) => (id === "entry.ts" ? entry : null), load: (id) => (id === entry ? source : null) }],
    build: { write: false, minify: true, rollupOptions: { input: "entry.ts", external: /^react(-dom)?(\/|$)/, preserveEntrySignatures: "strict", output: { format: "es" } } },
  });
  const outputs = [built].flat().flatMap((one) => ("output" in one ? one.output : []));
  const code = outputs.map((chunk) => ("code" in chunk ? chunk.code : "")).join("");
  return { kb: Buffer.byteLength(code) / 1000, gzip: gzipSync(code).length / 1000, lit: code.includes("litElementVersions") };
}

const near = (found: number, expected: number, what: string) => assert.ok(Math.abs(found - expected) <= expected * 0.05, `${what}: ${found.toFixed(1)} kB`);

test("surface and core, and with the basic catalog to derive from, are the sizes the spec measured, with Lit in both", async () => {
  const core = await sizes(CORE);
  const catalog = await sizes(`${CORE} export { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";`);
  near(core.kb, 396, "surface and core");
  near(core.gzip, 104, "surface and core, gzip");
  near(catalog.kb, 509, "with the basic catalog");
  near(catalog.gzip, 134, "with the basic catalog, gzip");
  assert.deepEqual([core.lit, catalog.lit], [true, true]);
});
