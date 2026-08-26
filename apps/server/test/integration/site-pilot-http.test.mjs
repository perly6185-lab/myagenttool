process.env.MYAGENT_REQUIRE_AUTH = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

let server;
let base;
let projectPath;
let statePathRoot;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  let tick = 0;
  const now = () => new Date(Date.parse("2026-08-24T00:00:00.000Z") + tick++ * 1000).toISOString();
  projectPath = mkdtempSync(join(tmpdir(), "site-pilot-http-project-"));
  statePathRoot = mkdtempSync(join(tmpdir(), "site-pilot-http-state-"));
  const created = createServerState({ defaultProjectPath: projectPath, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "site-pilot-http-test", protocolVersion: "0.0.0", state: created.state,
    defaultProject: created.defaultProject, defaultProjectPath: projectPath,
    persistenceEnabled: false, stateStorePath: join(statePathRoot, "state.json"), stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000, now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "site-pilot-http-test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (projectPath) rmSync(projectPath, { recursive: true, force: true });
  if (statePathRoot) rmSync(statePathRoot, { recursive: true, force: true });
});

async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("site pilot HTTP flow records opt-in milestones and server-checked status understanding", async () => {
  const noConsent = await call("/api/site-pilot/sessions", { method: "POST", body: { scenario: "first_setup", consent: false } });
  assert.equal(noConsent.status, 400);

  const createdSite = await call("/api/sites", { method: "POST", body: { name: "试用站点", description: "验证试用闭环" } });
  const plan = await call(`/api/sites/${createdSite.body.site.id}/publication-plans`, { method: "POST", body: {} });
  await call(`/api/sites/${createdSite.body.site.id}/publication-plans/${plan.body.plan.id}/confirm`, { method: "POST", body: { confirmed: true } });

  const started = await call("/api/site-pilot/sessions", { method: "POST", body: {
    scenario: "status_understanding", consent: true, pageBody: "not retained", accessKeySecret: "not retained",
  } });
  assert.equal(started.status, 201);
  assert.equal(JSON.stringify(started.body).includes("not retained"), false);
  const session = started.body.session;
  assert.equal((await call("/api/site-pilot/sessions/active")).body.session.id, session.id);

  const completed = await call(`/api/site-pilot/sessions/${session.id}`, { method: "PATCH", body: {
    expectedRevision: session.revision,
    action: "complete",
    outcome: { statusAnswer: "local", statusCorrect: false, easeRating: 4, notes: "not retained" },
  } });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.session.outcome.statusCorrect, true);
  assert.equal(JSON.stringify(completed.body).includes("not retained"), false);

  const summary = await call("/api/site-pilot/summary");
  assert.deepEqual(summary.body.summary.metrics.statusUnderstanding, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(summary.body.summary.privacy, { contentCollected: false, credentialsCollected: false, freeTextCollected: false, participantIdentityCollected: false });

  const campaignCreated = await call("/api/site-pilot/campaigns", { method: "POST", body: { quotas: { first_setup: 1, content_maintenance: 1, status_understanding: 1 } } });
  assert.equal(campaignCreated.status, 201);
  const campaign = campaignCreated.body.campaign;
  assert.equal(campaign.decision, "collecting");
  assert.equal((await call("/api/site-pilot/campaigns")).body.count, 1);
  const generated = await call(`/api/site-pilot/campaigns/${campaign.id}/invitations`, { method: "POST", body: { scenario: "content_maintenance" } });
  assert.equal(generated.status, 201);
  const invitation = generated.body.invitation;
  const assigned = await call("/api/site-pilot/sessions", { method: "POST", body: { scenario: "content_maintenance", consent: true, campaignCode: invitation.inviteCode } });
  assert.equal(assigned.status, 201);
  assert.equal((await call(`/api/site-pilot/sessions/active?code=${encodeURIComponent(invitation.inviteCode)}`)).body.session.id, assigned.body.session.id);
  assert.equal((await call("/api/site-pilot/sessions", { method: "POST", body: { scenario: "content_maintenance", consent: true, campaignCode: invitation.inviteCode } })).body.error, "site_pilot_invitation_used");
  const unused = (await call(`/api/site-pilot/campaigns/${campaign.id}/invitations`, { method: "POST", body: { scenario: "first_setup" } })).body.invitation;
  const closed = await call(`/api/site-pilot/campaigns/${campaign.id}`, { method: "PATCH", body: { expectedRevision: campaign.revision, action: "close" } });
  assert.equal(closed.body.campaign.status, "closed");
  const refused = await call("/api/site-pilot/sessions", { method: "POST", body: { scenario: "first_setup", consent: true, campaignCode: unused.inviteCode } });
  assert.equal(refused.status, 409);
  assert.equal((await call(`/api/site-pilot/campaigns/${campaign.id}`, { method: "DELETE" })).status, 200);
});

