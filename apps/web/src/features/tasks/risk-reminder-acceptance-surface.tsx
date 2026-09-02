import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DeliveryDecisionCard } from "./work-item-delivery-decision-card";
import { WorkItemReviewDecisionSection } from "./work-item-review-decision-section";
import { COPY } from "./work-item-summary-copy";
import type { DeliveryDecision } from "./work-item-summary-model";
import type { LocalWorkItemDeliveryEvidence } from "./task-view-types";
import surfaceCatalog from "./risk-reminder-acceptance-surface-v1.json";

type SurfaceScenario = (typeof surfaceCatalog.scenarios)[number];
type ActionPreview = LocalWorkItemDeliveryEvidence["actionPreview"];

const riskByScenario: Record<string, DeliveryDecision["risk"]> = {
  development_ready: "low",
  development_verification_missing: "medium",
  development_review_inconsistent: "unknown",
  development_changes_requested: "high",
  office_batch_committed: "low",
  office_batch_partial: "high",
  office_batch_rolled_back: "medium",
  office_write_state_unknown: "high",
};

const stateByScenario: Record<string, DeliveryDecision["state"]> = {
  development_ready: "ready",
  development_verification_missing: "caution",
  development_review_inconsistent: "caution",
  development_changes_requested: "changes",
  office_batch_committed: "ready",
  office_batch_partial: "changes",
  office_batch_rolled_back: "caution",
  office_write_state_unknown: "changes",
};

const headlineByScenario: Record<string, string> = {
  development_ready: "结果已通过复核和验证",
  development_verification_missing: "当前还不能确认交付",
  development_review_inconsistent: "复核结论需要重新核对",
  development_changes_requested: "暂不要确认这个结果",
  office_batch_committed: "办公批次已完成，等待确认",
  office_batch_partial: "办公批次只有部分内容成功",
  office_batch_rolled_back: "办公批次已回滚",
  office_write_state_unknown: "写入状态尚不能确认",
};

function developmentPreview(scenario: SurfaceScenario): ActionPreview {
  const ready = scenario.id === "development_ready";
  const missing = scenario.id === "development_verification_missing";
  const inconsistent = scenario.id === "development_review_inconsistent";
  return {
    mode: ready ? "pull_request" : "local_merge",
    operation: ready ? "create_pull_request" : "apply_local_changes",
    targetType: ready ? "pull_request" : "local_project",
    artifactKind: "source_code",
    deliveryTransport: ready ? "pull_request" : "local_merge",
    worktreeId: "acceptance-worktree",
    branchName: "candidate/risk-reminder",
    remoteUrl: null,
    changedFileCount: ready ? 3 : 2,
    changedFiles: ready ? ["src/feature.ts", "test/feature.test.ts", "docs/feature.md"] : ["src/feature.ts", "test/feature.test.ts"],
    officeDetails: null,
    reviewedCommit: "candidate-review",
    requiresConfirmation: true,
    canProceed: ready,
    blockedReasonCodes: missing
      ? ["verification_required"]
      : inconsistent
        ? ["review_inconsistent"]
        : ready
          ? []
          : ["review_changes_requested"],
  };
}

