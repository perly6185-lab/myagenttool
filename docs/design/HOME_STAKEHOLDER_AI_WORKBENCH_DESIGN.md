# 首页关系人跟进与 AI 执行工作台设计

Status: accepted; implemented through PR 6's deterministic report review UI and PR 8's governed report delivery.

Related: `docs/engineering/HOME_WORKBENCH_INFORMATION_ARCHITECTURE_PLAN.md`

Prototypes:

- `docs/design/prototypes/home-stakeholder-ai-workbench.html`
- `docs/design/prototypes/work-item-follow-up-fields.html`

## 1. 决策

首页继续作为个人交付工作台，不新增独立的“任务状态中心”。Local Issue 是工作主线，首页把以下四类信息组合成一个可行动的摘要：

1. 谁提出或等待这项工作；
2. 哪位成员负责跟进；
3. AI 当前是否在执行、等待审批、失败或已产出结果；
4. 下一步由谁在什么时间采取什么行动。

任务的业务、规划和 AI 执行状态保持分离。AI 完成只能使工作进入人工复核候选状态，不能自动把 Local Issue 标记为完成或关闭。

## 2. 用户与成功信号

主要用户是每天打开首页安排交付工作的普通成员，同时兼顾需要了解团队责任的负责人。

用户进入首页后，应当能在十秒内回答：

- 今天哪些任务需要我行动；
- 这些结果需要向谁交付；
- 哪些工作正在等人、等 AI 或等审批；
- AI 已经做到哪一步，结果在哪里复核。

首页不是运行记录、审批详情或证据详情的所有者。查看日志进入 Run records，审批进入 Approvals，验收和证据进入 Review / Evidence。

## 3. 概念边界

| 概念 | 含义 | 示例 |
| --- | --- | --- |
| Requester / stakeholder | 谁提出任务或期待结果 | 客户张总、直属上级李经理、自己 |
| Intake origin | 任务如何进入系统 | 手工、会议、邮件、聊天、GitHub |
| Assignee | 谁对跟进和交付负责 | 当前用户、同事王工 |
| Waiting on | 当前由谁推进下一步 | 我、提出者、内部成员、AI |
| AI executor | 哪个 Agent 执行可自动化部分 | Codex、Claude、本地 Routine |

关系类型不是优先级。Boss 或客户任务仍由显式优先级、承诺时间、到期时间和阻塞程度决定排序。

`boss` 表示公司负责人或最终决策者，`manager` 表示直属或业务上级。如果实际业务没有稳定区别，产品配置可以把两者合并显示为“上级”，但数据层保留稳定枚举。

## 4. 数据设计

在 Local Work Item 上增加结构化跟进上下文，不使用 labels 长期承载这些字段。

```ts
type RequesterRelation =
  | "boss"
  | "manager"
  | "customer"
  | "colleague"
  | "self"
  | "unknown";

type IntakeChannel =
  | "manual"
  | "meeting"
  | "email"
  | "chat"
  | "phone"
  | "github"
  | "import"
  | "other"
  | "unknown";

type WaitingOn = "me" | "requester" | "internal" | "ai" | "none";

type WorkItemFollowUp = {
  followUpSchemaVersion: 1;
  requesterRelation: RequesterRelation;
  requesterName: string | null;
  requesterOrganization: string | null;
  requesterUserId: string | null;
  intakeChannel: IntakeChannel;
  externalReference: string | null;
  waitingOn: WaitingOn;
  commitmentDate: string | null;
  nextFollowUpAt: string | null;
  lastProgressAt: string | null;
  lastProgressSummary: string | null;
};
```

约束：

- `requesterUserId` 只能引用同一租户内可见用户；外部客户使用姓名和组织，不伪造内部用户。
- 历史任务迁移为 `unknown`，不能默认标记为 `self`。
- 历史任务的进入渠道同样迁移为 `unknown`，不能猜测为手工创建。
- 新建手工任务可以预选“自己”，但该字段必须在表单中可见并可编辑。
- 提出者姓名、组织和外部引用进入现有活动审计，并遵守租户隔离。
- 现有创建表单的 `sourceMode` 表示文章内容来源，不复用为 `intakeChannel`。
- 关系人字段不自动注入 Agent 提示词；只有任务执行确实需要时才按策略传入。
- `lastProgressAt` 和 `lastProgressSummary` 是服务端所有字段；PR 1 只建立兼容契约，后续“记录进展”端点通过追加活动记录更新，通用创建/编辑请求不能伪造历史。

