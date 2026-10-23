import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The opt-in integration suites share one database (and one of them pauses the
    // system on purpose), so test files must not run at the same time.
    fileParallelism: false,
  },
});
