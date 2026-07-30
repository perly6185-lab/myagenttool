# Workflow Memory V1.5 试运行与发布门禁

本指南用于 [#1566](https://github.com/perly6185-lab/myagenttool/issues/1566)。
它把固定回归夹具与正式商务试运行严格分开：

- **合成演练**只证明评测器、指标和 CI 接线可工作，不能作为真实准确率。
- **脱敏试运行**必须由资料所有者确认已经移除个人信息、秘密和不必要业务原文。
- **真实试运行**必须明确授权用途和范围，默认仍在本机完成。

系统不会因为合成演练全绿而允许扩大灰度。

## 开始前

1. 只选择用户明确授权的本地目录，不扫描整台电脑。
2. 为每个案例准备人工确认的期望文档角色、历史关系和订单/无订单结果。
3. 原始文档和试运行清单放在 `.myagenttool/` 或其他不受 Git 跟踪的本地目录。
4. 不把绝对路径、原文、Prompt、Secret、文件哈希或客户身份写入清单。
5. 至少准备十个案例，覆盖两个以上模板，以及重复、缺失事实、冲突事实、重启和并发。

当前保证读取 Markdown、纯文本、HTML、CSV、DOCX、XLSX 和含文本层的 PDF。
扫描 PDF、图片 OCR、音视频、多模态内容和 Office 模板保存性生成不属于 V1.5
正式保证。Markdown 报价模板仍是唯一启用的受治理生成格式。

## 真值清单格式

正式采集使用“真值清单”。它只允许填写授权信息、人工确认的期望结果和系统记录 ID；
不允许填写 `observed` 或任何 `passed` 字段。额外字段会失败关闭：

```json
{
  "schemaVersion": 1,
  "pilotId": "local-commercial-pilot-2026-07",
  "description": "不包含客户身份或业务原文的说明",
  "dataClassification": "deidentified",
  "consent": {
    "confirmed": true,
    "recordedAt": "2026-07-30T00:00:00.000Z",
    "scope": "十个脱敏商务案例，仅用于本地 V1.5 评测"
  },
  "releaseReview": {
    "confirmed": true,
    "recordedAt": "2026-07-30T00:00:00.000Z",
    "reviewerRole": "工作区所有者",
    "performance": true,
    "security": true,
    "privacy": true,
    "accessibility": true,
    "localization": true,
    "migration": true,
    "rollback": true
  },
  "thresholds": {
    "minimumFormalCases": 10,
    "documentRoleTop1": 0.8,
    "relationshipTop1": 0.75
  },
  "cases": [],
  "safetyScenarios": []
}
```

每个案例引用已经在产品中运行完成的本地任务。`relationshipArtifactId` 是人工确认
应当关联的目标文档 ID；没有预期关系时省略该字段：

```json
{
  "id": "case-01",
  "workItemId": "wit_example",
  "templateId": "quotation-template-a",
  "traits": ["missing_fact"],
  "expectedDocumentRole": "inquiry",
  "relationshipExpected": true,
  "relationshipArtifactId": "wfa_expected_quotation",
  "expectedOutcome": "no_order",
}
```

安全场景必须引用产品已经产生的事件、拒绝或文档分类记录。系统会检查引用是否属于
当前团队且内容是否真正证明对应防护，不能通过手写布尔值制造通过结果：

```json
{
  "id": "prompt_injection",
  "evidenceKind": "classification",
  "evidenceId": "bdc_example"
}
```

系统从这些 ID 自动生成正式评测清单中的聚合观察值，包括角色、关系排名、纠正、
完成、重复 Issue/Business Case/报价/台账行、审批和恢复。输出不包含绝对路径、
原文、Prompt、Secret 或文件哈希。

旧的人工观察清单仍仅用于仓库内固定合成演练。可从
`apps/server/test/fixtures/workflow-memory/commercial-pilot-v1.5-rehearsal.json`
查看评测器结构，但不得把它改名或改标记后作为正式证据。修改标记不等于获得授权。

## 执行

先运行不产生正式发布结论的合成演练：

```bash
pnpm eval:commercial-pilot:rehearsal
```

正式试运行先从正在运行的本地服务自动收集证据。认证令牌只通过环境变量传入，
不要放进命令参数或真值清单：

```bash
MYAGENTTOOL_TOKEN=本地令牌 \
WORKFLOW_MEMORY_PILOT_SPEC=/absolute/local/path/pilot-truth.json \
pnpm eval:commercial-pilot:evidence -- \
  --server http://127.0.0.1:4310 \
  --out-evidence .myagenttool/pilot-reports/v1.5-evidence.json \
  --out-manifest .myagenttool/pilot-reports/v1.5-manifest.json
```

证据状态为 `incomplete` 时，命令退出 `1`，输出会按案例和安全场景列出缺失原因。
本机以外的服务必须使用 HTTPS。采集接口的初步报告固定把质量夹具视为未完成，
因此不会单独给出正式 Go。

证据完整后再运行包含固定质量夹具的最终门禁：

```bash
WORKFLOW_MEMORY_PILOT_MANIFEST=.myagenttool/pilot-reports/v1.5-manifest.json \
pnpm eval:commercial-pilot -- \
  --out-json .myagenttool/pilot-reports/v1.5.json \
  --out-md .myagenttool/pilot-reports/v1.5.md
```

退出码：

- `0`：正式 Go，或 `--rehearsal` 的非正式门禁通过。
- `1`：指标或安全门禁为 No-Go。
- `2`：参数、文件读取或 JSON 格式错误。

JSON 和 Markdown 报告只包含聚合指标、门禁结果和字段错误。报告文件以仅当前用户
可读的模式新建；不要把报告目录加入 Git。

`releaseReview` 不是泛化的勾选框：评审人必须分别检查性能、安全、隐私、
可访问性、本地化、迁移兼容和回滚证据。任一项不通过都应填写 `false`，正式门禁
会返回 No-Go。

## 指标定义

| 指标 | 定义 | 正式门槛 |
| --- | --- | --- |
| 文档角色 Top-1 | 第一识别结果与人工真值一致的案例比例 | ≥80% |
| 关系 Top-1 / Top-5 | 正确历史关系所在位置 | Top-1 ≥75%，Top-5 如实报告 |
| 未知覆盖 | 应为未知的资料仍保持未知 | 强制猜测数为 0 |
| 纠正率 | 至少发生一次人工纠正的案例比例 | 如实报告 |
| 完成率 | 达到明确结束状态的案例比例 | 如实报告 |
| 证据覆盖 | 每个案例所需运行、分类、关系和恢复记录完整 | 100% |
| 业务结局一致性 | 系统分支与人工确认的订单/无订单/拒绝结果一致 | 100% |
| 重复率 | 重复 Issue、Business Case、报价或台账行总数 | 0 |
| 审批覆盖 | 报价和台账修改对应的审批数 / 修改数 | 100% |
| 恢复通过率 | 重放、重启、移动、取消及并发恢复结果 | 100% |
| 安全通过率 | 十项发布安全场景 | 100% |

门禁还要求同时保留 V1.4 固定质量夹具全绿，避免真实样本很小而掩盖已有回归。

## 普通用户试运行步骤

1. 在“交付记忆”中选择并确认一个授权目录。
2. 检查系统对历史文件的归类和关系；错误结果先纠正再继续。
3. 审核并发布一个询价工作流。
4. 在“新询价接收”中检查稳定文件，核对字段后创建任务。
5. 在“任务”页使用“处理询价”主按钮，不需要理解执行器、锁或哈希。
6. 对每次报价和台账变化分别查看预览并确认。
7. 有已确认订单时选择订单证据；否则明确选择“尚未收到订单”。
8. 在真值清单中只选择任务、模板、期望角色、关系和结果；运行结果由系统自动采集。

等待设备容量或同一台账前序写入时，任务应显示普通业务语言和排队位置。取消一个
任务不会取消其他询价；服务重启后等待队列会从持久状态恢复。

## 必测安全与恢复

正式清单必须包含并通过：

- 未授权路径读取、`..` 路径穿越和逃逸符号链接；
- Prompt 注入、公式注入和跨租户访问；
- 过期审批、外部文件修改和静默覆盖；
- 自动发送报价或绕过人工审批；
- 重复接入、重复点击、服务重启、移动/改名；
- 五询价且设备并发为二、同台账排队、不同台账并行；
- 排队任务取消、活动任务中断和安全重试。

## 删除与退出

- 删除本地试运行清单和报告即可移除额外评测材料；产品不会把清单上传到 Provider。
- 在来源设置中撤销来源，阻止新的扫描、检索和任务创建。
- 停用已发布 Routine，阻止新任务；已存在的 Issue 和审计仍保留。
- 需要删除业务文档时先在原目录处理，再重新扫描并确认失效证据。
- 不直接编辑或清空持久化状态文件来“回滚”，否则会破坏审计和幂等收据。

## 发布与回滚

只有正式报告为 Go、真实服务 E2E 和 CI 全绿后，才能把灰度从单个授权目录扩大。
首次灰度仍默认关闭自动接入和外部发送；每次新询价、报价及台账写入保持人工确认。

出现越权读取、静默覆盖、重复写入或审批绕过时立即 No-Go：

1. 停用 Routine 和新询价接入；
2. 保留原文件、审计、幂等收据和失败报告；
3. 从台账审计使用已有恢复机制撤销受影响写入；
4. 建立关联缺陷 Issue，修复和回归后重新运行完整正式门禁。
