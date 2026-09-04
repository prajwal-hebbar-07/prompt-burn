import { defineConfig } from "vite";

/**
 * The sidecar bundle that a packaged app runs.
 *
 * `sidecar/index.ts` imports `@prompt-burn/db` and `@prompt-burn/reader`, which
 * ship TypeScript sources and are linked by pnpm's `workspace:*` protocol —
 * neither resolves outside this checkout, so a packaged app cannot run the
 * source tree. This inlines all of it into one ESM file that plain `node` can
 * execute, which `tauri.conf.json` carries as a resource.
 *
 * Node builtins (`node:sqlite`, `node:fs`, …) stay external: the sidecar is a
 * Node process, not a browser bundle.
 */
export default defineConfig({
  build: {
    ssr: "sidecar/index.ts",
    outDir: "src-tauri/sidecar-dist",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: {
        format: "esm",
        entryFileNames: "sidecar.mjs",
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
