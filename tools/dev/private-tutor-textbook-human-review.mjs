#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPrivateTutorTextbookHumanReviewRecord,
  evaluatePrivateTutorTextbookHumanReviews,
  PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION,
} from "../../apps/server/src/services/private-tutor-textbook-human-review.mjs";
import { PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION } from "../../apps/server/src/services/private-tutor-textbook-page-schema.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = parseArgs(process.argv.slice(2));
const baselinePath = absolute(options.baseline ?? ".myagenttool/evaluations/private-tutor-textbook/pep-grade4-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const artifactRoot = absolute(options.artifactRoot
  ?? `.myagenttool/evaluations/private-tutor-textbook/${baseline.experimentId}`);
const reviewsPath = absolute(options.reviews
  ?? `.myagenttool/evaluations/private-tutor-textbook/${baseline.experimentId}.human-reviews.json`);
const reportPath = absolute(options.report
  ?? `.myagenttool/evaluations/private-tutor-textbook/${baseline.experimentId}.human-review-report.json`);
const targetRows = baseline.metrics?.humanReviewCost?.rows ?? [];
const recognizedPages = loadRecognizedPages(artifactRoot);
const tasks = targetRows.map((target) => {
  const page = recognizedPages.get(Number(target.pageNumber));
  if (!page) fail(`OCR checkpoint is missing review page ${target.pageNumber}.`);
  return {
    pageNumber: Number(target.pageNumber),
    printedPageNumber: page.printedPageNumber ?? null,
    confidence: target.confidence,
    reasons: target.reasons,
    text: page.text,
  };
});
const taskByPage = new Map(tasks.map((task) => [task.pageNumber, task]));

if (options.command === "report") {
  const summary = writeReport();
  printSummary(summary);
} else {
  const server = createServer((request, response) => void handleRequest(request, response));
  server.listen(options.port, "127.0.0.1", () => {
    process.stdout.write([
      `Private tutor human review bench: ${tasks.length} pages`,
      `Open http://127.0.0.1:${options.port}`,
      `Reviews: ${reviewsPath}`,
      `Report: ${reportPath}`,
    ].join("\n") + "\n");
  });
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (request.method === "GET" && url.pathname === "/") return sendHtml(response, REVIEW_HTML);
    if (request.method === "GET" && url.pathname === "/api/state") {
      const store = loadStore();
      const summary = evaluatePrivateTutorTextbookHumanReviews({ targets: targetRows, reviews: store.reviews });
      const reviewedPages = new Set(store.reviews.map((review) => Number(review.pageNumber)));
      const requestedPage = Number(url.searchParams.get("page"));
      const task = taskByPage.get(requestedPage) ?? tasks.find((candidate) => !reviewedPages.has(candidate.pageNumber)) ?? null;
      return sendJson(response, 200, {
        experimentId: baseline.experimentId,
        sourceTitle: baseline.source.title,
        task: task ? publicTask(task) : null,
        pendingTasks: tasks.filter((candidate) => !reviewedPages.has(candidate.pageNumber)).map(publicTaskMetadata),
        summary,
      });
    }
    const imageMatch = url.pathname.match(/^\/api\/pages\/(\d+)\/image$/);
    if (request.method === "GET" && imageMatch) {
      const pageNumber = Number(imageMatch[1]);
      if (!taskByPage.has(pageNumber)) return sendJson(response, 404, { error: "review_page_not_found" });
      const imagePath = join(artifactRoot, "pages", `page-${String(pageNumber).padStart(3, "0")}.png`);
      if (!existsSync(imagePath)) return sendJson(response, 404, { error: "review_page_not_found" });
      const bytes = readFileSync(imagePath);
      if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return sendJson(response, 404, { error: "review_page_not_found" });
      }
      response.writeHead(200, securityHeaders({
        "Content-Type": "image/png",
        "Content-Length": bytes.length,
        "Cache-Control": "private, no-store",
      }));
      response.end(bytes);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/reviews") {
      const input = await readJson(request);
      const task = taskByPage.get(Number(input.pageNumber));
      if (!task) return sendJson(response, 404, { error: "review_page_not_found" });
      const store = loadStore();
      if (store.reviews.some((review) => Number(review.pageNumber) === task.pageNumber)) {
        return sendJson(response, 409, { error: "review_page_already_completed" });
      }
      const record = createPrivateTutorTextbookHumanReviewRecord({ task, input });
      store.reviews.push(record);
      saveStore(store);
      const summary = writeReport(store);
      return sendJson(response, 201, { record: publicReview(record), summary });
    }
    return sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    return sendJson(response, 400, { error: String(error?.message ?? "invalid_human_review") });
  }
}

