import test from "node:test";
import assert from "node:assert/strict";
import {
  taskCapabilityReadiness,
  taskPlanCapabilityReadiness,
} from "../src/services/task-capability-readiness.mjs";

test("ordinary text work can use a general agent while media work fails closed", () => {
  const state = { agents: [{ status: "available", health: { status: "healthy" }, capabilities: [{ name: "codex_repo_task" }] }], applications: [] };
  assert.equal(taskCapabilityReadiness(state, "content_article").ready, true);
  assert.deepEqual(taskCapabilityReadiness(state, "content_image"), {
    ready: false,
    taskKind: "content_image",
    requiredCapability: "图片生成能力",
    reason: "specialized_capability_unavailable",
    setupSection: "applications",
  });
});

test("a healthy governed capability contract unlocks only its matching media task", () => {
  const state = {
    agents: [],
    applications: [{
      id: "app_images", name: "Image Generator", status: "active", health: { status: "healthy" },
      capabilityFacades: [{
        id: "generate",
        directInvocation: true,
        taskCapabilityContract: {
          id: "media.image.generate",
          operations: ["generate"],
          outputArtifactKinds: ["image_set", "comic_package"],
        },
      }],
    }],
  };
  const result = taskPlanCapabilityReadiness(state, [
    { kind: "content_article" }, { kind: "content_image" }, { kind: "content_video" },
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].taskKind, "content_video");
  assert.equal(taskCapabilityReadiness(state, "content_image").ready, true);
});

test("a matching name or tool string cannot impersonate an executable capability contract", () => {
  const state = {
    applications: [{
      id: "app_fake_video", name: "Best Video Generation Provider", description: "generate video",
      status: "active", health: { status: "healthy" },
      capabilityFacades: [{ id: "generate_video", agentToolName: "video_generation" }],
    }],
  };
  assert.equal(taskCapabilityReadiness(state, "content_video").ready, false);
});

test("a declared contract still fails closed when its provider health is unknown", () => {
  const state = {
    applications: [{
      id: "app_images", status: "active",
      capabilityFacades: [{
        id: "generate",
        taskCapabilityContract: { id: "media.image.generate", operations: ["generate"], outputArtifactKinds: ["image_set"] },
      }],
    }],
  };
  assert.equal(taskCapabilityReadiness(state, "content_image").ready, false);
});
