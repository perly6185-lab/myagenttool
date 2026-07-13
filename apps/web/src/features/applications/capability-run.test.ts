import { describe, expect, it } from "vitest";
import {
  buildInvokeBody,
  capabilityRunContract,
  explainRunFailure,
  runBlocker,
} from "@/features/applications/capability-run";
import type { ApplicationCapability } from "@/lib/console-state";

function capability(overrides: Partial<ApplicationCapability> = {}): ApplicationCapability {
  return {
    name: "app.app_git.wrapper.log",
    displayName: "Git log",
    riskLevel: "low",
    requiresApproval: false,
    status: "available",
    invocationMode: "gateway",
    inputSchema: {
      properties: {
        since: { type: "date" },
        author: { type: "token" },
      },
    },
    metadata: { wrapper: { cwdPolicy: "invocation_root", filePolicy: "read_only" } },
    ...overrides,
  };
}

describe("capabilityRunContract", () => {
  it("reads the need for a repository from the published contract, not from the app's name", () => {
    // The panel must stay generic: nothing here knows what git is. A capability
    // needs a repository because it SAYS it runs in one.
    expect(capabilityRunContract(capability()).needsProject).toBe(true);
    expect(
      capabilityRunContract(capability({ metadata: { wrapper: { cwdPolicy: "fixed" } } })).needsProject,
    ).toBe(false);
    expect(capabilityRunContract(capability({ metadata: {} })).needsProject).toBe(false);
  });

  it("builds the form from the declared inputs", () => {
    const contract = capabilityRunContract(capability());
    expect(contract.inputs).toEqual([
      { key: "since", type: "date", values: [] },
      { key: "author", type: "token", values: [] },
    ]);
  });

  it("carries enum values through as a closed choice", () => {
    const contract = capabilityRunContract(
      capability({ inputSchema: { properties: { mode: { type: "enum", enum: ["fast", "full"] } } } }),
    );
    expect(contract.inputs[0].values).toEqual(["fast", "full"]);
  });

  it("a disabled or non-invokable capability is not runnable, and says why", () => {
    const disabled = capabilityRunContract(capability({ status: "disabled" }));
    expect(disabled.invokable).toBe(false);
    expect(disabled.blockedReason).toMatch(/offline or archived/i);

    const discovered = capabilityRunContract(capability({ invocationMode: "not_invokable" }));
    expect(discovered.invokable).toBe(false);
    expect(discovered.blockedReason).toMatch(/no approved wrapper/i);
  });
});

describe("runBlocker", () => {
  it("blocks an invocation-root run with no repository IN THE UI, rather than letting it 409", () => {
    const contract = capabilityRunContract(capability());
    expect(runBlocker(contract, { projectId: "", values: {} })).toMatch(/choose the repository/i);
    expect(runBlocker(contract, { projectId: "prj_1", values: {} })).toBeNull();
  });

  it("does not demand a repository from a capability that does not run in one", () => {
    const contract = capabilityRunContract(capability({ metadata: { wrapper: { cwdPolicy: "fixed" } } }));
    expect(runBlocker(contract, { projectId: "", values: {} })).toBeNull();
  });
});

describe("buildInvokeBody", () => {
  it("sends the project and only the declared, non-empty inputs", () => {
    const contract = capabilityRunContract(capability());
    const body = buildInvokeBody(contract, {
      projectId: "prj_1",
      values: { since: "2026-07-01", author: "  ", nonsense: "x" },
    });
    expect(body).toEqual({ projectId: "prj_1", since: "2026-07-01" });
  });

  it("an undeclared field cannot be smuggled through the form", () => {
    const contract = capabilityRunContract(capability({ inputSchema: { properties: {} } }));
    const body = buildInvokeBody(contract, {
      projectId: "prj_1",
      values: { approvalToken: "forged", author: "octocat" },
    });
    expect(body).toEqual({ projectId: "prj_1" });
  });
});

describe("explainRunFailure", () => {
  it("turns the server's refusal codes into something an operator can act on", () => {
    expect(explainRunFailure("409 invocation_root_requires_project")).toMatch(/choose a project/i);
    expect(explainRunFailure("409 approval_required")).toMatch(/approval/i);
    expect(explainRunFailure("409 application_offline")).toMatch(/offline/i);
    // An unrecognized error is passed through verbatim rather than mangled into a
    // reassuring lie.
    expect(explainRunFailure("500 something new")).toBe("500 something new");
  });
});
