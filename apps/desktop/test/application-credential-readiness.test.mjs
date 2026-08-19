/*
 * Device-side credential readiness (#977, ADR 0010).
 *
 * The device reports what it HOLDS — application, provider, scope — and never a
 * credential. These tests hold that line from both ends: a well-formed sidecar
 * produces only approved non-secret scalars, and a sidecar carrying a secret (a bug in the
 * login flow, or a hostile file) cannot smuggle it onto the wire.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectApplicationCredentialReadiness,
  stripSecretShapedKeys,
} from "../src/application-credential-readiness.mjs";

const options = (records) => ({
  now: () => "2026-07-14T00:00:00.000Z",
  readDir: () => Object.keys(records),
  readRecord: (path) => stripSecretShapedKeys(records[path.split(/[\\/]/).at(-1)]),
});

test("a well-formed sidecar reports application, provider, and scope — nothing else", () => {
  const rows = collectApplicationCredentialReadiness("/creds", options({
    "gmail.json": { applicationId: "app_gmail", provider: "google", scope: "gmail.readonly", obtainedAt: "2026-07-13" },
  }));
  assert.deepEqual(rows, [{
    applicationId: "app_gmail",
    provider: "google",
    scope: "gmail.readonly",
    status: "present",
    checkedAt: "2026-07-14T00:00:00.000Z",
  }]);
});

test("a sidecar carrying a secret cannot smuggle it onto the wire", () => {
  const rows = collectApplicationCredentialReadiness("/creds", options({
    "gmail.json": {
      applicationId: "app_gmail",
      provider: "google",
      scope: "gmail.readonly",
      refresh_token: "1//0gLeAkedSecret",
      client_secret: "GOCSPX-leaked",
      authorization: "Bearer leaked",
      nested: { password: "leaked" },
    },
  }));
  const serialized = JSON.stringify(rows);
  for (const secret of ["1//0gLeAkedSecret", "GOCSPX-leaked", "Bearer leaked", "password"]) {
    assert.ok(!serialized.includes(secret), `"${secret}" must never reach a bridge report`);
  }
  assert.equal(rows[0].scope, "gmail.readonly", "the non-secret metadata still reports");
});

test("an opaque account identifier is reported for mailbox isolation", () => {
  const rows = collectApplicationCredentialReadiness("/creds", options({
    "mail.json": { applicationId: "app_163_mail", provider: "netease", scope: "imap.readonly", accountId: "netease:1234567890abcdef", username: "must-not-pass@example.com" },
  }));
  assert.equal(rows[0].accountId, "netease:1234567890abcdef");
  assert.equal("username" in rows[0], false);
});

test("a record that does not describe itself cleanly is dropped, never guessed", () => {
  const rows = collectApplicationCredentialReadiness("/creds", options({
    "no-app.json": { provider: "google", scope: "gmail.readonly" },
    "bad-app.json": { applicationId: "../../etc/passwd", provider: "google", scope: "gmail.readonly" },
    "bad-provider.json": { applicationId: "app_gmail", provider: "Google Inc!", scope: "gmail.readonly" },
    "no-scope.json": { applicationId: "app_gmail", provider: "google" },
  }));
  assert.deepEqual(rows, [], "a fabricated 'authorized' is worse than no signal at all");
});

test("no credential directory means the device holds nothing", () => {
  assert.deepEqual(collectApplicationCredentialReadiness(null), []);
});

test("stripSecretShapedKeys drops secret-shaped and nested values", () => {
  assert.deepEqual(
    stripSecretShapedKeys({ scope: "gmail.readonly", token: "x", apiKey: "y", nested: { a: 1 } }),
    { scope: "gmail.readonly" },
  );
});
