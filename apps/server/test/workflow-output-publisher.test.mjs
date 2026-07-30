import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  buildWorkflowPublicationPreview,
  publishWorkflowOutputFiles,
  WORKFLOW_PUBLICATION_VERSION,
} from "../src/services/workflow-output-publisher.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "workflow-publisher-"));
  const source = join(root, "source");
  const target = join(root, "target");
  mkdirSync(source);
  mkdirSync(target);
  return { root, source, target };
}

test("previews and atomically publishes unchanged files without overwriting targets", async () => {
  const { root, source, target } = fixture();
  try {
    mkdirSync(join(source, "deliveries"), { recursive: true });
    writeFileSync(join(source, "deliveries", "report.md"), "# Report\n");
    const outputs = [{ relativePath: "deliveries/report.md", extension: "md" }];
    const preview = await buildWorkflowPublicationPreview({ sourceRoot: source, targetRoot: target, outputs });

    assert.equal(preview.version, WORKFLOW_PUBLICATION_VERSION);
    assert.equal(preview.conflictCount, 0);
    assert.match(preview.files[0].sha256, /^[a-f0-9]{64}$/);
    const published = await publishWorkflowOutputFiles({
      sourceRoot: source,
      targetRoot: target,
      preview,
      previewId: "preview-1",
    });
    assert.equal(published.files.length, 1);
    assert.equal(readFileSync(join(target, "deliveries", "report.md"), "utf8"), "# Report\n");
    assert.equal(
      readdirSync(join(target, "deliveries")).some((name) => name.includes(".myagenttool-")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports existing files and refuses a target occupied after preview without partial publication", async () => {
  const { root, source, target } = fixture();
  try {
    mkdirSync(join(source, "deliveries"), { recursive: true });
    writeFileSync(join(source, "deliveries", "one.md"), "one");
    writeFileSync(join(source, "deliveries", "two.md"), "two");
    writeFileSync(join(source, "occupied.md"), "generated");
    const outputs = [
      { relativePath: "deliveries/one.md", extension: "md" },
      { relativePath: "deliveries/two.md", extension: "md" },
    ];
    writeFileSync(join(target, "occupied.md"), "user");
    const occupied = await buildWorkflowPublicationPreview({
      sourceRoot: source,
      targetRoot: target,
      outputs: [{ relativePath: "occupied.md", extension: "md" }],
    });
    assert.equal(occupied.conflictCount, 1);
    assert.equal(occupied.files[0].targetState, "conflict");

    const preview = await buildWorkflowPublicationPreview({ sourceRoot: source, targetRoot: target, outputs });
    mkdirSync(join(target, "deliveries"), { recursive: true });
    writeFileSync(join(target, "deliveries", "two.md"), "concurrent user file");
    await assert.rejects(
      publishWorkflowOutputFiles({
        sourceRoot: source,
        targetRoot: target,
        preview,
        previewId: "preview-2",
      }),
      (error) => error.code === "workflow_publication_target_conflict",
    );
    assert.equal(existsSync(join(target, "deliveries", "one.md")), false);
    assert.equal(readFileSync(join(target, "deliveries", "two.md"), "utf8"), "concurrent user file");
    assert.equal(
      readdirSync(join(target, "deliveries")).some((name) => name.includes(".myagenttool-")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects changed sources, traversal, and symbolic-link publication paths", async () => {
  const { root, source, target } = fixture();
  try {
    writeFileSync(join(source, "report.md"), "before");
    const preview = await buildWorkflowPublicationPreview({
      sourceRoot: source,
      targetRoot: target,
      outputs: [{ relativePath: "report.md", extension: "md" }],
    });
    writeFileSync(join(source, "report.md"), "after");
    await assert.rejects(
      publishWorkflowOutputFiles({
        sourceRoot: source,
        targetRoot: target,
        preview,
        previewId: "preview-3",
      }),
      (error) => error.code === "workflow_publication_source_changed",
    );
    await assert.rejects(
      buildWorkflowPublicationPreview({
        sourceRoot: source,
        targetRoot: target,
        outputs: [{ relativePath: "../escape.md", extension: "md" }],
      }),
      (error) => error.code === "workflow_publication_path_invalid",
    );
    mkdirSync(join(source, "real"));
    writeFileSync(join(source, "real", "linked.md"), "linked");
    symlinkSync(join(source, "real"), join(source, "alias"));
    await assert.rejects(
      buildWorkflowPublicationPreview({
        sourceRoot: source,
        targetRoot: target,
        outputs: [{ relativePath: "alias/linked.md", extension: "md" }],
      }),
      (error) => error.code === "workflow_publication_symlink_forbidden",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resumes an explicitly confirmed interrupted publication from matching files and staging", async () => {
  const { root, source, target } = fixture();
  try {
    mkdirSync(join(source, "deliveries"), { recursive: true });
    mkdirSync(join(target, "deliveries"), { recursive: true });
    writeFileSync(join(source, "deliveries", "one.md"), "one");
    writeFileSync(join(source, "deliveries", "two.md"), "two");
    const outputs = [
      { relativePath: "deliveries/one.md", extension: "md" },
      { relativePath: "deliveries/two.md", extension: "md" },
    ];
    const preview = await buildWorkflowPublicationPreview({ sourceRoot: source, targetRoot: target, outputs });
    writeFileSync(join(target, "deliveries", "one.md"), "one");
    writeFileSync(
      join(target, "deliveries", ".two.md.myagenttool-preview-resume-1.tmp"),
      "two",
    );

    const result = await publishWorkflowOutputFiles({
      sourceRoot: source,
      targetRoot: target,
      preview,
      previewId: "preview-resume",
      resume: true,
    });
    assert.equal(result.files.length, 2);
    assert.equal(readFileSync(join(target, "deliveries", "one.md"), "utf8"), "one");
    assert.equal(readFileSync(join(target, "deliveries", "two.md"), "utf8"), "two");
    assert.equal(
      readdirSync(join(target, "deliveries")).some((name) => name.includes(".myagenttool-")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
