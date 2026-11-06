import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "kallr-xbot/**/*.test.ts", "kallr-webapp/lib/**/*.test.ts", "kallr-extension/src/**/*.test.ts", "kall-cre/shared/*.test.ts"],
    environment: "node",
  },
});
