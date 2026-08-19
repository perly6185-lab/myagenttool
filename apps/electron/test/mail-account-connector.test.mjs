import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { protectForCurrentWindowsUser, registerMailAccountConnector } from "../src/mail-account-connector.mjs";

function harness({ verifyCredential = async () => undefined, verifySendCredential = async () => undefined, existingApplicationId = null, existingCredential = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mail-connector-"));
  if (existingCredential) {
    mkdirSync(join(root, "mail"), { recursive: true });
    writeFileSync(join(root, "mail", "163.json"), JSON.stringify(existingCredential));
  }
  const handlers = new Map();
  const requests = [];
  let modernRegistered = false;
  let sendRegistered = false;
  let organizeRegistered = false;
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
      if (path === "/api/applications/register") {
        if (body?.capabilityFacades?.some((facade) => facade.agentToolName === "mail_sync")) modernRegistered = true;
        if (body?.capabilityFacades?.some((facade) => facade.agentToolName === "mail_send")) sendRegistered = true;
        if (body?.capabilityFacades?.some((facade) => facade.agentToolName === "mail_organize_batch")) organizeRegistered = true;
      }
      return path === "/api/mailbox" ? { accounts: modernRegistered ? [{ provider: "netease", readApplicationId: existingApplicationId ? `${existingApplicationId}_mail_v3` : "app_163_mail", sendApplicationId: sendRegistered ? "app_163_mail_send" : null, organizeApplicationId: organizeRegistered ? "app_163_mail_organize" : null, canReceive: true, canSend: sendRegistered, canOrganize: organizeRegistered, incrementalSync: true, providerReadState: true, bodyPrefetchCapability: "app.app_163_mail.prefetch_body" }] : existingApplicationId ? [{ provider: "netease", readApplicationId: existingApplicationId }] : [] } : {};
    },
    verifyCredential,
    verifySendCredential,
    protectSecret: (secret) => `dpapi:${Buffer.from(secret).toString("base64")}`,
    now: () => "2026-08-13T08:00:00.000Z",
  });
  return { root, handlers, requests };
}

