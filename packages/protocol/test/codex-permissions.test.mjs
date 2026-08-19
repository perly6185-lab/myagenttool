import assert from "node:assert/strict";
import test from "node:test";

import {
  codexExecPermissionArgs,
  codexPermissionModeFromLegacySandbox,
  codexPermissionProfile,
  normalizeCodexPermissionMode,
} from "@myagenttool/protocol/codex-permissions";

test("Codex permission modes normalize to the official sandbox and reviewer combinations", () => {
  assert.deepEqual(codexPermissionProfile("read_only"), {
    mode: "read_only",
    sandboxMode: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    bypassApprovalsAndSandbox: false,
  });
  assert.deepEqual(codexPermissionProfile("ask"), {
    mode: "ask",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    bypassApprovalsAndSandbox: false,
  });
  assert.equal(codexPermissionProfile("auto").approvalsReviewer, "auto_review");
  assert.deepEqual(codexPermissionProfile("full"), {
    mode: "full",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    bypassApprovalsAndSandbox: true,
  });
});

test("Codex exec flags encode the same permission profiles", () => {
  assert.ok(codexExecPermissionArgs("read_only").includes("read-only"));
  assert.deepEqual(codexExecPermissionArgs("ask"), [
    "--sandbox",
    "workspace-write",
    "--config",
    'approval_policy="on-request"',
    "--config",
    'approvals_reviewer="user"',
  ]);
  assert.ok(codexExecPermissionArgs("auto").includes('approvals_reviewer="auto_review"'));
  assert.deepEqual(codexExecPermissionArgs("full"), ["--dangerously-bypass-approvals-and-sandbox"]);
});

test("legacy sandbox values migrate conservatively", () => {
  assert.equal(codexPermissionModeFromLegacySandbox("workspace-write"), "ask");
  assert.equal(codexPermissionModeFromLegacySandbox("read-only"), "read_only");
  assert.equal(codexPermissionModeFromLegacySandbox("danger-full-access"), "full");
  assert.equal(normalizeCodexPermissionMode("unexpected"), "ask");
});
