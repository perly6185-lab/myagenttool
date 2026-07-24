import { performance } from "node:perf_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createWorkItemService } from "../../apps/server/src/services/work-items.mjs";

const queueCount = positiveInt(process.env.WORK_ITEMS_BENCH_QUEUE, 10_000);
const deliveryCount = positiveInt(process.env.WORK_ITEMS_BENCH_DELIVERIES, 1_000);
const batchCount = Math.min(100, positiveInt(process.env.WORK_ITEMS_BENCH_BATCH, 100));
const actor = { userId: "usr_bench", teamId: "team_bench" };
const timestamp = "2026-07-24T00:00:00.000Z";
const regressionFactor = positiveNumber(process.env.WORK_ITEMS_BENCH_REGRESSION_FACTOR, 1.5);
const maximums = {
  queue: positiveNumber(process.env.WORK_ITEMS_BENCH_QUEUE_BASELINE_MS, 19.8) * regressionFactor,
  deliveries: positiveNumber(process.env.WORK_ITEMS_BENCH_DELIVERY_BASELINE_MS, 7.8) * regressionFactor,
  batch: positiveNumber(process.env.WORK_ITEMS_BENCH_BATCH_BASELINE_MS, 13.2) * regressionFactor,
};

const queueState = baseState();
for (let index = 0; index < queueCount; index += 1) {
  queueState.workItems.push({
    id: `wi_${index}`, localNumber: index + 1, localRef: `LOCAL-${index + 1}`,
    ownerTeamId: actor.teamId, projectId: "prj_bench", title: `Benchmark ${index}`,
    body: "", type: "task", status: "ready", priority: "p2", state: "open",
    labels: [], assigneeIds: [], acceptanceCriteria: [], verificationRecords: [],
    executionBindings: [], updatedAt: timestamp,
    externalBindings: [{
      kind: "github_issue", number: index + 1,
      conflict: { detectedAt: timestamp, fields: ["title"] },
    }],
  });
}
const queueService = serviceFor(queueState);
const queueStarted = performance.now();
const queueResult = queueService.listAttention({}, actor).body;
const queueDurationMs = duration(queueStarted);

const deliveryState = baseState();
deliveryState.workItems.push({
  id: "wi_delivery", localNumber: 1, localRef: "LOCAL-1",
  ownerTeamId: actor.teamId, projectId: "prj_bench", title: "Newest",
  body: "", type: "task", status: "ready", priority: "p2", state: "open",
  labels: [], assigneeIds: [], acceptanceCriteria: [], verificationRecords: [],
  executionBindings: [], updatedAt: timestamp, revision: 1,
  externalBindings: [{
    kind: "github_issue", number: 1, repository: "bench/repo",
    remoteUpdatedAt: "2026-07-24T02:00:00.000Z",
  }],
});
const deliveryService = serviceFor(deliveryState);
const deliveryPayload = {
  repository: { full_name: "bench/repo" },
  issue: {
    number: 1, title: "Older", body: "", state: "open", labels: [],
    html_url: "https://github.test/bench/repo/issues/1",
    updated_at: "2026-07-24T01:00:00.000Z",
  },
};
const deliveryRaw = JSON.stringify(deliveryPayload);
const webhookSecret = "benchmark-webhook-secret";
const suppliedSignature = Buffer.from(createHmac("sha256", webhookSecret).update(deliveryRaw).digest("hex"));
const deliveryStarted = performance.now();
for (let index = 0; index < deliveryCount; index += 1) {
  const expectedSignature = Buffer.from(createHmac("sha256", webhookSecret).update(deliveryRaw).digest("hex"));
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) throw new Error("benchmark signature mismatch");
  deliveryService.ingestGithubWebhook({
    deliveryId: `delivery_${index}`, event: "issues", payload: JSON.parse(deliveryRaw),
  });
}
const deliveryDurationMs = duration(deliveryStarted);

const batchIds = queueResult.items.slice(0, batchCount).map((item) => item.id);
const warmupId = queueResult.items[batchCount]?.id;
if (warmupId) {
  const warmupResult = queueService.updateAttention({
    attentionIds: [warmupId], action: "claim", leaseSeconds: 900,
    idempotencyKey: "capacity-batch-warmup",
  }, actor);
  if (warmupResult.status !== 200) throw new Error("capacity batch warmup failed");
}
const batchStarted = performance.now();
const batchResult = queueService.updateAttention({
  attentionIds: batchIds, action: "claim", leaseSeconds: 900,
  idempotencyKey: "capacity-batch",
}, actor);
const batchDurationMs = duration(batchStarted);

const report = {
  schemaVersion: 1,
  queue: {
    count: queueResult.count,
    durationMs: queueDurationMs,
    itemsPerSecond: throughput(queueCount, queueDurationMs),
  },
  deliveries: {
    count: deliveryCount,
    retained: deliveryState.githubWorkItemWebhookDeliveries.length,
    durationMs: deliveryDurationMs,
    deliveriesPerSecond: throughput(deliveryCount, deliveryDurationMs),
  },
  batch: {
    count: batchResult.body?.count ?? 0,
    durationMs: batchDurationMs,
    itemsPerSecond: throughput(batchCount, batchDurationMs),
  },
  maximumDurationMs: maximums,
};
console.log(JSON.stringify(report));

if (queueResult.count !== queueCount
  || deliveryState.githubWorkItemWebhookDeliveries.length !== Math.min(1_000, deliveryCount)
  || batchResult.status !== 200
  || batchResult.body.count !== batchCount
  || queueDurationMs > maximums.queue
  || deliveryDurationMs > maximums.deliveries
  || batchDurationMs > maximums.batch) process.exit(1);

function baseState() {
  return {
    projects: [{ id: "prj_bench", ownerTeamId: actor.teamId }],
    workItems: [], workItemActivities: [], planningProjects: [],
    autoRuns: [], workItemAttentionOperations: [],
    githubWorkItemWebhookDeliveries: [], githubWorkItemWebhookFailures: [],
  };
}

function serviceFor(state) {
  let counter = 0;
  return createWorkItemService({
    state, now: () => timestamp,
    nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: () => {}, persistStateSoon: () => {},
  });
}

function duration(started) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function throughput(count, durationMs) {
  return durationMs > 0 ? Math.round((count / durationMs) * 1_000) : count;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
