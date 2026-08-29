#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPrivateTutorOcrResult,
  parseMaterialDocument,
  parsePdfTextSections,
  parseUploadedMaterialDocument,
} from "../../apps/server/src/services/private-tutor-material-parser.mjs";
import {
  detectPrivateTutorMaterialSubject,
  generateKnowledgeMapDraft,
} from "../../apps/server/src/services/private-tutor-graph-extractor.mjs";
import { evaluatePrivateTutorTextbookExperiment } from "../../apps/server/src/services/private-tutor-textbook-experiment.mjs";
import {
  createCodexVisionOcrAdapter,
  resolveCodexVisionOcrConfig,
} from "../../apps/server/src/services/workflow-codex-vision-ocr-adapter.mjs";
import { PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION } from "../../apps/server/src/services/private-tutor-textbook-page-schema.mjs";

const unavailableOcr = {
  readiness: () => ({ state: "unavailable", providerId: null, reason: "experiment_ocr_disabled" }),
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(2));
const manifestPath = absolute(options.manifest ?? "tools/dev/fixtures/private-tutor-textbook-experiment-v1.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sourcePath = absolute(manifest.source.relativePath);
const artifactRoot = absolute(options.artifactRoot
  ?? `.myagenttool/evaluations/private-tutor-textbook/${manifest.id}`);
const reportPath = absolute(options.report
  ?? `.myagenttool/evaluations/private-tutor-textbook/${manifest.id}.report.json`);

verifySource(sourcePath, manifest.source);

let recognized;
if (options.runOcr) {
  if (!options.allowCloud) {
    fail("Running Codex OCR requires --allow-cloud because textbook page images are sent for recognition.");
  }
  const config = resolveCodexVisionOcrConfig();
  if (!config.enabled) fail(`Codex OCR is unavailable: ${config.reason}`);
  const adapter = createCodexVisionOcrAdapter({ config });
  process.stderr.write(`OCR ${manifest.source.pageCount} pages with resumable 8-page shards...\n`);
  recognized = await adapter.recognize({
    path: sourcePath,
    cloudAllowed: true,
    artifactRoot,
    onProgress(progress) {
      const resumed = progress.resumed ? " (cached)" : "";
      process.stderr.write(`OCR ${progress.completedPages}/${progress.totalPages}${resumed}\n`);
    },
  });
  writeRecognitionMetadata(artifactRoot, recognized);
} else {
  recognized = loadCachedRecognition(artifactRoot, manifest.source.pageCount);
  if (!recognized) {
    fail("No complete OCR checkpoint was found. Re-run with --run-ocr --allow-cloud to create it.");
  }
}

const material = materialFromRecognition(manifest, recognized);
const analysisMaterial = materialForOfflineAnalysis(material);
const draft = analysisMaterial.sections.length > 0
  ? generateKnowledgeMapDraft({
      materialDocument: analysisMaterial,
      packageName: manifest.source.title,
      subjectId: "auto",
      domain: "primary_mathematics",
      now: new Date().toISOString(),
    })
  : null;
const subjectPredictions = await buildSubjectPredictions(manifest, analysisMaterial);
const report = evaluatePrivateTutorTextbookExperiment({ manifest, material, draft, subjectPredictions });

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
printSummary(report, reportPath);
if (options.strict && !report.passed) process.exitCode = 1;

function materialFromRecognition(experiment, ocr) {
  const pageCount = experiment.source.pageCount;
  const initial = {
    id: `experiment_${experiment.id}`,
    learningProfileId: "private_tutor_textbook_experiment",
    fileName: basename(experiment.source.relativePath),
    fileType: "pdf",
    fileSize: readFileSync(sourcePath).length,
    sourceHash: experiment.source.sha256,
    status: "needs_ocr",
    pages: Array.from({ length: pageCount }, (_, offset) => ({
      pageNumber: offset + 1,
      text: "",
      characterCount: 0,
      source: "pdf_text",
      confidence: null,
    })),
    sections: [],
    extraction: {
      parserVersion: 2,
      pageCount,
      warnings: [],
      ocr: { required: true, attempted: false, state: "unavailable", providerId: null, reason: null },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return applyPrivateTutorOcrResult(initial, ocr);
}

function materialForOfflineAnalysis(material) {
  const sections = parsePdfTextSections(material.pages.map(
    (page) => `--- Page ${page.pageNumber} ---\n${page.text}`,
  ).join("\n"));
  return { ...material, status: "parsed", sections };
}

async function buildSubjectPredictions(experiment, recognizedMaterial) {
  const predictions = [];
  for (const control of experiment.subjectControls ?? []) {
    let document;
    if (control.sourceKind === "recognized_textbook") {
      document = recognizedMaterial;
    } else {
      const path = absolute(control.relativePath);
      const bytes = readFileSync(path);
      if (control.sourceKind === "markdown") {
        document = parseMaterialDocument({
          learningProfileId: "private_tutor_textbook_experiment",
          fileName: basename(path),
          fileType: "markdown",
          fileContent: bytes.toString("utf8"),
          fileSize: bytes.length,
        });
      } else if (control.sourceKind === "pdf_text") {
        document = await parseUploadedMaterialDocument({
          learningProfileId: "private_tutor_textbook_experiment",
          fileName: basename(path),
          fileType: "pdf",
          fileContent: bytes.toString("base64"),
          fileEncoding: "base64",
          fileSize: bytes.length,
        }, { ocrAdapter: unavailableOcr });
      } else {
        throw new Error(`unsupported_subject_control:${control.sourceKind}`);
      }
    }
    const detection = detectPrivateTutorMaterialSubject(document, "auto");
    predictions.push({
      id: control.id,
      sourceKind: control.sourceKind,
      expectedSubjectId: control.expectedSubjectId,
      actualSubjectId: detection.resolvedSubjectId,
      evaluationSubjectId: detection.evaluationSubjectId,
      confidence: detection.confidence,
      signals: detection.signals,
    });
  }
  return predictions;
}

function loadCachedRecognition(directory, expectedPageCount) {
  const recognitionDirectory = join(directory, "recognition", PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION);
  if (!existsSync(recognitionDirectory)) return null;
  const files = readdirSync(recognitionDirectory).filter((name) => /^pages-\d{3}-\d{3}\.json$/.test(name)).sort();
  const pages = files.flatMap((name) => JSON.parse(readFileSync(join(recognitionDirectory, name), "utf8")).pages ?? []);
  const unique = new Map(pages.map((page) => [Number(page.index), page]));
  if (unique.size !== expectedPageCount) return null;
  const ordered = Array.from({ length: expectedPageCount }, (_, offset) => unique.get(offset + 1));
  if (ordered.some((page) => !page)) return null;
  const metadataPath = join(directory, "recognition-metadata.json");
  const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, "utf8")) : {};
  return {
    providerId: metadata.providerId ?? "codex-vision",
    providerVersion: metadata.providerVersion ?? "checkpoint-provider-unknown",
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
    inputKind: "pdf",
    pageCount: ordered.length,
    pages: ordered,
    localOnly: false,
  };
}

function writeRecognitionMetadata(directory, recognition) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "recognition-metadata.json"), `${JSON.stringify({
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
    providerId: recognition.providerId,
    providerVersion: recognition.providerVersion,
    pageCount: recognition.pageCount,
  }, null, 2)}\n`, "utf8");
}

