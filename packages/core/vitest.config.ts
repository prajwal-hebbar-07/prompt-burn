import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Period bounds are device-local. Pin the runtime to IST (UTC+5:30, no DST)
    // so the boundary tests exercise real local-midnight math; period.test.ts
    // asserts this took effect.
    env: { TZ: "Asia/Kolkata" },
  },
});
