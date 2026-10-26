import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const host = process.env.TAURI_DEV_HOST;

// `tauri dev` loads this server directly, so Tauri sends no policy and
// `devCsp` would have no effect. Send the release policy from tauri.conf.json,
// plus Vite's HMR socket and the React refresh preamble that
// @vitejs/plugin-react writes inline into index.html.
function devContentSecurityPolicy(): string {
  const conf = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const csp: unknown = conf?.app?.security?.csp;
  if (typeof csp !== "object" || csp === null || Array.isArray(csp)) {
    throw new Error("tauri.conf.json: app.security.csp must be a map of directive to a list of sources");
  }
  const preamble = react.preambleCode.replace("__BASE__", "/");
  const additions: Record<string, string[]> = {
    "script-src": [`'sha256-${createHash("sha256").update(preamble).digest("base64")}'`],
    "connect-src": ["'self'", host ? `ws://${host}:1421` : "ws://localhost:1420"],
  };
  const directives = new Map<string, string[]>();
  for (const [name, sources] of Object.entries(csp)) {
    if (!Array.isArray(sources) || !sources.every((source) => typeof source === "string")) {
      throw new Error(`tauri.conf.json: app.security.csp "${name}" must be a list of sources`);
    }
    directives.set(name, sources);
  }
  for (const [name, sources] of Object.entries(additions)) {
    directives.set(name, [...(directives.get(name) ?? []), ...sources]);
  }
  return [...directives].map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    headers: { "Content-Security-Policy": devContentSecurityPolicy() },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
