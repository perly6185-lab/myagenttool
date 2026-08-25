import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFESSIONAL_CAPABILITY,
  authorizeProfessionalRequest,
  professionalRoleForbiddenBody,
  requiredProfessionalCapability,
  roleAllowsProfessionalCapability,
} from "../src/runtime/route-authority.mjs";

test("professional capability matrix separates managers, operators, and viewers", () => {
  for (const role of ["owner", "admin"]) {
    assert.equal(roleAllowsProfessionalCapability(role, PROFESSIONAL_CAPABILITY.MANAGE), true);
    assert.equal(roleAllowsProfessionalCapability(role, PROFESSIONAL_CAPABILITY.OPERATE), true);
  }
  assert.equal(roleAllowsProfessionalCapability("operator", PROFESSIONAL_CAPABILITY.MANAGE), false);
  assert.equal(roleAllowsProfessionalCapability("operator", PROFESSIONAL_CAPABILITY.OPERATE), true);
  assert.equal(roleAllowsProfessionalCapability("viewer", PROFESSIONAL_CAPABILITY.MANAGE), false);
  assert.equal(roleAllowsProfessionalCapability("viewer", PROFESSIONAL_CAPABILITY.OPERATE), false);
  assert.equal(roleAllowsProfessionalCapability("unexpected-role", PROFESSIONAL_CAPABILITY.MANAGE), false);
});

test("configuration and governance writes require professional management", () => {
  const cases = [
    ["POST", "/api/agents"],
    ["PATCH", "/api/agent-skills/skill-1"],
    ["POST", "/api/applications/register"],
    ["POST", "/api/applications/app-1/health-probe"],
    ["POST", "/api/discovery"],
    ["PATCH", "/api/integration-retention"],
    ["POST", "/api/channels/channel-1/allowlist"],
    ["DELETE", "/api/channels/channel-1/identities/identity-1"],
    ["POST", "/api/automations"],
    ["PATCH", "/api/automations/automation-1"],
    ["PUT", "/api/auto-run-settings"],
    ["POST", "/api/capability-resolutions"],
    ["POST", "/api/users"],
    ["POST", "/api/mail/task-policies"],
    ["POST", "/api/hosts"],
    ["POST", "/api/hosts/ssh_target_1/observe-fingerprint"],
    ["POST", "/api/hosts/ssh_target_1/confirm-fingerprint"],
    ["POST", "/api/hosts/ssh_target_1/verify"],
    ["POST", "/api/hosts/ssh_target_1/file-scopes"],
    ["PATCH", "/api/hosts/ssh_target_1/file-scopes/hfs_1"],
  ];

  for (const [method, pathname] of cases) {
    assert.equal(requiredProfessionalCapability(method, pathname), PROFESSIONAL_CAPABILITY.MANAGE, `${method} ${pathname}`);
  }
});

test("execution, approval, recovery, and retry writes admit operators", () => {
  const cases = [
    ["POST", "/api/approvals/grants"],
    ["POST", "/api/approvals/invocation-1/approve"],
    ["POST", "/api/invocations"],
    ["POST", "/api/invocations/invocation-1/cancel"],
    ["POST", "/api/compare-runs/compare-1/promote"],
    ["POST", "/api/local-schedule/apply"],
    ["POST", "/api/capabilities/demo.run/invocations"],
    ["POST", "/api/tools/demo/invocations"],
    ["POST", "/api/channel-tasks/task-1/retry"],
    ["POST", "/api/channel-tasks/task-1/wechat-draft-reconciliation"],
    ["POST", "/api/automations/automation-1/run"],
    ["POST", "/api/report-schedule/post-now"],
    ["POST", "/api/applications/app-1/orchestrations/routine-1/run"],
    ["POST", "/api/applications/app-1/orchestrations/routine-1/runs/run-1/recovery/actions"],
    ["POST", "/api/mail/task-policies/evaluate"],
    ["POST", "/api/host-file-scopes/hfs_1/transfers/upload"],
    ["POST", "/api/host-file-scopes/hfs_1/transfers/download"],
  ];

  for (const [method, pathname] of cases) {
    assert.equal(requiredProfessionalCapability(method, pathname), PROFESSIONAL_CAPABILITY.OPERATE, `${method} ${pathname}`);
    assert.equal(authorizeProfessionalRequest({ role: "operator" }, method, pathname).allowed, true);
    assert.equal(authorizeProfessionalRequest({ role: "viewer" }, method, pathname).allowed, false);
  }
});

test("reads and ordinary-user workflow writes are unaffected", () => {
  assert.equal(requiredProfessionalCapability("GET", "/api/agents"), null);
  assert.equal(requiredProfessionalCapability("POST", "/api/work-items"), null);
  assert.equal(requiredProfessionalCapability("PATCH", "/api/work-profile"), null);
  assert.equal(requiredProfessionalCapability("POST", "/api/session"), null);
  assert.equal(authorizeProfessionalRequest({ role: "viewer" }, "POST", "/api/work-items").allowed, true);
});

test("role denial response exposes a stable machine-readable contract", () => {
  assert.deepEqual(professionalRoleForbiddenBody(PROFESSIONAL_CAPABILITY.MANAGE), {
    error: "role_forbidden",
    requiredCapability: "manage",
    message: "This action requires an owner or administrator.",
  });
  assert.deepEqual(professionalRoleForbiddenBody(PROFESSIONAL_CAPABILITY.OPERATE), {
    error: "role_forbidden",
    requiredCapability: "operate",
    message: "This action requires an owner, administrator, or operator.",
  });
});
