export const loopRoutineScheduleModes = [
  "manual",
  "cron",
  "event",
] as const;

export type LoopRoutineScheduleMode = (typeof loopRoutineScheduleModes)[number];

export const loopRoutineInputTypes = [
  "filesystem.glob",
  "git.commits",
  "github.issues",
  "github.prs",
  "github.checks",
  "github.commits",
  "loop.registry",
] as const;

export type LoopRoutineInputType = (typeof loopRoutineInputTypes)[number];

export const loopRoutineCheckTypes = [
  "command",
  "loop-registry",
  "docs-check",
  "typecheck",
  "test",
] as const;

export type LoopRoutineCheckType = (typeof loopRoutineCheckTypes)[number];

export const loopRoutineWritePolicies = [
  "forbidden",
  "approval-required",
  "allowed",
] as const;

export type LoopRoutineWritePolicy = (typeof loopRoutineWritePolicies)[number];

export type LoopRoutineSpec = {
  apiVersion: "myagenttool.dev/v1";
  kind: "LoopRoutine";
  metadata: {
    id: string;
    name: string;
    description: string;
    owner: string;
    enabled: boolean;
  };
  schedule: {
    mode: LoopRoutineScheduleMode;
    timezone: string;
    cron: string | null;
    event: string | null;
    maxConcurrency: number;
    cooldownMs: number;
    deadlineMs: number;
  };
  inputs: Array<{
    id: string;
    type: LoopRoutineInputType;
    [key: string]: unknown;
  }>;
  skills: Array<{
    id: string;
    path: string;
    required: boolean;
    sourcePath?: string;
  }>;
  goal: {
    summary: string;
    successCriteria: string[];
    fanout: {
      enabled: boolean;
      mode: string;
      priority: string;
      apply: boolean;
      verify: boolean;
      isolateWorktree: boolean;
    };
  };
  checks: Array<{
    id: string;
    type: LoopRoutineCheckType;
    command?: string;
    required?: boolean;
    [key: string]: unknown;
  }>;
  outputs: {
    summary: string;
    findings: string;
    enqueueFindings: boolean;
  };
  safety: {
    remoteWrites: LoopRoutineWritePolicy;
    githubWrites: LoopRoutineWritePolicy;
    requiresApprovalFor: string[];
    commandAllowlist: string[];
  };
};

export type LoopRoutineFindingSeverity = "low" | "medium" | "high" | "critical";

export type LoopRoutineFinding = {
  id: string;
  title: string;
  severity: LoopRoutineFindingSeverity;
  source: {
    type: string;
    [key: string]: unknown;
  };
  evidence: string[];
  proposedAction: string;
  skillBindings?: Array<{
    id: string;
    path: string;
    title: string;
    summary: string;
    sha256: string;
    acceptance: string[];
    checks: string[];
  }>;
  suggestedRun: {
    mode: string;
    runId?: string;
    issue?: string | null;
    priority?: string;
    apply?: boolean;
    verify?: boolean;
    isolateWorktree?: boolean;
    [key: string]: unknown;
  } | null;
  createdAt: string;
};

export type LoopRoutineCheckResult = {
  id: string;
  type: LoopRoutineCheckType;
  command: string | null;
  required: boolean;
  status: "passed" | "failed" | "skipped";
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
  stdout: string;
  stderr: string;
  error: string | null;
};