function verifySource(path, source) {
  if (!existsSync(path)) fail(`Textbook source not found: ${source.relativePath}`);
  const bytes = readFileSync(path);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== String(source.sha256).toLowerCase()) {
    fail(`Textbook SHA-256 mismatch: expected ${source.sha256}, got ${actualHash}`);
  }
}

function parseArgs(args) {
  const result = { runOcr: false, allowCloud: false, strict: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run-ocr") result.runOcr = true;
    else if (arg === "--allow-cloud") result.allowCloud = true;
    else if (arg === "--strict") result.strict = true;
    else if (["--manifest", "--artifact-root", "--report"].includes(arg)) {
      const key = { "--manifest": "manifest", "--artifact-root": "artifactRoot", "--report": "report" }[arg];
      result[key] = args[++index];
      if (!result[key]) fail(`${arg} requires a path.`);
    } else fail(`Unknown argument: ${arg}`);
  }
  return result;
}

function absolute(path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

function printSummary(report, path) {
  const units = report.metrics.unitRecall;
  const subject = report.metrics.mathSubjectRouting;
  const review = report.metrics.humanReviewCost;
  process.stdout.write([
    `Private tutor textbook experiment: ${report.experimentId}`,
    `Pages: ${report.source.pageCount}/${report.source.expectedPageCount}`,
    `Unit recall: pipeline ${units.pipelineMatchedCount}/${units.expectedCount} (${units.pipelineRecallRate}); OCR titles ${units.ocrMatchedCount}/${units.expectedCount} (${units.ocrTitleRecallRate})`,
    `Math misclassification: ${subject.errorCount}/${subject.caseCount} (${subject.misclassificationRate}); FP ${subject.falsePositiveCount}; FN ${subject.falseNegativeCount}`,
    `Human review: ${review.requiredPageCount}/${review.totalPageCount} pages (${review.pageRate}); estimated ${review.estimatedMinutes} min at ${review.secondsPerPageAssumption}s/page`,
    `Experiment gates: ${report.passed ? "PASS" : "NEEDS_FOLLOW_UP"}`,
    `Report: ${path}`,
  ].join("\n") + "\n");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
