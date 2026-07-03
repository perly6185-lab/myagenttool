import { describe, expect, it } from "vitest";
import { classifyEvent, type TranscriptBlockKind } from "@/features/invocations/transcript";

function ev(type: string, level?: string) {
  return { id: "e", type, createdAt: "2026-07-03T00:00:00Z", ...(level ? { level } : {}) };
}

describe("classifyEvent", () => {
  it("routes approvals (actionable) regardless of level", () => {
    expect(classifyEvent(ev("local_approval_requested"))).toBe("approval");
    expect(classifyEvent(ev("local_approval_denied", "warn"))).toBe("approval");
    expect(classifyEvent(ev("codex_approval_requested"))).toBe("approval");
  });

  it("routes warnings by level or a _failed type", () => {
    expect(classifyEvent(ev("log", "warn"))).toBe("warning");
    expect(classifyEvent(ev("lifecycle_failed"))).toBe("warning");
    expect(classifyEvent(ev("cancel_failed"))).toBe("warning");
  });

  it("routes review findings to diff and CLI output to command", () => {
    expect(classifyEvent(ev("codex_review_findings_recorded"))).toBe("diff");
    expect(classifyEvent(ev("command"))).toBe("command");
    expect(classifyEvent(ev("git"))).toBe("command");
    expect(classifyEvent(ev("codex_hook_event"))).toBe("command");
  });

  it("falls back to status for lifecycle/unknown types (never throws)", () => {
    expect(classifyEvent(ev("invocation_started"))).toBe("status");
    expect(classifyEvent(ev("delivery_queued"))).toBe("status");
    expect(classifyEvent(ev("some_future_type"))).toBe("status");
    expect(classifyEvent(ev(""))).toBe("status");
  });

  it("classifies every known event type into a valid kind", () => {
    const kinds: TranscriptBlockKind[] = ["status", "command", "approval", "warning", "diff"];
    const types = [
      "invocation_created", "invocation_authorized", "invocation_started", "invocation_rejected",
      "delivery_acknowledged", "delivery_redelivered", "local_approval_requested",
      "local_approval_granted", "local_approval_denied", "codex_approval_requested",
      "codex_approval_granted", "cancel_requested", "cancel_applied", "cancel_failed",
      "lifecycle_requested", "lifecycle_started", "lifecycle_completed", "lifecycle_failed",
      "command", "cli", "git", "log", "codex_hook_event", "codex_session_registered",
      "codex_review_findings_recorded", "claude_review_findings_recorded",
    ];
    for (const type of types) {
      expect(kinds).toContain(classifyEvent(ev(type)));
    }
  });
});
