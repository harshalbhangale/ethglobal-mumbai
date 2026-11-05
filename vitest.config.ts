import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/web/lib/**/*.test.ts"],
    environment: "node",
  },
});
