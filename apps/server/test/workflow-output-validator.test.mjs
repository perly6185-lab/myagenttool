import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  validateWorkflowOutputFile,
  WORKFLOW_OUTPUT_VALIDATOR_VERSION,
} from "../src/services/workflow-output-validator.mjs";

function fixture() {
  const root = join(tmpdir(), `workflow-output-validator-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

async function validate(root, name, content) {
  const path = join(root, name);
  writeFileSync(path, content);
  return validateWorkflowOutputFile({
    path,
    relativePath: name,
    extension: name.split(".").at(-1),
    projectRoot: root,
  });
}

function resultFor(validation, rule) {
  return validation.results.find((result) => result.rule === rule);
}

test("validates JSON, YAML, and CSV syntax while exposing structured fields", async () => {
  const root = fixture();
  try {
    const [json, yaml, csv, invalidJson, invalidYaml] = await Promise.all([
      validate(root, "delivery.json", JSON.stringify({ title: "方案", owner: "林月" })),
      validate(root, "delivery.yaml", "title: 方案\nowner: 林月\n"),
      validate(root, "delivery.csv", "title,owner\n方案,林月\n"),
      validate(root, "invalid.json", "{\"title\":"),
      validate(root, "invalid.yaml", "title: ["),
    ]);

    assert.equal(resultFor(json, "json_syntax").status, "passed");
    assert.deepEqual(json.fields.sort(), ["owner", "title"]);
    assert.equal(resultFor(yaml, "yaml_syntax").status, "passed");
    assert.deepEqual(yaml.fields.sort(), ["owner", "title"]);
    assert.equal(resultFor(csv, "csv_header").status, "passed");
    assert.deepEqual(csv.fields.sort(), ["owner", "title"]);
    assert.equal(resultFor(invalidJson, "json_syntax").status, "failed");
    assert.equal(resultFor(invalidYaml, "yaml_syntax").status, "failed");
    assert.ok(json.results.every((result) =>
      result.validatorVersion === WORKFLOW_OUTPUT_VALIDATOR_VERSION));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checks Markdown attachments inside the project and rejects missing or unsafe paths", async () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "chart.png"), Buffer.from([137, 80, 78, 71]));
    const markdown = await validate(
      root,
      "delivery.md",
      [
        "# 交付",
        "![图表](assets/chart.png)",
        "![缺失](assets/missing.png)",
        "[越界](../secret.txt)",
        "[错误编码](%E0%A4%A)",
        "[外链](https://example.com/reference)",
      ].join("\n"),
    );
    const attachmentResults = markdown.results.filter((result) => result.rule === "local_attachment");

    assert.equal(attachmentResults.length, 4);
    assert.equal(attachmentResults[0].status, "passed");
    assert.ok(attachmentResults.slice(1).every((result) => result.status === "failed"));
    assert.ok(attachmentResults.every((result) => result.evidence.kind === "markdown_link"));
    assert.equal(new Set(attachmentResults.map((result) => result.id)).size, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("blocks empty files and content whose signature does not match its extension", async () => {
  const root = fixture();
  try {
    const empty = await validate(root, "empty.txt", "");
    const fakePdf = await validate(root, "fake.pdf", "This is not a PDF.");

    assert.equal(resultFor(empty, "file_nonempty").status, "failed");
    assert.equal(resultFor(fakePdf, "file_signature").status, "failed");
    assert.equal(resultFor(fakePdf, "document_parse").status, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
