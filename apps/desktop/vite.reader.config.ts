import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The Reader is a plain web build of the same renderer code (docs/READER.md):
 * static, read-only, deployed to Vercel. Electron never sees it, so it gets its
 * own config rather than a fourth electron-vite target.
 *
 * `base: './'` keeps every asset URL relative — the same `dist/` works from a
 * Vercel domain, a sub-path, or a local `file://` sanity check.
 */
export default defineConfig({
  root: resolve(__dirname, "src/reader"),
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, "out/reader"),
    emptyOutDir: true,
  },
});
