import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Isolated from vite.config.ts (no Tailwind plugin needed for tests). vitest
// picks this up automatically over the build config.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx,mjs}"],
    setupFiles: ["./src/test/setup.ts"],
    // Large jsdom suites compete heavily for memory and timers when Vitest
    // follows the host CPU count. Keep useful parallelism without making
    // ordinary UI tests intermittently miss their interaction deadlines.
    minWorkers: 1,
    maxWorkers: 4,
  },
});
