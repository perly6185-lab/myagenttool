import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "cad-real.spec.ts",
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4175", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "pnpm --filter @myagenttool/web dev --host 127.0.0.1 --port 4175", url: "http://127.0.0.1:4175", reuseExistingServer: !process.env.CI },
    { command: "node e2e/cad-real-server.mjs", url: "http://127.0.0.1:5011/api/cad-preview/readiness", reuseExistingServer: false },
  ],
});
