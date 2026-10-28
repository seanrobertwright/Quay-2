import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm start` runs `vite build web`, so web/ is the root and the build lands in dist/ beside it,
// where server/index.ts serves it.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
