import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Tests live on both sides of this app: the extension host (node) and the
 * webview (jsdom, via a per-file docblock). The bundle config roots itself at
 * `web/`, and the compiled host output in `out/` would be picked up as a second
 * copy of every host test, so the test run gets its own root and include list.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    root: ".",
    include: ["src/**/*.test.ts", "web/**/*.test.tsx"],
  },
});
