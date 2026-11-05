import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "services/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/extension/src/**/*.test.ts"],
    environment: "node",
  },
});
