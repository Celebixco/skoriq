import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.integration.test.ts"],
    fileParallelism: false,
    sequence: {
      concurrent: false
    }
  }
});