test("connect verifies first, registers the app, and persists only a protected secret", async () => {
  const imapSeen = [];
  const smtpSeen = [];
  const { root, handlers, requests } = harness({
    verifyCredential: async (credential) => imapSeen.push(credential),
    verifySendCredential: async (credential) => smtpSeen.push(credential),
  });
  const result = await handlers.get("mail:connect-163")(null, { email: "User@163.com", authorizationCode: "plain-auth-code" });

  assert.equal(result.ok, true);
  assert.deepEqual(imapSeen, [{ username: "user@163.com", authorizationCode: "plain-auth-code" }]);
  assert.deepEqual(smtpSeen, imapSeen);
  assert.deepEqual(result.account, { provider: "netease", email: "user@163.com", canReceive: true, canSend: true, canOrganize: true });
  assert.equal(requests.filter((item) => item.path === "/api/applications/register").length, 3);
  assert.equal("env" in requests[1].body, false, "the Application descriptor carries no process environment");
  assert(!JSON.stringify(requests).includes("plain-auth-code"), "control-plane registration never receives the secret");

  const credentialPath = join(root, "mail", "163.json");
  const readinessPath = join(root, "credential-readiness", "app_163_mail.json");
  assert.equal(existsSync(credentialPath), true);
  assert.equal(existsSync(readinessPath), true);
  assert.equal(existsSync(join(root, "mail", "163-send.json")), false);
  assert.equal(existsSync(join(root, "mail", "163-organize.json")), false);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_send.json")), true);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_organize.json")), true);
  const credentialText = readFileSync(credentialPath, "utf8");
  assert(!credentialText.includes("plain-auth-code"));
  assert.equal(JSON.parse(credentialText).scope, "imap.mail");
  assert.equal(JSON.parse(credentialText).protectedAuthorizationCode.startsWith("dpapi:"), true);
  assert.deepEqual(JSON.parse(readFileSync(readinessPath, "utf8")), {
    applicationId: "app_163_mail",
    provider: "netease",
    scope: "imap.readonly",
    accountId: "netease:2d270f6e9f464f82",
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

test("reconnection registers a full mailbox capability beside the legacy read-only app", async () => {
  const { root, handlers, requests } = harness({ existingApplicationId: "app_163_mail_v2" });
  const result = await handlers.get("mail:connect-163")(null, { email: "user@163.com", authorizationCode: "secret" });
  assert.equal(result.ok, true);
  const registration = requests.find((item) => item.path === "/api/applications/register");
  assert.equal(registration.body.replacesApplicationId, "app_163_mail_v2");
  assert.equal(registration.body.id, "app_163_mail_v2_mail_v3");
  assert.equal(registration.body.capabilityFacades.some((facade) => facade.agentToolName === "mail_prefetch_body"), true);
  assert.equal(registration.body.capabilityFacades.some((facade) => facade.agentToolName === "mail_set_read"), true);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_v2_mail_v3.json")), true);
});

test("legacy send and organize actions reuse the receiving credential without another code", async () => {
  const { root, handlers, requests } = harness();
  await handlers.get("mail:connect-163")(null, { email: "user@163.com", authorizationCode: "shared-code" });
  const sendResult = await handlers.get("mail:connect-163-send")(null, { email: "other@163.com", authorizationCode: "ignored" });
  const organizeResult = await handlers.get("mail:connect-163-organize")(null, {});
  assert.equal(sendResult.ok, true);
  assert.equal(organizeResult.ok, true);
  assert.equal(sendResult.account.email, "user@163.com");
  assert.equal(organizeResult.account.canOrganize, true);
  assert.equal(existsSync(join(root, "mail", "163-send.json")), false);
  assert.equal(existsSync(join(root, "mail", "163-organize.json")), false);
  assert(!JSON.stringify(requests).includes("ignored"));
  const organizeRegistration = requests.find((item) => item.path === "/api/applications/register" && item.body.capabilityFacades?.[0]?.agentToolName === "mail_organize_batch");
  assert.equal(organizeRegistration.body.source.credential.write, true);
  assert.equal(organizeRegistration.body.capabilityFacades[0].requiresApproval, true);
  assert.equal(organizeRegistration.body.capabilityFacades[0].directInvocation, false);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_organize.json")), true);
});

test("an existing receiving credential is upgraded to organize and send without reauthorization", async () => {
  let verified = false;
  const { root, handlers } = harness({
    existingCredential: { provider: "netease", scope: "imap.readonly", username: "legacy@163.com", protectedAuthorizationCode: "dpapi:legacy", obtainedAt: "2026-08-01T00:00:00.000Z" },
    verifyCredential: async () => { verified = true; },
    verifySendCredential: async () => { verified = true; },
  });
  const status = await handlers.get("mail:get-connector-status")();
  assert.equal(status.providers[0].connected, true);
  assert.equal(status.providers[0].sendConnected, true);
  assert.equal(status.providers[0].organizeConnected, true);
  assert.equal(status.providers[0].account, "legacy@163.com");
  assert.equal(verified, false);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_send.json")), true);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_organize.json")), true);
});

test("invalid addresses are rejected before verification", async () => {
  let called = false;
  const { handlers } = harness({ verifyCredential: async () => { called = true; } });
  assert.deepEqual(await handlers.get("mail:connect-163")(null, { email: "user@example.com", authorizationCode: "code" }), { ok: false, error: "invalid_email" });
  assert.equal(called, false);
});

test("disconnect removes the shared credential and every mailbox readiness sidecar", async () => {
  const { root, handlers } = harness();
  await handlers.get("mail:connect-163")(null, { email: "user@163.com", authorizationCode: "secret" });
  const result = await handlers.get("mail:disconnect-163")();
  assert.deepEqual(result, { ok: true, disconnected: true });
  assert.equal(existsSync(join(root, "mail", "163.json")), false);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail.json")), false);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_send.json")), false);
  assert.equal(existsSync(join(root, "credential-readiness", "app_163_mail_organize.json")), false);
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