## 5. 状态模型

### 5.1 保留的三个状态轴

| 状态轴 | 所有者 | 值 |
| --- | --- | --- |
| Business | Local Issue | open / closed |
| Planning | Local Issue | backlog / ready / in_progress / review / blocked / done |
| Execution | invocation / auto-run 派生 | unclaimed / claimed / running / awaiting_approval / verifying / failed / completed |

`waitingOn`、跟进时间和最近进展是协作上下文，不创建第四套可任意编辑的工作流状态。

### 5.2 首页派生关注原因

首页服务端读模型按优先顺序计算一个主关注原因，同时允许保留辅助原因：

1. `overdue`：承诺时间或到期时间已过且任务未完成；
2. `approval_required`：AI 等待人工审批；
3. `ai_failed`：最新有效执行失败；
4. `review_ready`：AI 已完成但规划状态尚未完成；
5. `follow_up_due`：下次跟进时间已到；
6. `waiting_requester`：正在等待提出者；
7. `waiting_internal`：正在等待内部成员；
8. `ai_running`：AI 正在执行；
9. `planned`：已经排入今天或明天，无额外关注。

核心转换示例：

```text
客户提出 -> ready + waitingOn me
开始处理 -> in_progress
交给 AI -> in_progress + execution running + waitingOn ai
AI 要求审批 -> execution awaiting_approval + waitingOn me
AI 完成 -> planning review + execution completed + waitingOn me
人工复核并汇报 -> planning done
确认业务闭环 -> business closed
```

## 6. 首页读模型

前端不分别拼接 Issue、Run、Approval 和 Evidence 状态。服务端提供稳定的 Home Workbench 投影：

```ts
type HomeWorkbenchItem = {
  workItemId: string;
  title: string;
  projectId: string | null;
  priority: "p0" | "p1" | "p2" | "p3";
  assignees: Array<{ id: string; name: string }>;
  requester: {
    relation: RequesterRelation;
    name: string | null;
    organization: string | null;
  };
  planningStatus: LocalWorkItemStatus;
  executionState: LocalWorkItemExecutionState;
  waitingOn: WaitingOn;
  attentionReason: HomeAttentionReason | null;
  secondaryReasons: HomeAttentionReason[];
  dueDate: string | null;
  commitmentDate: string | null;
  nextFollowUpAt: string | null;
  nextAction: {
    kind: "open_issue" | "record_progress" | "review_result" |
      "open_approval" | "open_run" | "retry";
    label: string;
    targetId: string;
  };
  ai: null | {
    invocationId: string;
    agentId: string;
    agentName: string;
    status: string;
    updatedAt: string;
  };
};
```

排序键建议为：严重逾期、人工审批、AI 失败、承诺时间、下次跟进时间、显式优先级、计划日期。关系类型只参与筛选和轻量展示，不覆盖这些规则。

## 7. 首页信息架构

```text
首页
├─ 工作概览
│  ├─ 待我回复
│  ├─ AI 待审批
│  ├─ AI 失败
│  ├─ 今日到期
│  └─ 待复核与汇报
├─ Start or continue work（沿用现有 composer）
├─ 关系筛选：全部 / Boss / 上级 / 客户 / 同事 / 自己
├─ 三日工作台
│  ├─ 今天
│  ├─ 明天
│  ├─ 未排期
│  └─ 待认领
└─ AI 正在执行（仅活跃或需关注时显示）
```

任务卡固定阅读顺序：

```text
[客户 · 张总] [P1]                         周五前
官网方案确认
负责人：我        人：等客户回复        AI：草稿已完成
下一步：复核草稿并向客户更新                         [复核]
```

