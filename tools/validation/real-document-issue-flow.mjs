import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  extractionText,
  parseWorkflowDocument,
} from "../../apps/server/src/services/workflow-document-parser.mjs";
import {
  ARTICLE_IMPORT_LIMITS,
  createArticleImportService,
} from "../../apps/server/src/services/article-imports.mjs";
import { createWorkItemService } from "../../apps/server/src/services/work-items.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const validationRoot = join(repositoryRoot, ".myagenttool", "validation", "real-document-issues");
const sourceRoot = join(validationRoot, "sources");
const refreshSources = process.argv.includes("--refresh");
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const runRoot = join(validationRoot, "runs", runId);
const projectRoot = join(runRoot, "project");
const worktreeRoot = join(runRoot, "worktrees");
const reportPath = join(runRoot, "report.json");
const reportMarkdownPath = join(runRoot, "report.md");
const uiStatePath = join(runRoot, "ui-state.json");

const TEAM_ID = "team_real_validation";
const USER_ID = "usr_real_validation";
const TERMINAL_ID = "dev_real_validation";
const PROJECT_ID = "prj_real_validation";
const actor = { userId: USER_ID, teamId: TEAM_ID, role: "owner" };
const today = new Date().toISOString().slice(0, 10);
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

const pdfSources = [
  {
    key: "nist-ai-rmf",
    name: "nist-ai-rmf.pdf",
    title: "核验 NIST AI 风险管理框架 PDF",
    url: "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf",
    minimumPages: 40,
    expectedTerms: ["Artificial Intelligence Risk Management Framework", "GOVERN", "MEASURE", "MANAGE"],
  },
  {
    key: "attention-is-all-you-need",
    name: "attention-is-all-you-need.pdf",
    title: "核验 Attention Is All You Need 论文 PDF",
    url: "https://arxiv.org/pdf/1706.03762",
    minimumPages: 10,
    expectedTerms: ["Attention Is All You Need", "Transformer", "BLEU"],
  },
  {
    key: "ecnu-generative-ai-education",
    name: "ecnu-ai-research.pdf",
    title: "核验生成式人工智能教学研究 PDF",
    url: "https://xbjk.ecnu.edu.cn/CN/article/downloadArticleFile.do?attachType=PDF&id=10970",
    minimumPages: 8,
    expectedTerms: ["ChatGPT", "生成式人工智能", "教学模式"],
  },
];

const articleSources = [
  {
    key: "wechat-long-running-agent",
    url: "https://mp.weixin.qq.com/s/cexkyzQBRDG3uIF6g5cEbQ",
    expectedTerms: ["GLM 5.1", "长时任务"],
  },
  {
    key: "wechat-devops-practice",
    url: "https://mp.weixin.qq.com/s/lqwGUCKZM0AvEw_xh-7BDA",
    expectedTerms: ["自动化测试", "持续部署", "DevOps"],
  },
  {
    key: "wechat-image-model-review",
    url: "https://mp.weixin.qq.com/s/BUfvTjVHMwCBlqF6PILc3w",
    expectedTerms: ["AI 模特", "机器之心"],
  },
];

let idCounter = 0;
const state = {
  device: { id: TERMINAL_ID },
  devices: [{ id: TERMINAL_ID }],
  users: [{ id: USER_ID, teamId: TEAM_ID }],
  projects: [{ id: PROJECT_ID, name: "Real document validation", path: projectRoot, ownerTeamId: TEAM_ID }],
  worktrees: [],
  workItems: [],
  workItemComments: [],
  workItemActivities: [],
  articleImportJobs: [],
  autoRuns: [],
  invocations: [],
};
const workItemService = createWorkItemService({
  state,
  now: () => new Date().toISOString(),
  nextId: (prefix) => `${prefix}_real_${++idCounter}`,
  appendEvent: () => {},
  persistStateSoon: () => {},
});
const articleImportService = createArticleImportService({
  state,
  now: () => new Date().toISOString(),
  nextId: (prefix) => `${prefix}_real_${++idCounter}`,
  workItemService,
  maxConcurrent: 1,
  maxPending: 10,
  limits: {
    ...ARTICLE_IMPORT_LIMITS,
    mediaBytes: 8 * 1024 * 1024,
    totalMediaBytes: 32 * 1024 * 1024,
    mediaCount: 12,
    mediaConcurrency: 3,
    timeoutMs: 45_000,
  },
});

