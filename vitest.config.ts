import { defineConfig } from "vitest/config";

// App unit tests only. Each extension runs its own suite (see extensions/*/package.json).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
  },
});
