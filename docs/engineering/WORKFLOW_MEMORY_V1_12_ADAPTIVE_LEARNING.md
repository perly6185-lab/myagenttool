# Workflow Memory V1.12 岗位助手与受治理学习

V1.12 让系统从用户明确授权的本地目录中识别新工作，把建议落成可追踪的本地
Issue，并在人工纠错、任务结果和影子评测的约束下形成可回滚的岗位规则。

本阶段不是“扫描整台电脑后自行接管工作”。系统只处理用户已经授权、仍处于 active
状态的 Workflow Memory 来源；不会自动外发、覆盖文件或修改原始资料。

## 用户目标

普通用户面对新询价、报价、订单或台账文件时，只需要在“岗位助手”完成以下动作：

1. 查看系统识别的文件类型、建议工作和判断依据。
2. 建议正确时确认创建本地 Issue；建议错误时填写正确类型或缺失步骤。
3. 在候选规则出现后，比较“当前结果”和“候选结果”，选择更符合实际工作的结果。
4. 管理员查看发布评审，在门禁通过后发布；发现回退时恢复上一版规则。

## 五阶段闭环

### 1. 引导式纠错

- “文件类型错误”必须提供正确类型。
- “建议步骤不完整”必须提供至少一条正确步骤。
- 纠正只能附着在拒绝反馈上，并需要独立确认。
- 服务端保存纠正前后的类型和步骤，不能只依赖 UI 校验。
- 同一建议后续反馈采用最新记录参与学习，旧记录继续保留审计证据。

### 2. 真实影子规则

- 学习草稿不会直接改变实际建议。
- 每条可比较建议展示当前结果、候选结果和具体差异。
- 人工选择 `current`、`candidate` 或 `neither`，并显式确认。
- 至少需要 3 条人工影子偏好；候选结果不得表现出相对当前规则的回退。

### 3. Issue 与成果回流

- 建议创建本地 Issue 使用稳定幂等键，同一建议不会产生重复任务。
- Issue 状态、交付资产和验证记录变化后立即投影回岗位助手。
- 投影失败不能回滚已经成功的 Issue 修改；可以通过有界同步接口恢复。
- 系统只记录有界资产引用和验证摘要，不复制任意外部内容。

### 4. 可解释发布评审

发布前必须生成与当前草稿修订绑定的评审快照，内容包括：

- 反馈与影子评测门禁；
- 采用的证据数量和证据 ID；
- 每个文档类型新增、移除的动作；
- 类型映射和预计受影响建议数量；
- 当前回滚点；
- 候选尚未生效、本地 Issue 限定和禁止外发边界。

发布请求必须携带评审指纹。草稿、评测或活动规则发生变化后，旧指纹失效，用户需要
重新生成评审。发布只激活规则，不自动执行外部交付。

### 5. 发布、降级与回滚

- 反馈样本至少 5 条，采纳率不得低于 80%。
- 影子偏好至少 3 条，候选胜出数不得低于当前规则。
- 有至少 5 个真实 Issue 结果时，完成率不得低于 80%。
- 执行模式的采纳率低于 70%、拒绝率高于 20%，或代表性完成率不达标时，自动降级为协助模式。
- 新规则发布后保留上一版引用；回滚需要管理员确认和当前 revision。

## 协助级别

| 模式 | 行为 | 用户确认 |
| --- | --- | --- |
| 观察 | 只显示解释性建议 | 不创建 Issue |
| 协助 | 用户确认后创建本地 Issue | 每条建议确认 |
| 执行 | 只对通过类型、置信度、历史、风险和反馈门禁的建议创建本地 Issue | 启用模式时确认 |

即使处于执行模式，也不会自动发送报价、修改来源文档或越过已有 Routine 审批。

## 数据与权限边界

- Policy、Monitor、Feedback、Outcome、Draft、Rule 和 Notification 均绑定 owner team、项目和来源。
- 普通操作员可以使用建议和提交反馈；只有 owner/admin 可以管理策略、生成规则和发布回滚。
- 所有写操作应用项目可见性、来源状态、revision 和有界字段校验。
- 后台监控限制单次全局并发；失败采用退避并产生可读通知，进程中断后进入可恢复状态。
- 原始文件仍位于用户目录；岗位助手持久化的是派生元数据、审计证据和本地 Issue 关系。

## API 摘要

```text
GET  /api/workflow-memory/adaptive-workbench
PUT  /api/workflow-memory/adaptive-workbench/policy
PUT  /api/workflow-memory/adaptive-workbench/monitor
POST /api/workflow-memory/adaptive-workbench/monitor/run
POST /api/workflow-memory/adaptive-workbench/reconcile
POST /api/workflow-memory/adaptive-workbench/suggestions/{id}/feedback
POST /api/workflow-memory/adaptive-workbench/suggestions/{id}/materialize
GET  /api/workflow-memory/adaptive-workbench/learning
POST /api/workflow-memory/adaptive-workbench/learning
POST /api/workflow-memory/adaptive-workbench/learning/drafts/{id}/shadow/{suggestionId}/preference
POST /api/workflow-memory/adaptive-workbench/evaluate
POST /api/workflow-memory/adaptive-workbench/learning/drafts/{id}/publication-preview
POST /api/workflow-memory/adaptive-workbench/learning/drafts/{id}/publish
POST /api/workflow-memory/adaptive-workbench/learning/rules/{id}/rollback
```

## 发布验收

发布候选必须同时满足：

1. 类型纠错和步骤补全均有服务端必填、确认及前后快照测试。
2. 三条不同建议可以完成影子偏好，未达到门禁时不能发布。
3. Issue 更新、验证记录和交付资产可以即时回流，重复同步不产生重复 Outcome。
4. 未生成评审、评审指纹错误或 revision 过期时发布失败。
5. 发布后新建议使用活动规则；回滚后恢复上一版本。
6. 中文普通用户界面可完成完整流程，并明确候选不影响实际工作。
7. Web 全量测试、服务端单元/集成测试和 Chromium 真实服务回归通过。

当前自动化验证入口：

```bash
TZ=UTC npm --prefix apps/server test
npm --prefix apps/web test
npm --prefix apps/web run typecheck
pnpm --filter @myagenttool/web exec playwright test \
  -c playwright.config.ts workflow-memory-pilot-real-server.spec.ts --project=chromium
```

## 真实目录灰度

1. 资料所有者选择一个明确授权的业务子目录，不使用主目录或整盘根路径。
2. 第一周只启用观察模式，人工处理全部建议并记录纠错。
3. 达到反馈与影子门禁后，由管理员生成发布评审；不直接进入执行模式。
4. 第二周在协助模式下核对 Issue 数量、完成率、资产回流和重复率。
5. 只有在代表性完成率、采纳率和安全边界均通过时，才对单一来源灰度执行模式。
6. 出现错误类型扩散、拒绝率上升、重复 Issue 或来源边界异常时，立即回到协助模式并回滚规则。

真实或脱敏资料、绝对路径和客户身份不得提交到 Git。灰度记录只保存案例 ID、结构化结果、
审批证据和必要的有界摘要。