function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function mapValidationStateForLocalUi(value) {
  if (Array.isArray(value)) return value.map(mapValidationStateForLocalUi);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapValidationStateForLocalUi(item)]));
  }
  if (value === TEAM_ID) return "team_local";
  if (value === USER_ID) return "usr_local";
  if (value === TERMINAL_ID) return "dev_local_001";
  if (value === PROJECT_ID) return "prj_myagenttool";
  return value;
}

async function writeUiStateSnapshot() {
  const mapped = mapValidationStateForLocalUi({
    worktrees: state.worktrees,
    autoRuns: state.autoRuns,
    invocations: state.invocations,
    workItems: state.workItems,
    workItemComments: state.workItemComments,
    workItemActivities: state.workItemActivities,
    articleImportJobs: state.articleImportJobs,
  });
  await writeFile(uiStatePath, `${JSON.stringify({
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    currentProjectId: "prj_myagenttool",
    idCounter,
    ...mapped,
  }, null, 2)}\n`, "utf8");
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function initializeProject() {
  await mkdir(projectRoot, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });
  await git(projectRoot, "init", "-b", "main");
  await git(projectRoot, "config", "user.email", "validation@myagenttool.local");
  await git(projectRoot, "config", "user.name", "MyAgentTool Validation");
  await writeFile(join(projectRoot, "README.md"), "# Real document Issue validation\n", "utf8");
  await git(projectRoot, "add", "README.md");
  await git(projectRoot, "commit", "-m", "Initialize real document validation project");
}

