// PROTOTYPE (#351). Production build of the prototype page, served with
// Quay's release CSP, because dev-mode React costs several times more per
// render and would skew the frame-rate numbers.
//   pnpm proto:topos:prod   ->  http://localhost:1431/

import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "dist");
const conf = JSON.parse(readFileSync(join(here, "../../../../src-tauri/tauri.conf.json"), "utf8"));
// Plus connect-src 'self' so the page can fetch data/*.json; the real app gets rows over IPC instead.
const directives = { ...conf.app.security.csp };
directives["connect-src"] = [...directives["connect-src"], "'self'"];
const csp = Object.entries(directives).map(([k, v]) => [k, ...v].join(" ")).join("; ");

await build({ root: here, configFile: false, plugins: [react(), tailwindcss()], logLevel: "warn",
  build: { outDir, emptyOutDir: true } });
if (existsSync(join(here, "data"))) cpSync(join(here, "data"), join(outDir, "data"), { recursive: true });
const server = await preview({ root: here, configFile: false, build: { outDir },
  preview: { port: 1431, strictPort: true, headers: { "Content-Security-Policy": csp } } });
server.printUrls();