function officeBatch(scenarioId: string): NonNullable<NonNullable<ActionPreview["officeDetails"]>["batch"]> {
  if (scenarioId === "office_batch_committed") return {
    schemaVersion: 1, state: "committed", targetCount: 2, operationCount: 36,
    successCount: 36, failedCount: 0, restoredCount: 0, pendingCount: 0, unknownCount: 0,
    accountedCount: 36, countConsistent: true, anomalyCodes: [],
    rollback: { status: "available", protectedTargets: 2, restoredTargets: 0, blockedTargets: 0, unknownTargets: 0, countConsistent: true },
    detailCount: 36, detailsTruncated: true, details: [],
  };
  if (scenarioId === "office_batch_partial") return {
    schemaVersion: 1, state: "partial", targetCount: 2, operationCount: 20,
    successCount: 18, failedCount: 2, restoredCount: 0, pendingCount: 0, unknownCount: 0,
    accountedCount: 20, countConsistent: true, anomalyCodes: [],
    rollback: { status: "prepared", protectedTargets: 2, restoredTargets: 0, blockedTargets: 0, unknownTargets: 0, countConsistent: true },
    detailCount: 20, detailsTruncated: true, details: [],
  };
  if (scenarioId === "office_batch_rolled_back") return {
    schemaVersion: 1, state: "rolled_back", targetCount: 2, operationCount: 20,
    successCount: 0, failedCount: 0, restoredCount: 20, pendingCount: 0, unknownCount: 0,
    accountedCount: 20, countConsistent: true, anomalyCodes: [],
    rollback: { status: "rolled_back", protectedTargets: 2, restoredTargets: 2, blockedTargets: 0, unknownTargets: 0, countConsistent: true },
    detailCount: 20, detailsTruncated: true, details: [],
  };
  return {
    schemaVersion: 1, state: "needs_attention", targetCount: 2, operationCount: 10,
    successCount: 8, failedCount: 1, restoredCount: 0, pendingCount: 0, unknownCount: 1,
    accountedCount: 9, countConsistent: false, anomalyCodes: ["operation_count_mismatch", "terminal_state_mismatch"],
    rollback: { status: "not_available", protectedTargets: 0, restoredTargets: 0, blockedTargets: 0, unknownTargets: 0, countConsistent: true },
    detailCount: 9, detailsTruncated: false, details: [],
  };
}

function officePreview(scenario: SurfaceScenario): ActionPreview {
  const ready = scenario.id === "office_batch_committed";
  const rolledBack = scenario.id === "office_batch_rolled_back";
  const unknown = scenario.id === "office_write_state_unknown";
  return {
    mode: "local_merge",
    operation: "apply_office_result",
    targetType: "office_artifact",
    artifactKind: "office_artifact",
    deliveryTransport: "local_merge",
    worktreeId: null,
    branchName: null,
    remoteUrl: null,
    changedFileCount: 2,
    changedFiles: ["客户台账.xlsx", "归档表.xlsx"],
    officeDetails: {
      targetFiles: ["客户台账.xlsx", "归档表.xlsx"],
      estimatedAffectedRows: scenario.id === "office_batch_committed" ? 36 : 20,
      fields: ["状态", "更新时间"],
      operation: "update",
      writeMode: "batch",
      reversible: true,
      batch: officeBatch(scenario.id),
    },
    reviewedCommit: null,
    requiresConfirmation: true,
    canProceed: ready,
    blockedReasonCodes: ready
      ? []
      : rolledBack
        ? ["office_batch_rolled_back"]
        : unknown
          ? ["office_batch_attention", "office_batch_evidence_inconsistent"]
          : ["office_batch_attention"],
  };
}

function scenarioPresentation(scenario: SurfaceScenario) {
  const view = scenario.participantView;
  const decision: DeliveryDecision = {
    state: stateByScenario[scenario.id] ?? "caution",
    risk: riskByScenario[scenario.id] ?? "unknown",
    domain: scenario.domain as DeliveryDecision["domain"],
    domainLabel: view.workType,
    statusLabel: view.status,
    riskReason: view.reason,
    headline: headlineByScenario[scenario.id] ?? view.status,
    scope: view.completed,
    checks: view.reason,
    recommendation: view.recommendedNextStep,
    confirmEffect: view.actionImpact,
    confirmRisk: view.risk,
    revisionEffect: "保留当前结果和历史记录，不执行当前交付；需要时再发起一轮处理。",
    revisionRisk: "不会应用当前结果，但新的处理可能增加时间和成本。",
  };
  return {
    decision,
    actionPreview: scenario.domain === "office" ? officePreview(scenario) : developmentPreview(scenario),
  };
}