async function ensurePdfSource(source) {
  await mkdir(sourceRoot, { recursive: true });
  const path = join(sourceRoot, source.name);
  let bytes = null;
  if (!refreshSources) {
    try {
      bytes = await readFile(path);
    } catch {
      bytes = null;
    }
  }
  if (!bytes?.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    const response = await fetch(source.url, {
      redirect: "follow",
      headers: { "user-agent": userAgent, accept: "application/pdf" },
      signal: AbortSignal.timeout(90_000),
    });
    assert.equal(response.ok, true, `${source.key}: PDF download returned ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-", `${source.key}: response is not a PDF`);
    await writeFile(path, bytes);
  }
  return { path, size: bytes.length, hash: sha256(bytes) };
}

function createIssue(input) {
  const created = workItemService.createWorkItem({
    projectId: PROJECT_ID,
    type: "task",
    priority: "p1",
    status: "ready",
    executionPolicy: "auto",
    waitingOn: "ai",
    plannedDate: today,
    requesterRelation: "self",
    intakeChannel: "manual",
    ...input,
  }, actor);
  assert.equal(created.ok, true, JSON.stringify(created.body));
  return created.body.workItem;
}

async function createIssueWorktree(item) {
  const slug = item.localRef.toLowerCase();
  const path = join(worktreeRoot, slug);
  const branch = `validation/${slug}`;
  await git(projectRoot, "worktree", "add", "-b", branch, path);
  const worktree = {
    id: `wtr_${slug}`,
    sourceProjectId: PROJECT_ID,
    projectId: PROJECT_ID,
    path,
    worktreePath: path,
    branch,
    link: { type: "local_issue", number: item.localNumber },
  };
  state.worktrees.push(worktree);
  return worktree;
}

async function commitWorktree(worktree, message) {
  await git(worktree.path, "add", ".");
  await git(worktree.path, "commit", "-m", message);
  return git(worktree.path, "rev-parse", "HEAD");
}

function latestItem(workItemId) {
  const result = workItemService.getWorkItem({ workItemId }, actor);
  assert.equal(result.ok, true, JSON.stringify(result.body));
  return result.body.workItem;
}

function verifyAndClose(item, criteria, evidence, summary) {
  const verified = workItemService.recordVerification({
    workItemId: item.id,
    expectedRevision: item.revision,
    kind: "manual",
    status: "passed",
    summary,
    acceptanceResults: criteria.map((criterion) => ({ criterion, status: "passed", note: "Verified against the real downloaded source." })),
    evidence,
  }, actor);
  assert.equal(verified.ok, true, JSON.stringify(verified.body));
  const completed = workItemService.updateWorkItem({
    workItemId: item.id,
    expectedRevision: verified.body.workItem.revision,
    status: "done",
    waitingOn: "none",
  }, actor);
  assert.equal(completed.ok, true, JSON.stringify(completed.body));
  const closed = workItemService.transitionWorkItem({
    workItemId: item.id,
    expectedRevision: completed.body.workItem.revision,
    action: "close",
  }, actor);
  assert.equal(closed.ok, true, JSON.stringify(closed.body));
  assert.equal(closed.body.workItem.state, "closed");
  return closed.body.workItem;
}

async function runPdfIssue(source) {
  const downloaded = await ensurePdfSource(source);
  const criteria = [
    "PDF 可解析且无需 OCR",
    `页数不少于 ${source.minimumPages} 页`,
    `正文包含关键主题：${source.expectedTerms.join(" / ")}`,
    "摘要产物已生成并绑定任务",
  ];
  let item = createIssue({
    title: source.title,
    body: `Source PDF: ${source.url}`,
    acceptanceCriteria: criteria,
    verificationSop: ["校验 PDF 文件签名和哈希", "使用服务端真实 PDF 解析器抽取全文", "核对页数与关键主题", "绑定摘要产物并记录验证证据"],
  });
  const worktree = await createIssueWorktree(item);
  const inputDirectory = join(worktree.path, "inputs");
  const outputDirectory = join(worktree.path, "outputs");
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const inputPath = join(inputDirectory, source.name);
  await copyFile(downloaded.path, inputPath);
  const inputInfo = await stat(inputPath);
  item = workItemService.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    inputAssets: [{
      id: `asset_input_${source.key}`,
      originalName: source.name,
      path: `inputs/${source.name}`,
      family: "pdf",
      mimeType: "application/pdf",
      terminalId: TERMINAL_ID,
      size: inputInfo.size,
      resourceClass: "medium",
      worktreeId: worktree.id,
      capabilities: [],
      readiness: { state: "ready", reason: "downloaded_public_source" },
    }],
  }, actor).body.workItem;
  const bound = workItemService.recordExecutionBinding({
    workItemId: item.id,
    kind: "auto_run",
    targetId: `run_${source.key}`,
    worktreeId: worktree.id,
  }, actor);
  assert.equal(bound.ok, true, JSON.stringify(bound.body));
  item = bound.body.workItem;

  const extraction = await parseWorkflowDocument({
    path: inputPath,
    extension: ".pdf",
    readMode: "supported_text",
    size: inputInfo.size,
  });
  assert.equal(extraction.state, "ready", `${source.key}: ${JSON.stringify(extraction)}`);
  assert.equal(extraction.needsOcr, false, `${source.key}: unexpectedly requires OCR`);
  assert.ok(extraction.pageCount >= source.minimumPages, `${source.key}: only ${extraction.pageCount} pages`);
  const text = extractionText(extraction);
  for (const term of source.expectedTerms) assert.match(text, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const outputRelative = `outputs/${source.key}-validation.md`;
  const outputPath = join(worktree.path, outputRelative);
  const output = [
    `# ${source.title}`,
    "",
    `- Source: ${source.url}`,
    `- SHA-256: ${downloaded.hash}`,
    `- Pages: ${extraction.pageCount}`,
    `- Extracted characters: ${extraction.characterCount}`,
    `- OCR required: ${extraction.needsOcr ? "yes" : "no"}`,
    `- Verified terms: ${source.expectedTerms.join(", ")}`,
    "",
    "## Extracted sample",
    "",
    text.slice(0, 4_000),
    "",
  ].join("\n");
  await writeFile(outputPath, output, "utf8");
  const outputBuffer = await readFile(outputPath);
  const outputAsset = {
    id: `asset_output_${source.key}`,
    originalName: `${source.key}-validation.md`,
    path: outputRelative,
    family: "markdown",
    mimeType: "text/markdown",
    terminalId: TERMINAL_ID,
    size: outputBuffer.length,
    resourceClass: "small",
    hash: sha256(outputBuffer),
    version: downloaded.hash,
    worktreeId: worktree.id,
    capabilities: [],
    readiness: { state: "ready", reason: "generated_by_validation_run" },
  };
  const reviewed = workItemService.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    status: "review",
    waitingOn: "me",
    outputAssets: [outputAsset],
  }, actor);
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed.body));
  const commit = await commitWorktree(worktree, `${item.localRef}: validate real PDF`);
  const completedAt = new Date().toISOString();
  const invocationId = `inv_${source.key}`;
  state.invocations.push({
    id: invocationId,
    projectId: PROJECT_ID,
    worktreeId: worktree.id,
    requestedBy: USER_ID,
    agentId: "agt_platform_document_parser",
    status: "succeeded",
    result: { output: { latestMessage: `Parsed ${extraction.pageCount} PDF pages and generated ${outputRelative}.` } },
    createdAt: item.createdAt,
    updatedAt: completedAt,
    completedAt,
  });
  state.autoRuns.push({
    id: `run_${source.key}`,
    invocationId,
    projectId: PROJECT_ID,
    worktreeId: worktree.id,
    teamId: TEAM_ID,
    requestedBy: USER_ID,
    status: "done",
    phase: "complete",
    link: { type: "local_issue", number: item.localNumber, title: item.title },
    localDelivery: { worktreeId: worktree.id, branchName: worktree.branch, mode: "local_merge", deliveredCommit: commit, deliveredAt: completedAt },
    createdAt: item.createdAt,
    updatedAt: completedAt,
  });
  const closed = verifyAndClose(reviewed.body.workItem, criteria, [
    { kind: "asset", ref: outputAsset.path, assetId: outputAsset.id, terminalId: TERMINAL_ID, hash: outputAsset.hash, summary: "Parsed PDF validation report" },
    { kind: "commit", ref: commit, summary: "Validation artifact commit" },
    { kind: "url", ref: source.url, summary: "Public source PDF" },
  ], `Parsed ${extraction.pageCount} real PDF pages and verified ${source.expectedTerms.length} source-specific terms.`);
  return {
    kind: "pdf",
    source: source.url,
    title: closed.title,
    workItemId: closed.id,
    localRef: closed.localRef,
    state: closed.state,
    executionPolicy: closed.executionPolicy,
    waitingOn: closed.waitingOn,
    pages: extraction.pageCount,
    extractedCharacters: extraction.characterCount,
    needsOcr: extraction.needsOcr,
    sourceBytes: downloaded.size,
    sourceHash: downloaded.hash,
    outputAsset: outputAsset.path,
    commit,
    verification: "passed",
  };
}

