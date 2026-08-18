import { afterEach, describe, expect, it, vi } from "vitest";

function response(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe("browser session discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("remembers a confirmed anonymous session across public requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/session")) return response(401, { error: "unauthenticated" });
      return response(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { request } = await import("./request");

    await request("GET", "/api/state");
    await request("GET", "/api/public-summary");

    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/session"))).toHaveLength(1);
  });
});
