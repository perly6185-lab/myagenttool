import { defineConfig, devices } from "playwright/test";

const crossBrowser = process.env.CROSS_BROWSER === "true";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "cad-real.spec.ts",
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure" },
  projects: crossBrowser
    ? [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
      ]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true" ? undefined : {
    command: crossBrowser
      ? "pnpm --filter @myagenttool/web preview --host 127.0.0.1 --port 4174 --strictPort"
      : "pnpm --filter @myagenttool/web dev --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: crossBrowser ? false : !process.env.CI,
  },
});
