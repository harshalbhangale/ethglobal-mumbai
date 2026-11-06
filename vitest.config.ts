import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app imports its own files as "@/…" (its tsconfig paths); tests resolve them the same way.
  resolve: { alias: [{ find: /^@\//, replacement: new URL("./kallr-webapp/", import.meta.url).pathname }] },
  test: {
    include: ["packages/**/*.test.ts", "kallr-xbot/**/*.test.ts", "kallr-webapp/lib/**/*.test.ts", "kallr-extension/src/**/*.test.ts", "kall-cre/shared/*.test.ts"],
    environment: "node",
  },
});
