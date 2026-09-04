import { defineConfig } from "vitest/config";

/**
 * Tests live on both sides of this app: the sidecar (node, spawns the real
 * process) and the webview (jsdom, via a per-file docblock). The Vite build
 * config roots itself at `web/`, which would hide the sidecar suite, so the
 * test run gets its own root here.
 */
export default defineConfig({
  test: {
    root: ".",
    include: ["sidecar/**/*.test.ts", "web/**/*.test.tsx"],
  },
});