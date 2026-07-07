import { describe, expect, it } from "vitest";
import {
  applicationMatchesSearch,
  applicationNextStep,
  applicationOperationIssues,
  applicationTriageBucket,
  applicationTriageCounts,
  latestApplicationRecoveryAction,
  sortApplicationsForTriage,
  sourceSummary,
} from "@/features/applications/application-health";
import type { ApplicationRecoveryActionRequest, ApplicationSnapshot } from "@/lib/console-state";

describe("sourceSummary", () => {
  it("summarizes each application source type", () => {
    expect(sourceSummary({ type: "git", url: "github.com/acme/web" })).toBe("github.com/acme/web");
    expect(sourceSummary({ type: "local", path: "/path/to/app" })).toBe("/path/to/app");
    expect(sourceSummary({ type: "npm", package: "@scope/pkg", version: "1.0.0" })).toBe("@scope/pkg@1.0.0");
    expect(sourceSummary({ type: "npm", package: "left-pad" })).toBe("left-pad");
    expect(sourceSummary({ type: "manual", uri: "https://example.com" })).toBe("https://example.com");
    expect(sourceSummary({ type: "manual" })).toBe("manual manifest");
  });
});

describe("applicationNextStep", () => {
  it("prioritizes actionable application guidance", () => {
    expect(applicationNextStep(application({ status: "failed", lifecycle: { error: "Clone failed." } })).title).toBe("Needs attention");
    expect(applicationNextStep(application({ status: "active", probe: null })).title).toBe("Probe recommended");
    expect(applicationNextStep(application({
      status: "active",
      probe: { warnings: ["README not readable."], capabilities: [] },
    })).detail).toBe("README not readable.");
    expect(applicationNextStep(application({
      status: "active",
      probe: {
        capabilities: [],
        diff: { addedCapabilityNames: ["app.docs.inferred.script.test"], removedCapabilityNames: [] },
      },
    })).title).toBe("Probe changes detected");
    expect(applicationNextStep(application({
      status: "active",
      wrapper: {
        mode: "installed-wrapper",
        installState: "installed",
        readiness: {
          state: "needs_setup",
          reason: "wrapper_command_unresolved",
          blockedCommandIds: ["test"],
        },
      },
      probe: { warnings: ["README not readable."], capabilities: [] },
    })).detail).toBe("1 wrapper command(s) need setup: wrapper_command_unresolved.");
    expect(applicationNextStep(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
      healthSummary: {
        applicationId: "app_docs",
        eventCounts: { error: 0, warning: 0, info: 0, other: 0 },
        eventCount: 0,
        automationCounts: { failing: 1, waitingForApproval: 0, paused: 0, attention: 1 },
        latestAutomationAttention: {
          automationId: "atm_docs",
          name: "Docs daily",
          status: "failing",
          failureStreak: 2,
          latestInvocationId: "inv_docs",
          lastErrorSummary: "Wrapper command exited 1.",
          nextAction: "Pause the schedule and inspect the latest invocation.",
        },
      },
    }))).toEqual({
      title: "Schedule failing",
      detail: "Wrapper command exited 1.",
      tone: "danger",
    });
    expect(applicationNextStep(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
      healthSummary: {
        applicationId: "app_docs",
        eventCounts: { error: 0, warning: 0, info: 0, other: 0 },
        eventCount: 0,
        automationCounts: { failing: 0, waitingForApproval: 1, paused: 0, attention: 1 },
        latestAutomationAttention: {
          automationId: "atm_docs",
          name: "Docs daily",
          status: "waiting_for_approval",
          failureStreak: 0,
          latestInvocationId: "inv_docs",
          nextAction: "Resolve the linked approval request before the automation can continue.",
        },
      },
    }))).toMatchObject({
      title: "Schedule waiting for approval",
      tone: "warning",
    });
    expect(applicationNextStep(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
    })).title).toBe("Ready");
  });
});

