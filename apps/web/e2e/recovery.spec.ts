import { expect, test } from "playwright/test";

test("recovers from a transient state 5xx while the event stream is unavailable", async ({ page }) => {
  let stateAttempts = 0;
  await page.addInitScript(() => window.localStorage.setItem("myagenttool.token", "e2e-token"));
  await page.route("http://127.0.0.1:5001/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/events/stream", (route) => route.fulfill({ status: 503, json: { error: "stream_unavailable" } }));
  await page.route("**/api/state", (route) => {
    stateAttempts += 1;
    if (stateAttempts === 1) return route.fulfill({ status: 503, json: { error: "temporarily_unavailable" } });
    return route.fulfill({ json: {
      currentProjectId: "prj_1",
      projects: [{ id: "prj_1", name: "Recovered project", status: "active" }],
      projectTargets: [], worktrees: [], invocations: [], agents: [],
      issueClaims: [], issueClaimEvents: [],
      device: { id: "dev_1", name: "Recovered device", status: "online" },
    } });
  });
  await page.goto("/?section=task");
  await expect.poll(() => stateAttempts, { timeout: 8_000 }).toBeGreaterThan(1);
  await page.getByRole("button", { name: /Notifications:/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Notifications" }).getByText("Connected", { exact: true }),
  ).toBeVisible();
});

test("replays a failed webhook delivery through the authenticated browser client", async ({ page }) => {
  let replayed = false;
  await page.addInitScript(() => window.localStorage.setItem("myagenttool.token", "e2e-token"));
  await page.route("**/api/work-items/github/deliveries/dlv_failed/replay", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer e2e-token");
    replayed = true;
    await route.fulfill({
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      json: { replayed: true, deliveryId: "dlv_failed" },
    });
  });
  await page.goto("about:blank");
  const response = await page.evaluate(async () => {
    const result = await fetch("http://127.0.0.1:5001/api/work-items/github/deliveries/dlv_failed/replay", {
      method: "POST",
      headers: { Authorization: "Bearer e2e-token" },
    });
    return { status: result.status, body: await result.json() };
  });
  expect(response).toEqual({ status: 200, body: { replayed: true, deliveryId: "dlv_failed" } });
  expect(replayed).toBe(true);
});