首页不显示完整 transcript、终端输出、历史运行列表、完整审批表单或证据明细。

## 8. 交互与响应式规则

- 概览数字是筛选入口，不是装饰；选择后只展示对应关注队列。
- 关系筛选允许单选，默认“全部”；“只看需要我处理”作为独立开关。
- 点击关系人进入同关系筛选，不在 MVP 创建联系人详情页。
- 卡片主按钮永远是服务端派生的下一步动作；任务详情作为次级入口。
- 桌面端主工作台与 AI 活跃区为两列；窄屏按“关注概览、任务、AI 活跃区”顺序堆叠。
- AI 区无活跃或关注项时完全隐藏，不显示大型空状态。
- 长标题、长组织名和本地化文字允许换行，不能挤压主动作。

### 8.1 新建与编辑 UI

现有 Local Issue 创建表单增加“来源与跟进”分组，放在基本描述之后、排期字段之前。新建手工任务可见地预选“自己”，但用户可以在创建前修改。

字段阅读顺序：

```text
提出者关系 | 进入渠道
提出者姓名 | 组织（自己提出时隐藏）
当前等待谁 | 负责人（复用 assigneeIds）
承诺时间   | 下次跟进
外部引用（编辑时按需显示）
```

- 外部客户使用姓名和组织；内部同事或上级可以关联租户成员。
- “最近进展”不在编辑表单中直接覆盖，通过追加进展操作更新并保留活动历史。
- 保存时在顶部汇总错误，并在对应字段显示可恢复的错误说明。
- 选择“客户”但没有姓名时阻止保存；历史 `unknown` 可以在不虚构姓名的情况下继续使用。

### 8.2 详情 UI

Issue 详情的“关系与交付”卡和“AI 执行”卡保持分离：

- 关系与交付展示提出者、渠道、负责人、等待对象、承诺时间、下次跟进和最近进展；
- AI 执行卡只显示服务端派生状态、Agent、更新时间和 canonical Run records 入口；
- “记录一次进展”追加摘要，并可同时更新等待对象和下次跟进；
- 历史任务展示“提出者未标注”和“补充来源”，不能静默显示为自己提出；
- AI `completed` 时详情主动作是人工复核，规划状态仍保持 `review`。

## 9. MVP 交付拆分

### PR 1：关系人和跟进数据

- 协议类型、服务端校验和存储迁移；
- 创建、编辑、详情展示；
- 活动审计与租户边界测试；
- 历史数据以 `unknown` 迁移。

### PR 2：首页聚合读模型

- 关注原因、下一步动作和排序规则；
- Issue、invocation、auto-run、approval 的稳定投影；
- 表驱动单元测试覆盖状态组合。

### PR 3：首页 UI

- 关注概览与筛选；
- 三日工作台卡片增强；
- 活跃 AI 摘要与 canonical navigation；
- 桌面、窄屏、空状态和失败状态测试。

### 后续：汇报闭环

- 记录一次进展及下次跟进；
- 当前由固定结构化模板生成面向 Boss、上级、客户或同事的汇报草稿；若后续接入语言模型，必须单独标识模型与策略版本；
- 人工确认后才能外发或关闭任务。

汇报草稿是 Issue 所有的独立、版本化资源，而不是新的任务状态。首阶段服务端契约为：

```text
POST   /api/work-items/:id/report-drafts
GET    /api/work-items/:id/report-drafts
GET    /api/work-items/:id/report-drafts/:draftId
PATCH  /api/work-items/:id/report-drafts/:draftId
POST   /api/work-items/:id/report-drafts/:draftId/confirm
POST   /api/work-items/:id/report-drafts/:draftId/discard
```

每个草稿固定记录目标关系人、语气、内容、工作项来源 revision、最近进展活动和受限的 AI
结果摘要引用。生成新草稿会 supersede 尚未确认的旧草稿；来源工作项 revision 变化后，旧草稿
标记为 stale，不能继续编辑或确认。确认时保存不可变内容快照和摘要，并写入活动审计。