describe("applicationOperationIssues", () => {
  it("surfaces paused schedules as resumable operator work", () => {
    const issues = applicationOperationIssues(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
      healthSummary: {
        applicationId: "app_docs",
        eventCounts: { error: 0, warning: 0, info: 0, other: 0 },
        eventCount: 0,
        automationCounts: { failing: 0, waitingForApproval: 0, paused: 1, attention: 1 },
        latestAutomationAttention: {
          automationId: "atm_docs",
          name: "Docs daily",
          status: "paused",
          nextAction: "Resume the schedule when it should run again.",
        },
      },
    }));

    expect(issues[0]).toMatchObject({
      id: "automation_paused",
      title: "Schedule paused",
      action: "automation",
      actionLabel: "Resume schedule",
      automationId: "atm_docs",
    });
  });

  it("surfaces manual MCP candidates that are ready for review", () => {
    const issues = applicationOperationIssues(application({
      status: "active",
      orchestrationIds: ["routine"],
      probe: {
        capabilities: [],
        mcpServers: [{
          id: "mcp.shell",
          serverName: "shell",
          transport: "stdio",
          status: "ready",
          autoRegister: false,
        }],
      },
      mcpAgent: null,
    }));

    expect(issues[0]).toMatchObject({
      id: "mcp_manual_confirm",
      title: "MCP review needed",
      action: "mcp",
      actionLabel: "Review MCP",
    });
  });

  it("surfaces HTTP MCP candidates that need live endpoint probe evidence", () => {
    const issues = applicationOperationIssues(application({
      status: "active",
      orchestrationIds: ["routine"],
      probe: {
        capabilities: [],
        mcpServers: [{
          id: "mcp.remote",
          serverName: "remote",
          transport: "http",
          status: "ready",
          autoRegister: false,
          review: {
            liveProbe: {
              state: "not_run",
              requiredBeforeExecution: true,
              nextAction: "Probe the endpoint before confirming shared tools.",
            },
          },
        }],
      },
      mcpAgent: null,
    }));

    expect(issues[0]).toMatchObject({
      id: "mcp_http_probe_mcp.remote",
      title: "HTTP MCP probe needed",
      action: "mcp_probe",
      actionLabel: "Probe endpoint",
      mcpCandidateId: "mcp.remote",
    });
  });

  it("keeps HTTP MCP confirmation guidance after live probe evidence succeeds", () => {
    const issues = applicationOperationIssues(application({
      status: "active",
      orchestrationIds: ["routine"],
      probe: {
        capabilities: [],
        mcpServers: [{
          id: "mcp.remote",
          serverName: "remote",
          transport: "http",
          status: "ready",
          autoRegister: false,
          review: {
            liveProbe: {
              state: "succeeded",
              requiredBeforeExecution: true,
              evidence: "json_rpc_initialize_tools_list",
            },
          },
        }],
      },
      mcpAgent: null,
    }));

    expect(issues[0]).toMatchObject({
      id: "mcp_manual_confirm",
      title: "MCP review needed",
      action: "mcp",
      actionLabel: "Review MCP",
    });
  });

  it("surfaces the latest timeline attention event with the right filter action", () => {
    const issues = applicationOperationIssues(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
      healthSummary: {
        applicationId: "app_docs",
        eventCounts: { error: 1, warning: 0, info: 0, other: 0 },
        eventCount: 1,
        latestAttentionEvent: {
          id: "evt_failed",
          type: "application_probe_failed",
          level: "error",
          message: "Probe command failed.",
          data: {},
          createdAt: "2026-07-06T01:00:00.000Z",
        },
      },
    }));

    expect(issues[0]).toMatchObject({
      id: "event_evt_failed",
      title: "Timeline error",
      action: "timeline",
      actionLabel: "View errors",
      eventLevel: "error",
    });
  });

  it("treats pending recovery approvals as open recovery work", () => {
    const issues = applicationOperationIssues(
      application({
        status: "active",
        probe: { capabilities: [] },
        orchestrationIds: ["routine"],
      }),
      [recoveryAction({
        id: "rec_pending",
        status: "approval_pending",
        explanation: {
          state: "approval_pending",
          nextStep: "Resolve the linked approval request before this recovery can execute.",
        },
      })],
    );

    expect(issues[0]).toMatchObject({
      id: "recovery_rec_pending",
      title: "Recovery action open",
      action: "recovery",
      actionLabel: "View recovery",
      routineId: "routine_docs",
      invocationId: "inv_docs",
    });
  });
});