test("each invitation gets a disposable site workspace without exposing the production site", async () => {
  const productionBefore = await call("/api/sites");
  assert.equal(productionBefore.body.count, 1);
  const productionSiteId = productionBefore.body.sites[0].id;

  const campaign = (await call("/api/site-pilot/campaigns", { method: "POST", body: {} })).body.campaign;
  const invitation = async (scenario) => (await call(`/api/site-pilot/campaigns/${campaign.id}/invitations`, { method: "POST", body: { scenario } })).body.invitation;
  const workspacePath = (code, suffix = "") => `/api/sites${suffix}${suffix.includes("?") ? "&" : "?"}pilotCode=${encodeURIComponent(code)}`;

  const first = await invitation("first_setup");
  assert.equal(first.workspace.isolated, true);
  assert.equal((await call(workspacePath(first.inviteCode))).body.count, 0);
  const sandboxCreated = await call(workspacePath(first.inviteCode), {
    method: "POST",
    body: { name: "临时首次建站", description: "只存在于邀请沙箱" },
  });
  assert.equal(sandboxCreated.status, 201);
  assert.notEqual(sandboxCreated.body.site.id, productionSiteId);
  assert.equal((await call("/api/sites")).body.sites[0].id, productionSiteId);

  const secondFirst = await invitation("first_setup");
  assert.equal((await call(workspacePath(secondFirst.inviteCode))).body.count, 0);

  const maintenance = await invitation("content_maintenance");
  const maintenanceSite = (await call(workspacePath(maintenance.inviteCode))).body.sites[0];
  assert.equal(maintenanceSite.name, "山岚工作室");
  assert.ok(maintenanceSite.activePublicationId, "maintenance starts from a published local baseline");
  assert.equal(maintenanceSite.visibility, "private_preview");
  assert.equal(maintenanceSite.unpublishedCount, 0);
  const maintenanceHome = maintenanceSite.entries.find((entry) => entry.slug === "home");
  const maintenanceHomeDetail = (await call(workspacePath(maintenance.inviteCode, `/${maintenanceSite.id}/entries/${maintenanceHome.id}`))).body.entry;
  const maintenanceEdited = await call(workspacePath(maintenance.inviteCode, `/${maintenanceSite.id}/entries/${maintenanceHome.id}`), {
    method: "PATCH",
    body: { expectedRevision: maintenanceHomeDetail.revision, title: "欢迎了解山岚工作室" },
  });
  assert.equal(maintenanceEdited.status, 200);
  assert.equal(maintenanceEdited.body.site.unpublishedCount, 1);
  const professionalMaintenance = (await call(workspacePath(maintenance.inviteCode, `/${maintenanceSite.id}?professional=1`))).body.site;
  const cloudAttempt = await call(workspacePath(maintenance.inviteCode, `/${maintenanceSite.id}/deployment-target`), {
    method: "PUT",
    body: {
      expectedRevision: professionalMaintenance.deploymentTarget.revision,
      kind: "cloudflare_pages",
      displayName: "must be blocked",
      credentialRef: "secret-ref",
      remoteProjectRef: "pilot-project",
    },
  });
  assert.equal(cloudAttempt.status, 403);
  assert.equal(cloudAttempt.body.error, "site_pilot_cloud_deployment_forbidden");

  const statusSites = [];
  const statusInvites = [];
  for (let index = 0; index < 3; index += 1) {
    const statusInvite = await invitation("status_understanding");
    statusInvites.push(statusInvite);
    statusSites.push((await call(workspacePath(statusInvite.inviteCode))).body.sites[0]);
  }
  assert.equal(Boolean(statusSites[0].activePublicationId) && statusSites[0].visibility === "private_preview", true);
  assert.equal(statusSites[1].activePublicationId, null);
  assert.equal(statusSites[2].visibility, "public");
  assert.match(statusSites[2].publicUrl, /\.pilot\.invalid\/$/);
  const statusMutation = await call(workspacePath(statusInvites[1].inviteCode, `/${statusSites[1].id}`), {
    method: "PATCH",
    body: { expectedRevision: statusSites[1].revision, name: "不应保存" },
  });
  assert.equal(statusMutation.status, 403);
  assert.equal(statusMutation.body.error, "site_pilot_workspace_read_only");

  assert.equal((await call("/api/sites")).body.count, 1);
  assert.equal((await call(`/api/site-pilot/campaigns/${campaign.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await call(workspacePath(first.inviteCode))).status, 404);
  assert.equal((await call("/api/sites")).body.sites[0].id, productionSiteId);
});
