import { defineConfig } from "vite";

/**
 * The extension host bundle.
 *
 * `@prompt-burn/*` packages export TypeScript sources and are linked by pnpm's
 * `workspace:*` protocol, so a plain `tsc` emit leaves `require("@prompt-burn/db")`
 * calls that only resolve inside this checkout — a `.vsix` built that way cannot
 * load on anyone's machine. This build inlines them into one CommonJS file.
 *
 * `vscode` stays external (the editor provides it at runtime); Node builtins
 * stay external because the SSR target is Node.
 */
export default defineConfig({
  build: {
    ssr: "src/extension.ts",
    outDir: "out",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rollupOptions: {
      external: ["vscode"],
      output: {
        format: "cjs",
        entryFileNames: "extension.js",
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