describe("application triage", () => {
  it("buckets applications by their current operator next step", () => {
    expect(applicationTriageBucket(application({ status: "failed" }))).toBe("attention");
    expect(applicationTriageBucket(application({ status: "active", probe: null }))).toBe("warning");
    expect(applicationTriageBucket(application({
      status: "active",
      probe: { capabilities: [] },
      orchestrationIds: ["routine"],
    }))).toBe("ready");
  });

  it("counts triage buckets for the current application scope", () => {
    expect(applicationTriageCounts([
      application({ id: "app_failed", status: "failed" }),
      application({ id: "app_probe", status: "active", probe: null }),
      application({ id: "app_ready", status: "active", probe: { capabilities: [] }, orchestrationIds: ["routine"] }),
      application({ id: "app_archived", status: "archived" }),
      application({
        id: "app_schedule_failed",
        status: "active",
        probe: { capabilities: [] },
        orchestrationIds: ["routine"],
        healthSummary: {
          applicationId: "app_schedule_failed",
          eventCounts: { error: 0, warning: 0, info: 0, other: 0 },
          eventCount: 0,
          automationCounts: { failing: 1, waitingForApproval: 0, paused: 0, attention: 1 },
          latestAutomationAttention: null,
        },
      }),
    ])).toEqual({
      attention: 3,
      warning: 1,
      ready: 1,
    });
  });
});

describe("application search and ordering", () => {
  it("matches application search across name, id, source, path, and guidance", () => {
    const app = application({
      id: "app_ccusage",
      name: "ccusage Reports",
      kind: "npm",
      source: { type: "npm", package: "@acme/ccusage", version: "2.0.0" },
      path: "/apps/ccusage",
      status: "failed",
      lifecycle: { error: "Package metadata missing." },
    });

    expect(applicationMatchesSearch(app, "ccusage")).toBe(true);
    expect(applicationMatchesSearch(app, "@acme 2.0.0")).toBe(true);
    expect(applicationMatchesSearch(app, "/apps metadata")).toBe(true);
    expect(applicationMatchesSearch(app, "needs attention")).toBe(true);
    expect(applicationMatchesSearch(app, "doocs")).toBe(false);
  });

  it("sorts attention first, then newest updates within each triage bucket", () => {
    const ordered = sortApplicationsForTriage([
      application({
        id: "app_ready_new",
        name: "Ready New",
        status: "active",
        probe: { capabilities: [] },
        orchestrationIds: ["routine"],
        updatedAt: "2026-07-06T03:00:00.000Z",
      }),
      application({
        id: "app_watch",
        name: "Watch",
        status: "active",
        probe: null,
        updatedAt: "2026-07-06T01:00:00.000Z",
      }),
      application({
        id: "app_attention_old",
        name: "Attention Old",
        status: "failed",
        updatedAt: "2026-07-06T00:00:00.000Z",
      }),
      application({
        id: "app_attention_new",
        name: "Attention New",
        status: "failed",
        updatedAt: "2026-07-06T02:00:00.000Z",
      }),
    ]);

    expect(ordered.map((app) => app.id)).toEqual([
      "app_attention_new",
      "app_attention_old",
      "app_watch",
      "app_ready_new",
    ]);
  });
});

describe("latestApplicationRecoveryAction", () => {
  it("selects the newest recovery action for one application", () => {
    const latest = latestApplicationRecoveryAction("app_docs", [
      recoveryAction({ id: "rec_old", applicationId: "app_docs", updatedAt: "2026-07-06T01:00:00.000Z" }),
      recoveryAction({ id: "rec_other", applicationId: "app_other", updatedAt: "2026-07-06T04:00:00.000Z" }),
      recoveryAction({ id: "rec_new", applicationId: "app_docs", updatedAt: "2026-07-06T03:00:00.000Z" }),
    ]);

    expect(latest?.id).toBe("rec_new");
  });
});

function application(overrides: Partial<ApplicationSnapshot>): ApplicationSnapshot {
  return {
    id: "app_docs",
    name: "Docs",
    kind: "repository",
    source: { type: "local", path: "/repo" },
    status: "active",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

function recoveryAction(overrides: Partial<ApplicationRecoveryActionRequest>): ApplicationRecoveryActionRequest {
  return {
    id: "rec",
    applicationId: "app_docs",
    routineId: "routine_docs",
    invocationId: "inv_docs",
    actionType: "rerun",
    status: "executed",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}
