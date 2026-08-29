import assert from "node:assert/strict";
import test from "node:test";

import {
  requiredRuntimeVerificationKinds,
  resultVerificationContract,
  resultVerificationEvidence,
  verifyWorkItemResult,
} from "../src/services/work-item-result-verification.mjs";

const cases = [
  ["content_article", "article_draft", ".md", "markdown"],
  ["content_comic", "comic_package", ".pdf", "document"],
  ["content_voiceover", "voiceover_package", ".mp3", "audio"],
  ["content_video", "video_package", ".mp4", "video"],
];

test("content result verification accepts article, comic, voiceover, and video outputs", () => {
  for (const [taskKind, artifactKind, extension, family] of cases) {
    const item = {
      taskKind,
      artifactContract: {
        requirements: [{ kind: artifactKind, minCount: 1, extensions: [extension], families: [family] }],
      },
      outputAssets: [{
        id: `${artifactKind}_1`,
        path: `outputs/result${extension}`,
        family,
        size: 128,
      }],
    };
    const contract = resultVerificationContract(item, { enforced: true });
    const result = verifyWorkItemResult({ ...item, resultVerificationContract: contract });
    assert.equal(contract.enforced, true);
    assert.equal(result.status, "passed", taskKind);
    assert.equal(result.checks[0].status, "passed", taskKind);
    assert.equal(resultVerificationEvidence(item, result).length, 1, taskKind);
  }
});

test("content result verification rejects wrong formats and insufficient quantities", () => {
  const item = {
    taskKind: "content_image",
    artifactContract: {
      requirements: [{ kind: "image_set", minCount: 3, extensions: [".png", ".jpg"], families: ["image"] }],
    },
    outputAssets: [
      { id: "image_1", path: "outputs/one.png", family: "image", size: 10 },
      { id: "wrong_1", path: "outputs/two.md", family: "markdown", size: 10 },
    ],
  };
  const result = verifyWorkItemResult(item);
  assert.equal(result.status, "failed");
  assert.equal(result.checks[0].actual.matchedCount, 1);
  assert.equal(result.checks[0].actual.usableCount, 1);
  assert.match(result.summary, /1 项/);
});

test("missing or empty outputs do not pass a declared result contract", () => {
  const item = {
    taskKind: "content_article",
    artifactContract: { requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"] }] },
    outputAssets: [{ id: "empty", path: "outputs/article.md", family: "markdown", size: 0 }],
  };
  assert.equal(verifyWorkItemResult(item).status, "failed");
});

test("content quality checks validate article structure, comic pages, voice duration, and video resolution", () => {
  const casesWithQuality = [
    {
      taskKind: "content_article",
      kind: "article_draft",
      extension: ".md",
      quality: { minChars: 800, minSections: 3, requiredHeadings: ["结论"] },
      metrics: { charCount: 1_200, sectionCount: 4, headings: ["背景", "分析", "结论"] },
    },
    {
      taskKind: "content_comic",
      kind: "comic_package",
      extension: ".pdf",
      quality: { minPages: 4 },
      metrics: { pageCount: 6 },
    },
    {
      taskKind: "content_voiceover",
      kind: "voiceover_package",
      extension: ".mp3",
      quality: { minDurationSeconds: 30 },
      metrics: { durationSeconds: 45 },
    },
    {
      taskKind: "content_video",
      kind: "video_package",
      extension: ".mp4",
      quality: { minWidth: 1_280, minHeight: 720 },
      metrics: { width: 1_920, height: 1_080 },
    },
  ];
  for (const entry of casesWithQuality) {
    const item = {
      taskKind: entry.taskKind,
      artifactContract: {
        requirements: [{ kind: entry.kind, minCount: 1, extensions: [entry.extension], quality: entry.quality }],
      },
      outputAssets: [{ id: `${entry.kind}_quality`, path: `outputs/result${entry.extension}`, size: 100, contentMetrics: entry.metrics }],
    };
    assert.equal(verifyWorkItemResult(item).status, "passed", entry.taskKind);
    item.outputAssets[0].contentMetrics = {};
    const failed = verifyWorkItemResult(item);
    assert.equal(failed.status, "failed", entry.taskKind);
    assert.equal(failed.checks[0].actual.qualifiedCount, 0, entry.taskKind);
  }
});

test("software result verification requires both passed test and build evidence", () => {
  const item = {
    taskKind: "software_implementation",
    artifactContract: {
      requirements: [{ kind: "software_change", minCount: 1 }],
      verification: { requiredKinds: ["test", "build"] },
    },
    outputAssets: [{ id: "change_1", path: "outputs/change.diff", size: 20 }],
    verificationRecords: [{ id: "test_1", kind: "test", status: "passed" }],
  };
  let result = verifyWorkItemResult(item);
  assert.equal(result.status, "failed");
  assert.equal(result.verificationChecks.find((check) => check.kind === "build").status, "failed");
  item.verificationRecords.push({ id: "build_1", kind: "build", status: "passed" });
  result = verifyWorkItemResult(item);
  assert.equal(result.status, "passed");
  assert.deepEqual(resultVerificationEvidence(item, result).map((entry) => entry.ref).sort(), ["build_1", "outputs/change.diff", "test_1"]);
});

test("legacy documentation-only software tasks migrate away from irrelevant test and build requirements", () => {
  const item = {
    title: "文档型代码任务：新增 docs/client-closure.md",
    body: "这是文档型代码任务，仅新增 docs/client-closure.md 并逐字检查内容。",
    taskKind: "software_implementation",
    artifactContract: {
      requirements: [{ kind: "software_change", minCount: 1, extensions: [".diff", ".patch", ".md", ".txt"] }],
      verification: { requiredKinds: ["test", "build"] },
    },
    executionArtifacts: [{
      id: "aur_docs:software_change",
      kind: "software_change",
      source: "auto_run",
      autoRunId: "aur_docs",
      worktreeId: "wtr_docs",
      changedFiles: ["docs/client-closure.md"],
      changedFileCount: 1,
    }],
    verificationRecords: [],
  };

  const contract = resultVerificationContract(item, { enforced: true });
  const result = verifyWorkItemResult({ ...item, resultVerificationContract: contract });
  assert.deepEqual(contract.verificationChecks, []);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.verificationChecks, []);

  const codeTask = {
    ...item,
    title: "Implement session handling",
    body: "Change src/session.mjs and update its tests.",
    executionArtifacts: [{ ...item.executionArtifacts[0], changedFiles: ["src/session.mjs"] }],
  };
  assert.deepEqual(resultVerificationContract(codeTask, { enforced: true }).verificationChecks, [
    { kind: "test" },
    { kind: "build" },
  ]);
});

