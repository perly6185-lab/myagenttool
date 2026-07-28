import test from "node:test";
import assert from "node:assert/strict";
import { createCompositionService } from "../src/composition.mjs";

test("restart, network, timeout, disk, upgrade, and rollback faults stay owner-local", async () => {
  const faults = ["restart", "network", "timeout", "disk", "failed_upgrade", "rollback"];
  for (const fault of faults) {
    const calls = [];
    const service = createCompositionService({
      terminals: [{ id: "owner", name: "Owner", apiUrl: "http://owner", consoleUrl: "http://owner" }, { id: "other", name: "Other", apiUrl: "http://other", consoleUrl: "http://other" }],
      request: async (terminal, operation) => {
        calls.push({ terminal: terminal.id, path: operation.path });
        if (terminal.id === "owner") throw new Error(fault);
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });
    const result = await service.proxyAction({ terminalId: "owner", resourceType: "invocations", localResourceId: "inv_1", action: "cancel" });
    assert.equal(result.code, "owning_terminal_unavailable");
    assert.deepEqual(calls.map((row) => row.terminal), ["owner"]);
  }
});