function loadRecognizedPages(directory) {
  const recognitionDirectory = join(directory, "recognition", PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION);
  if (!existsSync(recognitionDirectory)) fail(`OCR checkpoints not found: ${recognitionDirectory}`);
  const pages = readdirSync(recognitionDirectory).filter((name) => /^pages-\d{3}-\d{3}\.json$/.test(name)).sort()
    .flatMap((name) => JSON.parse(readFileSync(join(recognitionDirectory, name), "utf8")).pages ?? []);
  return new Map(pages.map((page) => [Number(page.index), page]));
}

function loadStore() {
  if (!existsSync(reviewsPath)) return {
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION,
    experimentId: baseline.experimentId,
    sourceHash: baseline.source.sha256,
    reviews: [],
  };
  const store = JSON.parse(readFileSync(reviewsPath, "utf8"));
  if (store.schemaVersion !== PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION
    || store.experimentId !== baseline.experimentId
    || store.sourceHash !== baseline.source.sha256
    || !Array.isArray(store.reviews)) fail("Human-review evidence does not match this textbook baseline.");
  return store;
}

function saveStore(store) {
  mkdirSync(dirname(reviewsPath), { recursive: true });
  atomicWrite(reviewsPath, `${JSON.stringify(store, null, 2)}\n`);
}

function writeReport(store = loadStore()) {
  const summary = evaluatePrivateTutorTextbookHumanReviews({ targets: targetRows, reviews: store.reviews });
  const report = {
    schemaVersion: PRIVATE_TUTOR_TEXTBOOK_HUMAN_REVIEW_SCHEMA_VERSION,
    experimentId: baseline.experimentId,
    source: {
      title: baseline.source.title,
      sha256: baseline.source.sha256,
      pageCount: baseline.source.pageCount,
    },
    generatedAt: new Date().toISOString(),
    summary,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return summary;
}

function atomicWrite(path, content) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, path);
}

function publicTask(task) {
  return { ...publicTaskMetadata(task), text: task.text, imageUrl: `/api/pages/${task.pageNumber}/image` };
}

function publicTaskMetadata(task) {
  return {
    pageNumber: task.pageNumber,
    printedPageNumber: task.printedPageNumber,
    confidence: task.confidence,
    reasons: task.reasons,
  };
}

function publicReview(record) {
  return {
    pageNumber: record.pageNumber,
    durationSeconds: record.durationSeconds,
    triggerDecision: record.triggerDecision,
    textEdited: record.textEdited,
    printedPageNumberEdited: record.printedPageNumberEdited,
  };
}

function parseArgs(args) {
  const result = { command: "serve", port: 4319 };
  let index = 0;
  if (["serve", "report"].includes(args[0])) result.command = args[index++];
  for (; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      result.port = Number(args[++index]);
      if (!Number.isInteger(result.port) || result.port < 1024 || result.port > 65535) fail("--port must be between 1024 and 65535.");
    } else if (["--baseline", "--artifact-root", "--reviews", "--report"].includes(arg)) {
      const key = { "--baseline": "baseline", "--artifact-root": "artifactRoot", "--reviews": "reviews", "--report": "report" }[arg];
      result[key] = args[++index];
      if (!result[key]) fail(`${arg} requires a path.`);
    } else fail(`Unknown argument: ${arg}`);
  }
  return result;
}

