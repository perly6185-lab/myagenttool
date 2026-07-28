import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completePasswordRecovery,
  getIdentityOptions,
  getSessionUser,
  issuePasswordRecovery,
  loginLocal,
  logout,
} from "./api-client";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("identity API client", () => {
  it("discovers server capabilities with cookies and no bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      protocolVersion: 1,
      localMode: true,
      passwordMode: true,
      providers: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await getIdentityOptions();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/identity/options"),
      { credentials: "include" },
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("Authorization");
  });

  it("rejects malformed identity options instead of crashing the Me surface", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    await expect(getIdentityOptions()).rejects.toMatchObject({
      code: "identity_options_invalid",
    });
  });

  it("keeps the opaque session out of browser storage", async () => {
    localStorage.setItem("myagenttool.token", "legacy-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: "usr_local", teamId: "team_local", role: "owner" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await loginLocal();
    expect(getSessionUser()?.id).toBe("usr_local");
    expect(localStorage.getItem("myagenttool.token")).toBeNull();
    expect(Object.keys(localStorage)).not.toContain("myagenttool.user");
  });

  it("does not clear the UI identity until server revocation succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    await expect(logout()).rejects.toMatchObject({ code: "logout_failed" });
    expect(getSessionUser()?.id).toBe("usr_local");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await logout();
    expect(getSessionUser()).toBeNull();
  });

  it("keeps recovery secrets in request bodies and out of browser storage", async () => {
    document.cookie = "myagenttool_csrf=csrf_test; Path=/";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        recoveryToken: "rgr_once",
        grant: {
          id: "irg_a",
          purpose: "password_reset",
          teamId: "team_a",
          userId: "usr_a",
          createdAt: "2026-07-27T00:00:00.000Z",
          expiresAt: "2026-07-27T00:15:00.000Z",
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ completed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await issuePasswordRecovery("usr_a");
    await completePasswordRecovery({
      teamId: "team_a",
      userId: "usr_a",
      recoveryToken: "rgr_once",
      newPassword: "replacement passphrase",
    });

    const issueCall = fetchMock.mock.calls[0];
    expect(issueCall[0]).not.toContain("rgr_once");
    expect(issueCall[1]?.headers).toMatchObject({ "X-CSRF-Token": "csrf_test" });
    const completeCall = fetchMock.mock.calls[1];
    expect(completeCall[0]).not.toContain("rgr_once");
    expect(String(completeCall[1]?.body)).toContain("rgr_once");
    expect(JSON.stringify(localStorage)).not.toContain("rgr_once");
  });
});