test("legacy tasks mislabeled as software implementation migrate when the declared and delivered scope is one document", () => {
  const workItem = {
    title: "软件实现",
    body: "在当前项目新增 docs/client-closure.md，内容仅包含指定标题和说明。不修改其他文件。",
    taskKind: "software_implementation",
    intentContract: {
      goal: "这是代码实现任务：新增 docs/client-closure.md，内容仅包含指定标题和说明。不修改其他文件。",
    },
    artifactContract: {
      requirements: [{ kind: "software_change", minCount: 1 }],
      verification: { requiredKinds: ["test", "build"] },
    },
    executionArtifacts: [{
      id: "artifact-doc-only-legacy",
      kind: "software_change",
      source: "auto_run",
      worktreeId: "wtr-doc-only-legacy",
      changedFileCount: 1,
      changedFiles: ["docs/client-closure.md"],
    }],
  };

  assert.deepEqual(requiredRuntimeVerificationKinds(workItem), []);
  const result = verifyWorkItemResult(workItem);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.verificationChecks, []);
});

test("legacy Auto-run recovery evidence supplies a bounded software-change contract", () => {
  const item = {
    taskKind: "general",
    artifactContract: { consumes: [], produces: [] },
    executionArtifacts: [{
      id: "aur_legacy:software_change", kind: "software_change", source: "auto_run",
      worktreeId: "wtr_legacy", changedFileCount: 1, changedFiles: ["docs/result.md"],
      legacyExecutionRecovery: true, recoveryRequestId: "ear_legacy",
    }],
  };

  const contract = resultVerificationContract(item, { enforced: true });
  assert.equal(contract.enforced, true);
  assert.deepEqual(contract.verificationChecks, []);
  assert.equal(verifyWorkItemResult({ ...item, resultVerificationContract: contract }).status, "passed");
});

test("authoritative Auto-run Worktree changes satisfy software-change artifact evidence", () => {
  const item = {
    taskKind: "software_implementation",
    artifactContract: {
      requirements: [{ kind: "software_change", minCount: 1, extensions: [".diff"] }],
      verification: { requiredKinds: ["test", "build"] },
    },
    outputAssets: [],
    executionArtifacts: [{
      id: "aur_1:software_change", kind: "software_change", source: "auto_run",
      autoRunId: "aur_1", worktreeId: "wtr_1",
      changedFiles: ["src/session.mjs"], changedFileCount: 1,
    }],
    verificationRecords: [
      { id: "test_1", kind: "test", status: "passed" },
      { id: "build_1", kind: "build", status: "passed" },
    ],
  };
  const result = verifyWorkItemResult(item);
  assert.equal(result.status, "passed");
  assert.equal(result.checks[0].actual.qualifiedCount, 1);
  assert.deepEqual(resultVerificationEvidence(item, result).map((entry) => entry.ref).sort(), ["build_1", "test_1", "wtr_1"]);
});

test("failed checks produce an independent repair proposal instead of extending the original task", () => {
  const result = verifyWorkItemResult({
    title: "客户方案",
    taskKind: "business_document",
    artifactContract: { requirements: [{ kind: "business_document", minCount: 1, extensions: [".docx", ".pdf"] }] },
    outputAssets: [{ id: "wrong", path: "outputs/notes.txt", size: 10 }],
  });
  assert.equal(result.status, "failed");
  assert.equal(result.repair.mode, "independent_task");
  assert.match(result.repair.suggestedRequest, /客户方案/);
  assert.match(result.repair.suggestedRequest, /business_document/);
});
