// PROTOTYPE (#702), throwaway. Serves or builds the states prototype on its own, with no Tauri.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 1429, strictPort: true },
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false, rollupOptions: { output: { codeSplitting: false } } },
});
