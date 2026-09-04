import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Component tests need a DOM (default here); the boundary scan opts back
    // to node with a `// @vitest-environment node` docblock.
    environment: "jsdom",
  },
});