草稿状态仅为 `draft / confirmed / discarded / superseded`。`confirmed` 不代表 `sent`，上述
接口不接受收件地址、发送、执行、完成或关闭字段，也不改变业务状态、规划状态或执行状态。
后续外发必须从已确认快照转换为渠道专用草稿，再经过独立的收件人预览、凭证和发送回执门禁。

PR 7 的跟进提醒是独立于汇报草稿的持久资源。每次设置或改动 `nextFollowUpAt` 都产生新的
服务端跟进计划版本；到期扫描以 `workItemId + followUpScheduleRevision` 作为稳定去重键，
普通标题、优先级或其他 Issue revision 变化不会重复提醒。同一计划只有一个提醒记录：

```ts
type WorkItemFollowUpReminder = {
  schemaVersion: 1;
  workItemId: string;
  ownerTeamId: string;
  scheduleRevision: number;
  sourceRevision: number;
  scheduledFor: string;
  status: "due" | "resolved";
  resolution: null | "progress_recorded" | "rescheduled" |
    "schedule_cleared" | "completed" | "archived";
};
```

到期提醒进入现有“需跟进”工作板和通知中心，点击后返回 canonical Local Issue。记录进展、
重新安排/清除下次跟进、完成、关闭或归档任务会自动解决已有提醒并追加活动审计。浏览器通知
沿用现有显式开启机制且只显示数量；提醒投影不包含汇报正文、原始 transcript、凭证、收件人
地址或渠道发送控制。真正外发仍属于 PR 8。
### PR 8：受控外发与发送回执

外发是汇报复核之后的独立两步操作，不复用“确认汇报”的命令：

```text
POST /api/work-items/:id/report-drafts/:draftId/deliveries
GET  /api/work-items/:id/report-drafts/:draftId/deliveries
GET  /api/work-items/:id/report-drafts/:draftId/deliveries/:deliveryId
POST /api/work-items/:id/report-drafts/:draftId/deliveries/:deliveryId/send
```

第一步从已确认快照生成不可变外发预览，固定报告 revision、完整内容摘要、消息分段摘要、渠道和
会话收件人；目标不存在、跨团队、渠道禁用或报告未确认时均失败关闭。第二步只接受与
`work_item.report.deliver + deliveryId` 精确绑定的新单次审批令牌，并在目标与分段摘要仍一致时
原子写入所有渠道投递。幂等键重放返回原结果，不允许同键切换内容或目标。

外发记录状态为 `preview / queued / delivered / failed`。`queued` 之后的状态由所有渠道子投递
汇总，回执显示已送达/失败分段数、尝试次数、提供商回执 ID 和错误码。原始外发内容与目标不进入
公共 `/api/state`，只通过工作项和团队隔离的专用接口读取；记录及回执跨重启持久化。

真正外发不会隐式完成或关闭工作项，也不改变业务状态、规划状态、执行状态或工作项 revision。
用户必须先看到准确的渠道、提供商、收件人和不可变消息正文，再在独立确认框中授权一次发送。

## 10. MVP 验收标准

- 新建或编辑 Local Issue 时可以记录提出者关系、姓名、渠道和承诺时间。
- 首页能区分“等我、等提出者、等内部成员、等 AI”。
- 绑定 AI 的任务始终显示服务端派生执行状态。
- AI 完成不会直接导致 Issue `done` 或 `closed`。
- 用户可以从首页一步进入正确的 Issue、Run、Approval 或 Review 页面。
- 关系筛选、关注筛选、刷新和窄屏布局行为稳定。
- 历史任务明确显示“未标注”，不会被误认为自己提出。
- 首页没有复制 Run transcript、完整审批或证据详情。
- 已确认汇报可以预览准确的渠道、收件人和不可变内容，经单次审批后真正外发并查看渠道回执。
- 外发成功、失败或重试均不自动完成或关闭工作项。

## 11. MVP 非目标

- 自动从邮件、会议或聊天创建联系人档案；
- 按关系类型自动修改权限或审批策略；
- 无人确认、无目标预览或无单次审批的自动外发；
- 以手工百分比作为主要进度表达；
- 在首页重建完整 Run records、Approvals 或 Evidence 页面。