async function waitForArticleJob(workItemId, jobId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = articleImportService.get({ workItemId, jobId }, actor);
    assert.equal(result.ok, true, JSON.stringify(result.body));
    if (!["queued", "running"].includes(result.body.job.state)) return result.body.job;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`${jobId}: article import timed out`);
}

function retryableArticleFailure(code) {
  return ["article_download_challenge", "article_content_incomplete", "article_download_timeout"].includes(String(code));
}

async function inspectArticleWithRetry(source) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastResult = await articleImportService.inspect({ projectId: PROJECT_ID, url: source.url }, actor);
    if (lastResult.ok) return { result: lastResult, attempts: attempt };
    if (!retryableArticleFailure(lastResult.body?.error) || attempt === 3) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 5_000));
  }
  assert.equal(lastResult?.ok, true, JSON.stringify(lastResult?.body));
  return { result: lastResult, attempts: 3 };
}

async function runArticleIssue(source) {
  const inspectionResult = await inspectArticleWithRetry(source);
  const inspected = inspectionResult.result;
  const inspection = inspected.body.inspection;
  assert.equal(inspection.provider, "wechat");
  assert.ok(inspection.textLength >= 500, `${source.key}: extracted only ${inspection.textLength} characters`);
  for (const term of source.expectedTerms) assert.match(inspection.markdownPreview + inspection.title, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const criteria = [
    "公众号正文已保存为 Markdown 和 HTML",
    "真实正文提取长度不少于 500 字",
    `正文包含关键主题：${source.expectedTerms.join(" / ")}`,
    "文章结构分析已生成并绑定任务",
  ];
  let item = createIssue({
    title: `下载并分析公众号文章：${inspection.title}`,
    body: `Source article: ${source.url}`,
    acceptanceCriteria: criteria,
    verificationSop: ["下载真实公众号正文和受限数量的媒体", "保存 Markdown、HTML 和 manifest", "生成结构化文章分析", "核对来源、关键主题和输出资产"],
  });
  const worktree = await createIssueWorktree(item);
  let job = null;
  let importAttempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    importAttempts = attempt;
    const started = articleImportService.start({ workItemId: item.id, worktreeId: worktree.id, url: source.url }, actor);
    assert.equal(started.ok, true, JSON.stringify(started.body));
    job = await waitForArticleJob(item.id, started.body.job.id);
    if (job.state === "completed") break;
    if (!retryableArticleFailure(job.error) || attempt === 3) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 5_000));
  }
  assert.equal(job.state, "completed", `${source.key}: ${job.error ?? "article import failed"}`);
  const analyzed = await articleImportService.analyze({ workItemId: item.id, jobId: job.id }, actor);
  assert.equal(analyzed.ok, true, JSON.stringify(analyzed.body));
  const markdown = await readFile(join(worktree.path, job.result.markdownPath), "utf8");
  const html = await readFile(join(worktree.path, job.result.htmlPath), "utf8");
  const analysisMarkdown = await readFile(join(worktree.path, analyzed.body.analysisPath), "utf8");
  assert.ok(markdown.length >= 500);
  assert.ok(html.length >= 500);
  assert.match(analysisMarkdown, /# 核心思想/);
  for (const term of source.expectedTerms) assert.match(markdown, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const commit = await commitWorktree(worktree, `${item.localRef}: import and analyze real WeChat article`);
  item = latestItem(item.id);
  const analysisAsset = item.outputAssets.find((asset) => asset.path === analyzed.body.analysisPath);
  assert.ok(analysisAsset, `${source.key}: analysis asset is not bound to the Issue`);
  const closed = verifyAndClose(item, criteria, [
    { kind: "asset", ref: analysisAsset.path, assetId: analysisAsset.id, terminalId: TERMINAL_ID, summary: "Article structure analysis" },
    { kind: "commit", ref: commit, summary: "Imported article and analysis commit" },
    { kind: "url", ref: source.url, summary: "Public WeChat source article" },
  ], `Imported ${inspection.textLength} characters and ${inspection.mediaCounts.images} image references from a real WeChat article.`);
  return {
    kind: "wechat_article",
    source: source.url,
    title: inspection.title,
    author: inspection.author,
    publishedAt: inspection.publishedAt,
    workItemId: closed.id,
    localRef: closed.localRef,
    state: closed.state,
    executionPolicy: closed.executionPolicy,
    waitingOn: closed.waitingOn,
    extractedCharacters: inspection.textLength,
    imageReferences: inspection.mediaCounts.images,
    downloadedMedia: job.result.mediaCounts?.images ?? 0,
    warnings: job.result.warnings?.length ?? 0,
    inspectionAttempts: inspectionResult.attempts,
    importAttempts,
    outputAssets: closed.outputAssets.map((asset) => asset.path),
    commit,
    verification: "passed",
  };
}

function renderReport(report) {
  const lines = [
    "# Real PDF and WeChat Issue flow validation",
    "",
    `- Run: ${report.runId}`,
    `- Result: ${report.passed}/${report.total} passed`,
    `- Project: ${report.projectRoot}`,
    "",
    "| Issue | Kind | Source | Final state | Verification |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const item of report.cases) {
    const source = String(item.title ?? item.source).replaceAll("|", "\\|").replaceAll("\n", " ");
    const verification = String(item.verification ?? item.error).replaceAll("|", "\\|").replaceAll("\n", " ");
    lines.push(`| ${item.localRef ?? "failed"} | ${item.kind} | ${source} | ${item.state ?? "failed"} | ${verification} |`);
  }
  lines.push("", "## Notes", "", "Third-party full text and media remain under the ignored local validation directory and are not committed to the repository.", "");
  return lines.join("\n");
}

async function main() {
  await mkdir(runRoot, { recursive: true });
  await initializeProject();
  const cases = [];
  for (const source of pdfSources) {
    const startedAt = Date.now();
    try {
      cases.push({ ...(await runPdfIssue(source)), durationMs: Date.now() - startedAt });
    } catch (error) {
      cases.push({ kind: "pdf", source: source.url, title: source.title, verification: "failed", error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt });
    }
  }
  for (const source of articleSources) {
    const startedAt = Date.now();
    try {
      cases.push({ ...(await runArticleIssue(source)), durationMs: Date.now() - startedAt });
    } catch (error) {
      cases.push({ kind: "wechat_article", source: source.url, verification: "failed", error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt });
    }
  }
  const passed = cases.filter((item) => item.verification === "passed" && item.state === "closed").length;
  const report = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    projectRoot,
    runRoot,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    cases,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportMarkdownPath, renderReport(report), "utf8");
  await writeUiStateSnapshot();
  await writeFile(join(validationRoot, "latest.json"), `${JSON.stringify({ runId, reportPath, reportMarkdownPath, uiStatePath, passed, total: cases.length }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ passed, total: cases.length, reportPath, reportMarkdownPath, uiStatePath }, null, 2)}\n`);
  if (passed !== cases.length) process.exitCode = 1;
}

await main();
