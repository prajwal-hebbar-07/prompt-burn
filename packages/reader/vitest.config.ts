import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Period bounds are device-local, so a golden that filters OMP by "today"
    // only has one right answer if the runtime timezone is fixed. Same pin as
    // `packages/core`: IST, UTC+5:30, no DST.
    env: { TZ: "Asia/Kolkata" },
  },
});
