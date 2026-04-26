import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    pool: "threads",
    testTimeout: 8000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/cli/index.ts"],
      thresholds: {
        lines: 91,
        branches: 81,
      },
    },
  },
});
