# Work item summary architecture

`WorkItemSummaryView` is the ordinary-user task surface. Its public props, visible copy, and navigation behavior are intentionally stable while its internal responsibilities are split into bounded modules.

## Current boundaries

- `work-item-summary-view.tsx` owns data loading, presentation state, dialogs, scrolling/focus, and composition of task sections.
- `work-item-execution-controller.ts` owns execution write orchestration: contract preparation and confirmation, start cancellation/recheck, clarification answer/stop, retry, change requests, re-verification, reconciliation, and automatic-execution policy changes.
- `work-item-review-action-controller.ts` interprets the server-projected action availability. It is composed by the execution controller so projected locks remain authoritative and unknown future actions never guess a write.
- `execution-start-*`, `execution-review-*`, `work-item-summary-model.ts`, and `work-item-summary-copy.ts` own focused presentation and pure derivation.
- `work-item-result-review.tsx` owns result summaries, review evidence, changed-file entry points, failed-run files, repair presentation, and the full-report body.
- `work-item-review-decision-section.tsx` owns the review decision and feedback presentation while receiving authority and action availability as explicit inputs.
- `work-item-completed-task-card.tsx` owns completion state, local delivery receipts, reuse actions, and post-completion template feedback.
- `work-item-delivery-recovery-alert.tsx` owns recoverable delivery-error presentation; recovery execution remains in the view/controller boundary.
- `work-item-record-bindings.tsx` owns bounded business-record presentation and the execution-time snapshot lock; the parent supplies the governed refresh command.
- `work-item-ledger-posting-plan.tsx` owns ledger-plan loading, stale-plan regeneration, approval-grant acquisition, commit feedback, and viewer-safe presentation.
- `work-item-channel-data-contract.tsx` owns the read-only Channel data-plan, relationship-confirmation, mutation-scope, and batch-recovery evidence surfaces; it never issues the confirmed mutation.
- `work-item-template-binding-card.tsx` owns template-match explanation, learned-correction guidance, processing steps, and the correction picker; candidate loading and revision-bound writes remain in the parent/controller boundary.
- `work-item-deliverable-files.tsx` remains the shared changed-file and result-file browser used by the focused result modules.

The execution controller receives the current task snapshot plus explicit UI effects. It may update the task snapshot, pending/error state, receipts, and refresh signal, but it does not render JSX, navigate directly, or own result/delivery presentation.

## Execution invariants

1. Preparation and confirmation remain separate. Preparing a contract may open the existing confirmation, but only `startAiWork` confirms the contract and starts the handoff.
2. Every repeatable execution write uses `actionRequest`, which binds its idempotency key to the task revision, target state, and latest action receipt.
3. `accepted`, `running`, and `unknown` receipts lock repeated mutations until refreshed or reconciled.
4. Server-projected review availability overrides permissive legacy UI checks. Read-only navigation remains available while projected mutations are locked.
5. Uncertain network outcomes produce an `unknown` receipt and refresh the task instead of encouraging a duplicate write.

## Adding an execution action

Add execution writes to `work-item-execution-controller.ts`, including their authority check, idempotency request, receipt/error handling, and refresh event. Expose only the resulting handler to the view. Add action-projection interpretation to `work-item-review-action-controller.ts` only when the server contract changes.

Presentation-only task states belong in the focused card/model modules. Result review, changed-file presentation, delivery recovery, and completion rendering are explicit presentation boundaries; they must not issue writes, derive new authority, or move into the execution controller.

## Regression boundary

- `work-item-execution-controller.test.ts` covers controller invariants and projected action locks.
- `work-item-review-action-controller.test.ts` covers server projection authority and unknown-action behavior.
- `work-item-result-presentation.test.tsx` covers completion receipts, delivery recovery, repair permissions, failed-run files, and authoritative review locks.
- `work-item-business-records.test.tsx` covers locked record snapshots and read-only ledger-plan presentation.
- `work-item-channel-data-contract.test.tsx` covers bounded source/relationship evidence and mutation recovery evidence without exposing raw digests or write actions.
- `work-item-template-binding-card.test.tsx` covers learned-match explanation, trace redaction, correction authority, and callback-only writes.
- `work-item-summary-view.test.tsx` covers the ordinary component journey and visible behavior.
- The ordinary coding real-server Playwright journey remains the end-to-end delivery boundary.

### 冻结意图审核投影（I4）

进入执行后，审核界面不得重新从当前任务标题、正文或任务类型推导本次动作边界。服务端通过 `WorkItemReviewIntent` 从 AutoRun 的只读 `executionContract.intentContract` 投影目标、预期结果、资料范围、权限边界以及最终确认的效果码/风险码。投影缺失时标记为 `unavailable`，不把可变任务文本提升为执行权威。

Web 的意图摘要、执行审核卡、结果动作说明和最终确认弹窗只对这些语义码做本地化；旧响应才保留原有兼容文案。服务端动作命令仍会独立复查交付证据与动作白名单，UI 投影不授予新权限。

### 办公批次证据守恒（I5）

办公批次包含两个不同量纲：`operationCount` 是记录操作数，`targetCount` 是文件目标数。`OfficeBatchEvidence` 要求已应用、已恢复、失败、待处理和未知操作严格守恒到操作总数；文件回滚则单独记录受保护、已恢复、受阻和未知目标。两种计数禁止相加或互相补位。

批次终态与回执数量冲突、重复操作 ID、未知子状态、文件目标范围冲突或回滚覆盖不完整时，投影标记 `countConsistent=false` 并输出封闭异常码。服务端将其映射为高风险和 `office_batch_evidence_inconsistent`，禁用应用动作但保留批次详情；Web 显示操作回执比例与文件恢复摘要，不从展示文案反推可写权限。
