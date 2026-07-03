import { describe, expect, it } from "vitest";
import { latestRoutineInvocation, orchestrationTask } from "@/features/applications/applications-inspector";
import type { ApplicationOrchestration, ApplicationSnapshot, InvocationSnapshot } from "@/lib/console-state";

const application = {
  id: "app_docs",
  name: "Docs",
  kind: "repository",
  source: { type: "git", url: "https://github.com/acme/docs.git" },
  status: "active",
} satisfies ApplicationSnapshot;

describe("orchestrationTask", () => {
  it("builds an audit-friendly task from an application draft", () => {
    const orchestration = {
      routineId: "routine_docs_smoke",
      relativePath: ".myagenttool/routines/routine_docs_smoke.json",
    } satisfies ApplicationOrchestration;

    expect(orchestrationTask(application, orchestration)).toContain("routine_docs_smoke");
    expect(orchestrationTask(application, orchestration)).toContain("Docs");
    expect(orchestrationTask(application, orchestration)).toContain(".myagenttool/routines/routine_docs_smoke.json");
    expect(orchestrationTask(application, orchestration)).toContain("audit-friendly evidence");
  });
});

describe("latestRoutineInvocation", () => {
  it("selects the newest matching application orchestration invocation", () => {
    const invocations = [
      invocation("inv_new", "app_docs", "routine_docs_smoke"),
      invocation("inv_other_routine", "app_docs", "routine_docs_lint"),
      invocation("inv_other_app", "app_blog", "routine_docs_smoke"),
      invocation("inv_old", "app_docs", "routine_docs_smoke"),
    ];

    expect(latestRoutineInvocation(invocations, "app_docs", "routine_docs_smoke")?.id).toBe("inv_new");
  });

  it("ignores invocations without application orchestration metadata", () => {
    const invocations = [
      {
        id: "inv_manual",
        options: { metadata: { applicationId: "app_docs", routineId: "routine_docs_smoke" } },
      },
    ] satisfies InvocationSnapshot[];

    expect(latestRoutineInvocation(invocations, "app_docs", "routine_docs_smoke")).toBeNull();
  });
});

function invocation(id: string, applicationId: string, routineId: string): InvocationSnapshot {
  return {
    id,
    status: "queued",
    options: {
      metadata: {
        source: "application_orchestration",
        applicationId,
        routineId,
      },
    },
  };
}