function buildMetadata() {
  const root = document.documentElement.dataset;
  return {
    version: surfaceCatalog.surface.version,
    productCommit: root.sourceCommit ?? "unavailable",
    sourceState: root.sourceState ?? "unknown",
    locale: surfaceCatalog.surface.locale,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export function RiskReminderAcceptanceSurface() {
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const scenario = surfaceCatalog.scenarios[index];
  const presentation = useMemo(() => scenarioPresentation(scenario), [scenario]);
  const metadata = buildMetadata();
  const builtSurfaceVersion = document.documentElement.dataset.acceptanceSurfaceVersion ?? "unknown";
  const limits = surfaceCatalog.surface.viewport;
  const eligible = /^[a-f0-9]{40}$/.test(metadata.productCommit)
    && metadata.sourceState === "clean"
    && builtSurfaceVersion === metadata.version
    && metadata.viewport.width >= limits.minimumWidth
    && metadata.viewport.width <= limits.maximumWidth
    && metadata.viewport.height >= limits.minimumHeight
    && metadata.viewport.height <= limits.maximumHeight;
  const safeAction = () => setNotice("这是只读验收展示面，没有执行任何操作。");
  const ready = presentation.decision.state === "ready";

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = surfaceCatalog.surface.locale;
    return () => { document.documentElement.lang = previous; };
  }, []);

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground" data-testid="risk-reminder-acceptance-surface">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <p className="text-xs font-medium text-muted-foreground">风险提醒用户验收 · 场景 {index + 1}/{surfaceCatalog.scenarios.length}</p>
          <h1 className="mt-1 text-xl font-semibold">请根据下面的任务界面回答主持人的问题</h1>
          <p className="mt-1 text-sm text-muted-foreground">先不要打开专业详情。此页面只展示合成场景，不会连接服务端或执行写操作。</p>
        </header>

        {!eligible ? (
          <div className="rounded-lg border border-warning/40 bg-warning/[0.08] p-3 text-sm" role="alert">
            当前构建不可用于正式验收：页面版本必须匹配，构建必须来自 clean commit，并使用 {limits.minimumWidth}×{limits.minimumHeight} 至 {limits.maximumWidth}×{limits.maximumHeight} 的受控视口。
          </div>
        ) : null}

        <DeliveryDecisionCard
          decision={presentation.decision}
          copy={COPY.zh}
          language="zh"
          actionPreview={presentation.actionPreview}
          onViewChanges={scenario.domain === "development" ? safeAction : undefined}
          onRerunVerification={scenario.id === "development_verification_missing" ? safeAction : undefined}
          onAskAiToFix={scenario.id === "development_changes_requested" ? safeAction : undefined}
          onCreatePullRequest={scenario.id === "development_ready" ? safeAction : undefined}
        />

        <WorkItemReviewDecisionSection
          resultSectionId={`acceptance-${scenario.id}`}
          language="zh"
          copy={COPY.zh}
          deliveryDecision={presentation.decision}
          executionContractReady
          executionContractDefined
          hasDelivery
          reviewVerdict={ready ? "approved" : scenario.id === "development_changes_requested" ? "changes_requested" : null}
          aiReviewStatus="completed"
          acceptActionLabel={scenario.participantView.primaryAction}
          confirmActionEffect={scenario.participantView.actionImpact}
          confirmActionRisk={scenario.participantView.risk}
          changeRequestOpen={false}
          feedbackMode="revision"
          changeRequest=""
          actionPending={null}
          executionActionLocked
          canConfirmDelivery={ready}
          onPrepareExecutionPlan={safeAction}
          onChangeRequest={() => {}}
          onCancelChangeRequest={safeAction}
          onSendChangeRequest={safeAction}
          onStopDelivery={safeAction}
          onOpenFollowUp={safeAction}
          onOpenRevision={safeAction}
          onAccept={safeAction}
        />

        {notice ? <p className="rounded-md bg-muted px-3 py-2 text-sm" role="status">{notice}</p> : null}

        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={index === 0} onClick={() => { setNotice(null); setIndex((value) => value - 1); }}>上一个场景</Button>
          <Button variant="secondary" disabled={index === surfaceCatalog.scenarios.length - 1} onClick={() => { setNotice(null); setIndex((value) => value + 1); }}>下一个场景</Button>
        </div>

        <details className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">主持人设置与记录信息</summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap" data-testid="acceptance-surface-metadata">{JSON.stringify({
            version: metadata.version,
            productCommit: metadata.productCommit,
            sourceState: metadata.sourceState,
            locale: metadata.locale,
            viewport: metadata.viewport,
          }, null, 2)}</pre>
        </details>
      </div>
    </main>
  );
}

export default RiskReminderAcceptanceSurface;