function readJson(request) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("review_payload_too_large"));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid_review_json")); }
    });
    request.on("error", reject);
  });
}

function sendHtml(response, html) {
  const bytes = Buffer.from(html, "utf8");
  response.writeHead(200, securityHeaders({ "Content-Type": "text/html; charset=utf-8", "Content-Length": bytes.length }));
  response.end(bytes);
}

function sendJson(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length }));
  response.end(bytes);
}

function securityHeaders(extra = {}) {
  return {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function printSummary(summary) {
  process.stdout.write([
    `Human review: ${summary.reviewedPageCount}/${summary.targetPageCount}; remaining ${summary.remainingPageCount}`,
    `Modification rate: ${summary.modificationRate}; false-trigger rate: ${summary.falseTriggerRate}`,
    `Observed time: ${summary.observedMinutes} min; median ${summary.medianSecondsPerPage ?? "n/a"}s/page; p90 ${summary.p90SecondsPerPage ?? "n/a"}s/page`,
    `Threshold decision: ${summary.thresholdRecommendation.decision}`,
    `Report: ${reportPath}`,
  ].join("\n") + "\n");
}

function absolute(path) {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const REVIEW_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>私教教材真人抽检台</title><style>
body{font-family:system-ui,sans-serif;margin:0;background:#f5f7fb;color:#172033}main{max-width:1180px;margin:auto;padding:24px}.card{background:white;border:1px solid #dce2ec;border-radius:14px;padding:18px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}img{max-width:100%;max-height:72vh;display:block;margin:auto}textarea{width:100%;min-height:360px;box-sizing:border-box;font:13px/1.55 ui-monospace,monospace}input[type=text],select{width:100%;box-sizing:border-box;padding:9px}.row{display:flex;gap:12px;flex-wrap:wrap}.muted{color:#627086;font-size:13px}.reason{display:inline-block;padding:3px 8px;background:#fff3cd;border-radius:999px;margin-right:6px;font-size:12px}button{padding:10px 16px;border:0;border-radius:9px;background:#087f5b;color:white;font-weight:650;cursor:pointer}button:disabled{opacity:.5}.error{color:#b42318}.done{color:#087f5b}@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style></head><body><main>
<div class="card"><h1>私教教材真人抽检台</h1><p id="source" class="muted"></p><div id="summary"></div></div>
<div id="work" class="card" hidden><div class="row" style="justify-content:space-between"><div><h2 id="pageTitle"></h2><div id="reasons"></div></div><label>切换待检页<select id="pageSelect"></select></label></div>
<p class="muted">计时从本页加载完成开始。请实际对照原页；不要仅凭 OCR 文本确认。</p>
<div class="grid"><figure><img id="image" alt="教材原页"></figure><div><label>印刷页码<input id="printed" type="text" maxlength="40"></label><p><label>OCR 文字<textarea id="text"></textarea></label></p></div></div>
<div class="card"><label>触发判断<select id="decision"><option value="valid_trigger">有效触发：确实需要人工确认</option><option value="false_trigger">误触发：无需人工确认</option><option value="mixed">混合：部分有效、部分误触发</option><option value="uncertain">仍无法判断</option></select></label>
<p class="muted">误触发或混合时至少选择一个原因：</p><div id="falseReasons" class="row"></div>
<p><label>备注（可选）<input id="note" type="text" maxlength="500"></label></p>
<p><label><input id="attest" type="checkbox"> 我确认这是本人对照原页后作出的判断</label></p>
<button id="submit">保存本页并进入下一页</button> <span id="message"></span></div></div>
<div id="complete" class="card" hidden><h2 class="done">17 页真人抽检已完成</h2><p id="decisionText"></p></div>
</main><script>
const reasonLabels={decorative_or_nonsemantic_block:'装饰、版权或非语义块',blank_or_back_matter:'空白页或封底附页',formula_not_requiring_structure:'公式无需 AST/竖式结构',layout_only_math:'仅版面符号被当成数学',confidence_too_conservative:'置信度标定过于保守',other:'其他'};
let task=null,startMono=0,startedAt='';
async function load(page){const q=page?'?page='+page:'';const state=await fetch('/api/state'+q).then(r=>r.json());renderSummary(state.summary);document.querySelector('#source').textContent=state.sourceTitle;task=state.task;if(!task){document.querySelector('#work').hidden=true;document.querySelector('#complete').hidden=false;document.querySelector('#decisionText').textContent=state.summary.thresholdRecommendation.rationale;return}document.querySelector('#work').hidden=false;document.querySelector('#complete').hidden=true;document.querySelector('#pageTitle').textContent='源文件第 '+task.pageNumber+' 页 · 印刷页 '+(task.printedPageNumber||'未识别')+' · 置信度 '+Math.round((task.confidence||0)*100)+'%';document.querySelector('#reasons').innerHTML=task.reasons.map(x=>'<span class="reason">'+x+'</span>').join('');const image=document.querySelector('#image');const loadedPage=task.pageNumber;startMono=0;startedAt='';document.querySelector('#submit').disabled=true;document.querySelector('#message').textContent='正在加载原页…';image.onload=()=>{if(task&&task.pageNumber===loadedPage){startedAt=new Date().toISOString();startMono=performance.now();document.querySelector('#submit').disabled=false;document.querySelector('#message').textContent='计时已开始';}};image.src=task.imageUrl+'?page='+task.pageNumber;document.querySelector('#printed').value=task.printedPageNumber||'';document.querySelector('#text').value=task.text;document.querySelector('#note').value='';document.querySelector('#decision').value='valid_trigger';document.querySelector('#attest').checked=false;document.querySelectorAll('#falseReasons input').forEach(x=>x.checked=false);const sel=document.querySelector('#pageSelect');sel.innerHTML=state.pendingTasks.map(x=>'<option value="'+x.pageNumber+'">第 '+x.pageNumber+' 页 · '+x.reasons.join('/')+'</option>').join('');sel.value=String(task.pageNumber);}
function renderSummary(s){document.querySelector('#summary').innerHTML='<b>进度 '+s.reviewedPageCount+'/'+s.targetPageCount+'</b> · 实际修改率 '+Math.round(s.modificationRate*100)+'% · 误触发率 '+Math.round(s.falseTriggerRate*100)+'% · 已计时 '+s.observedMinutes+' 分钟<br><span class="muted">门槛结论：'+s.thresholdRecommendation.rationale+'</span>'}
document.querySelector('#falseReasons').innerHTML=Object.entries(reasonLabels).map(([k,v])=>'<label><input type="checkbox" value="'+k+'"> '+v+'</label>').join('');
document.querySelector('#pageSelect').addEventListener('change',e=>load(e.target.value));
document.querySelector('#submit').addEventListener('click',async()=>{const button=document.querySelector('#submit');if(!startMono){document.querySelector('#message').textContent='原页尚未加载完成。';return}const decision=document.querySelector('#decision').value;const falseTriggerReasons=[...document.querySelectorAll('#falseReasons input:checked')].map(x=>x.value);if(!document.querySelector('#attest').checked){document.querySelector('#message').textContent='请先完成真人复核确认。';return}if((decision==='false_trigger'||decision==='mixed')&&!falseTriggerReasons.length){document.querySelector('#message').textContent='请至少选择一个误触发原因。';return}button.disabled=true;const response=await fetch('/api/reviews',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageNumber:task.pageNumber,sessionId:crypto.randomUUID(),startedAt,durationSeconds:Math.max(1,Math.round((performance.now()-startMono)/1000)),correctedText:document.querySelector('#text').value,correctedPrintedPageNumber:document.querySelector('#printed').value,triggerDecision:decision,falseTriggerReasons,note:document.querySelector('#note').value,reviewerAttestation:true})});const body=await response.json();button.disabled=false;if(!response.ok){document.querySelector('#message').textContent=body.error||'保存失败';return}await load();});
load().catch(e=>{document.querySelector('#summary').innerHTML='<span class="error">'+e.message+'</span>'});
</script></body></html>`;
