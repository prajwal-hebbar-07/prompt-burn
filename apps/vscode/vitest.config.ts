import { defineConfig } from "vitest/config";

/**
 * This app compiles to `out/`, which means the default discovery would also
 * pick up the compiled copy of every test and try to run it as CommonJS. Tests
 * are the TypeScript sources, only.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
