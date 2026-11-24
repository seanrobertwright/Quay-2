// PROTOTYPE (#711), throwaway. What the engine adds to Quay's bundle, with release-profile vite builds:
// node src/slices/stage/prototype-a2ui-live/bundle.mjs
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const virtual = (id, code) => ({
  name: `virtual-${id}`,
  enforce: "pre",
  resolveId: (source) => (source === id ? `\0${id}` : undefined),
  load: (found) => (found === `\0${id}` ? code : undefined),
});
const STUBS = "export const SurfaceView = () => null; export const useArrival = () => null; export const livesOf = () => [];";
/** Puts stubs where the A2UI module is, with `first` run before them. */
const stubbed = (first) => ({
  name: "stubbed-a2ui",
  enforce: "pre",
  resolveId: (source) => (/prototype-a2ui-live\/(SurfaceView|live)\.tsx?$/.test(source) ? "\0stub" : undefined),
  load: (id) => (id === "\0stub" ? first + STUBS : undefined),
});
/** Quay as it would be without the module. */
const without = stubbed("");
/** The module in a chunk of its own, which the main chunk loads with `import()`. */
const lazy = stubbed('void import("/src/slices/stage/prototype-a2ui-live/SurfaceView.tsx?lazy"); ');
const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
async function run(label, options) {
  const result = await build({ configFile: false, logLevel: "silent", ...options, build: { write: false, ...options.build } });
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  const sum = (test) => {
    const parts = output.filter((o) => test.test(o.fileName)).map((o) => Buffer.from(o.type === "chunk" ? o.code : o.source));
    return [parts.reduce((n, b) => n + b.length, 0), parts.reduce((n, b) => n + gzipSync(b).length, 0)];
  };
  const js = sum(/\.js$/);
  const css = sum(/\.css$/);
  console.log(label.padEnd(52), `js ${kB(js[0])} (${kB(js[1])} gzip)  css ${kB(css[0])} (${kB(css[1])} gzip)`);
  for (const o of output) if (o.type === "chunk" && output.filter((x) => x.type === "chunk").length < 8 && o.code.length > 100000) console.log("   ", o.fileName, kB(o.code.length), kB(gzipSync(o.code).length));
  const modules = output.filter((o) => o.type === "chunk").flatMap((o) => Object.entries(o.modules));
  const by = {};
  for (const [id, m] of modules) {
    const name = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(id.replace(/\\/g, "/"))?.[1];
    if (name) by[name] = (by[name] ?? 0) + (m.renderedLength ?? 0);
  }
  return { js, css, by };
}
const plugins = () => [react(), tailwindcss()];
const off = await run("Quay without the A2UI module", { plugins: [without, ...plugins()] });
const on = await run("Quay with it, imported in the main chunk", { plugins: plugins() });
console.log("growth: js", kB(on.js[0] - off.js[0]), `(${kB(on.js[1] - off.js[1])} gzip)`, "css", kB(on.css[0] - off.css[0]), `(${kB(on.css[1] - off.css[1])} gzip)`);
console.log(
  "rendered source by package, before minifying:",
  Object.fromEntries(Object.entries(on.by).map(([n, v]) => [n, v - (off.by[n] ?? 0)]).filter(([, v]) => v > 2000).sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, kB(v)])),
);
await run("Quay with it in a chunk of its own", { plugins: [lazy, ...plugins()] });

const lib = (id, code) => ({
  plugins: [virtual(id, code)],
  build: { rollupOptions: { input: id, external: [/^react(-dom)?(\/|$)/], preserveEntrySignatures: "strict" } },
});
const isolated = [
  ["surface and core", 'export { A2uiSurface, createComponentImplementation } from "@a2ui/react"; export { MessageProcessor, Catalog, STRICT_VALIDATION } from "@a2ui/web_core/v1_0";'],
  ["with the basic catalog to derive from", 'export { A2uiSurface, createComponentImplementation } from "@a2ui/react"; export { MessageProcessor, STRICT_VALIDATION, basicCatalog, mapErrorToRendererMessage } from "@a2ui/web_core/v1_0";'],
];
for (const [label, code] of isolated) await run(`engine alone, React external: ${label}`, lib("virtual:a2ui", code));

// Markdown: Quay's parser by the spec, not used by this prototype. It is resolved as @a2ui/react's own dependency.
const fromReact = createRequire(`${dirname(realpathSync("node_modules/@a2ui/react/package.json"))}/package.json`);
const markdownIt = fromReact.resolve("markdown-it").replace(/\\/g, "/");
await run("markdown-it alone", lib("virtual:md", `export { default } from ${JSON.stringify(markdownIt)};`));
