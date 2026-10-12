import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "extension/src/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
  },
});
