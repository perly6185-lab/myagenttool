import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { protectForCurrentWindowsUser, registerMailAccountConnector } from "../src/mail-account-connector.mjs";

function harness({ verifyCredential = async () => undefined, existingApplicationId = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mail-connector-"));
  const handlers = new Map();
  const requests = [];
  registerMailAccountConnector({
    ipcMain: {
      removeHandler: (name) => handlers.delete(name),
      handle: (name, handler) => handlers.set(name, handler),
    },
    platform: "win32",
    credentialRoot: root,
    runtimeRoot: "C:\\MyAgentTool",
    nodeCommand: "electron.exe",
    requestServer: async (method, path, body) => {
      requests.push({ method, path, body });
      return path === "/api/mailbox" ? { accounts: existingApplicationId ? [{ provider: "netease", readApplicationId: existingApplicationId }] : [] } : {};
    },
    verifyCredential,
    protectSecret: (secret) => `dpapi:${Buffer.from(secret).toString("base64")}`,
    now: () => "2026-08-13T08:00:00.000Z",
  });
  return { root, handlers, requests };
}

test("connect verifies first, registers the app, and persists only a protected secret", async () => {
  const seen = [];
  const { root, handlers, requests } = harness({ verifyCredential: async (credential) => seen.push(credential) });
  const result = await handlers.get("mail:connect-163")(null, { email: "User@163.com", authorizationCode: "plain-auth-code" });

  assert.equal(result.ok, true);
  assert.deepEqual(seen, [{ username: "user@163.com", authorizationCode: "plain-auth-code" }]);
  assert.deepEqual(requests.map((item) => item.path), ["/api/mailbox", "/api/agents", "/api/applications/register"]);
  assert.equal("env" in requests[1].body, false, "the Application descriptor carries no process environment");
  assert(!JSON.stringify(requests).includes("plain-auth-code"), "control-plane registration never receives the secret");

  const credentialPath = join(root, "mail", "163.json");
  const readinessPath = join(root, "credential-readiness", "app_163_mail.json");
  assert.equal(existsSync(credentialPath), true);
  assert.equal(existsSync(readinessPath), true);
  const credentialText = readFileSync(credentialPath, "utf8");
  assert(!credentialText.includes("plain-auth-code"));
  assert.equal(JSON.parse(credentialText).protectedAuthorizationCode.startsWith("dpapi:"), true);
  assert.deepEqual(JSON.parse(readFileSync(readinessPath, "utf8")), {
    applicationId: "app_163_mail",
    provider: "netease",
    scope: "imap.readonly",
    obtainedAt: "2026-08-13T08:00:00.000Z",
  });
});

test("failed verification stores and registers nothing", async () => {
  const { root, handlers, requests } = harness({ verifyCredential: async () => { throw new Error("login rejected"); } });
  const result = await handlers.get("mail:connect-163")(null, { email: "user@163.com", authorizationCode: "wrong" });
  assert.deepEqual(result, { ok: false, error: "verification_failed" });
  assert.equal(requests.length, 0);
  assert.equal(existsSync(join(root, "mail", "163.json")), false);
});

test("status exposes account metadata but never the protected credential", async () => {
  const { handlers } = harness();
  await handlers.get("mail:connect-163")(null, { email: "user@163.com", authorizationCode: "secret" });
  const status = await handlers.get("mail:get-connector-status")();
  assert.equal(status.providers[0].connected, true);
  assert.equal(status.providers[0].account, "user@163.com");
  assert(!JSON.stringify(status).includes("secret"));
  assert.equal(status.providers[1].available, false, "Gmail is clearly marked unavailable instead of pretending to connect");
});

test("reconnection keeps a migrated application id and reports readiness for that revision", async () => {
  const { root, handlers, requests } = harness({ existingApplicationId: "app_163_mail_v2" });
  const result = await handlers.get("mail:connect-163")(null, { email: "user@163.com", authorizationCode: "secret" });
  assert.equal(result.ok, true);
  assert.equal(requests.some((item) => item.path === "/api/applications/register"), false);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_v2.json")), true);
});

test("invalid addresses are rejected before verification", async () => {
  let called = false;
  const { handlers } = harness({ verifyCredential: async () => { called = true; } });
  assert.deepEqual(await handlers.get("mail:connect-163")(null, { email: "user@example.com", authorizationCode: "code" }), { ok: false, error: "invalid_email" });
  assert.equal(called, false);
});

test("DPAPI protection sends plaintext over stdin, never argv or environment", () => {
  let invocation;
  const protectedValue = protectForCurrentWindowsUser("plain-auth-code", {
    platform: "win32",
    spawn: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: "dpapi-value" };
    },
  });
  assert.equal(protectedValue, "dpapi-value");
  assert.equal(invocation.options.input, "plain-auth-code");
  assert(!JSON.stringify(invocation.args).includes("plain-auth-code"));
  assert(!JSON.stringify(invocation.options.env).includes("plain-auth-code"));
});
