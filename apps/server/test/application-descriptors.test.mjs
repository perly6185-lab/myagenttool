import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";

function service() {
  const state = { applications: [], projects: [], events: [] };
  return createApplicationService({
    state,
    now: () => "2026-07-07T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    appendEvent: (event) => state.events.push(event),
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

test("descriptor updates can clear MCP, manual, and npm wrapper descriptors", () => {
  const svc = service();
  const manual = svc.registerApplication({
    id: "app_manual_descriptor",
    name: "Manual Descriptor",
    source: {
      type: "manual",
      uri: "manual://fixture",
      manifest: {
        capabilities: [{ name: "render", description: "Render fixture." }],
      },
    },
    mcpAgent: {
      transport: "stdio",
      command: "node",
      args: ["server.mjs"],
      allowedTools: ["render"],
    },
  });
  assert.equal(manual.mcpAgent.allowedTools[0], "render");
  assert.equal(manual.source.manifest.capabilities.length, 1);

  const clearedManual = svc.updateApplicationDescriptors("app_manual_descriptor", {
    mcpAgent: null,
    manualManifest: null,
  });
  assert.equal(clearedManual.mcpAgent, null);
  assert.deepEqual(clearedManual.source.manifest, {});

  const npm = svc.registerApplication({
    id: "app_npm_descriptor",
    name: "NPM Descriptor",
    source: {
      type: "npm",
      package: "@scope/descriptor",
      wrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        commands: [{
          id: "report",
          commandType: "custom",
          command: "node",
          status: "approved",
        }],
      },
    },
  });
  assert.equal(npm.source.wrapper.mode, "installed-wrapper");

  const clearedNpm = svc.updateApplicationDescriptors("app_npm_descriptor", { npmWrapper: null });
  assert.equal(clearedNpm.source.wrapper.mode, "metadata-only");
  assert.equal(clearedNpm.source.wrapper.commands.length, 0);
});
