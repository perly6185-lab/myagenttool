# 任务模板、台账记录与离散任务设计

状态：设计完成，待按 P0 → P2 实施

版本：Draft 1.0

日期：2026-08-25

相关设计：

- [任务资料包与隐藏式数据能力需求](TASK_RESOURCE_BUNDLE_REQUIREMENTS.md)
- [Automatic Work Item Execution](AUTOMATIC_WORK_ITEM_EXECUTION.md)
- [MyAgentTool Design Contract](MYAGENTTOOL_DESIGN.md)
- [Local Content and Local AI Integration Design](../engineering/LOCAL_CONTENT_AI_INTEGRATION_DESIGN.md)

## 1. 设计结论

MyAgentTool 应把以下四个概念分开：

1. **用户目标**：用户最终想完成的事情，可以同时包含多个意图。
2. **离散任务**：一次可以独立执行、验收、失败、重做或取消的工作。
3. **任务模板**：完成某一类离散任务的专业方法和输入输出合同。
4. **业务台账**：长期保存业务对象、事实、状态和历史的结构化记录。

台账记录既可以是任务输入，也可以是任务结果的归档或更新目标。任务模板负责声明需要什么“数据角色”，任务实例在创建时再绑定具体台账和具体记录。

```text
用户目标
  └─ 明确表达的一个或多个意图
       └─ 离散任务
            ├─ 匹配一个单任务模板
            ├─ 引用零到多条台账记录作为输入
            ├─ 产生可独立验收的结果
            └─ 新建、更新或关联零到多条台账记录
```

任务模板不得把用户未表达的后续工作隐藏在固定巨型流程中。模板可以包含完成一个任务所需的内部方法步骤，但不能借此偷偷创建、发布或执行其他业务任务。

## 2. 当前能力与缺口

### 2.1 已具备的基础

当前项目已经有以下可复用能力：

- `discrete-task-planner` 能把多意图表达拆成多个任务，并通过 `artifactContract` 和显式依赖连接任务。
- `professional-task-registry` 已将人事、财务、法务、客服、采购、销售、运营、翻译和数据分析建模为独立专业任务。
- Work Item 已包含 `intentStatement`、`taskKind`、`workGoalId`、`artifactContract`、`inputAssets` 和 `localContentRefs`。
- “我的模板”已经支持输入、期望结果、版本、匹配原因、用户纠正和效果治理。
- `ledger-upserts` 已提供台账定义、写入预览、审批、并发保护、审计、批量补偿和安全恢复。
- 任务资料包设计已经规定查询与写入分离、最小授权、数据新鲜度和普通用户隐藏连接器细节。

### 2.2 现阶段主要问题

1. `RoutineDefinition` 可包含 `extract → retrieve → generate → ledger_upsert → create_issue` 等完整例程，容易同时承担任务模板和固定业务流程两种职责。
2. “我的模板”目前主要在一个意图只生成一个任务时绑定；多意图拆分后，不能为每个离散任务分别匹配模板。
3. `inputAssets` 和 `localContentRefs` 可以引用文件或本地知识内容，但没有提供方无关的“台账记录引用”。
4. 当前 `LedgerDefinition` 主要覆盖询价、报价和订单 CSV/XLSX 台账，不足以统一客户、素材、内容、缺陷、版本、合同等业务记录。
5. Work Item 能保存台账写入绑定和预览，但没有统一描述“哪条记录是输入、哪本台账是主归档、哪些台账只是关联”。
6. 台账记录发生变化后，任务缺少统一的版本失效、重新确认和执行快照语义。

## 3. 核心设计原则

### 3.1 一个模板只服务一个可验收结果

任务模板必须满足以下条件：

- 对应一个 `taskKind`；
- 有一个普通用户能理解的主要结果；
- 可以单独执行和验收；
- 不依赖模板内部隐式创建其他任务；
- 对外发送、公开发布、付款、提交审批等动作必须本身就是该任务的明确结果。

例如“文章创作模板”内部可以检索资料、列提纲、起草、检查结构，这些是完成文章任务的内部方法；它不能自动继续生成漫画并发布公众号。

### 3.2 模板绑定数据角色，不绑定具体记录

模板声明“需要一条客户记录”“可参考多条历史报价”，不能写死“客户 A”或某个表格行号。

```text
客户方案模板
  输入角色：客户（必需，单条）
  输入角色：历史方案（可选，多条）
  输出结果：客户方案
  默认归档角色：客户方案台账
  关联角色：客户台账
```

创建真实任务时才解析为：

```text
客户：客户台账 / 客户 A / 版本 12
历史方案：方案台账 / 记录 31、42
结果归档：方案台账 / 新建记录
```

### 3.3 引用与快照并存

任务不能把整条台账记录复制成无法追踪的文本。每个输入绑定同时保存：

- 稳定引用：台账、记录业务键和记录 ID；
- 读取版本：版本号、内容摘要或提供方修订标识；
- 使用范围：本任务实际使用的字段或受限视图；
- 执行快照：运行开始时看到的值摘要和证据指纹；
- 新鲜度：读取时间和是否已经过期。

稳定引用用于回到当前记录，执行快照用于解释“当时为什么得到这个结果”。原始敏感字段仍由任务资料服务按权限读取，不要求全部复制进 Work Item。

### 3.4 一项任务只有一个主台账归属

任务结果最多有一个主台账归属，但可以关联多个其他台账。这样可以避免结果被重复复制，也便于普通用户回答“这个结果最终放在哪里”。

- **主台账**：结果的权威归档位置。
- **关联台账**：只保存引用或活动，不复制完整结果。
- **活动记录**：说明某任务读取、生成、更新或发送了什么。

允许没有主台账的临时任务，也允许用户稍后补充归档。

### 3.5 任务间关系仍由用户意图建立

台账和模板不能自动把离散任务变成固定流程。任务之间只在以下情况下建立依赖：

- 用户在同一次表达中明确要求多个结果；
- 用户明确说“基于刚才的结果继续”；
- 用户启用了经过确认的自动化；
- 某个安全前置条件必须成立。

模板可以显示“下一步建议”，但建议本身不创建任务。

## 4. 领域模型

### 4.1 TaskTemplateDefinition

新增单任务模板合同。第一阶段可以继续以现有 Routine Definition 为持久化载体，但发布为任务模板时必须通过单任务约束校验。

```ts
type TaskTemplateDefinition = {
  id: string;
  familyId: string;
  version: number;
  taskKind: string;
  domain: string;
  name: string;
  outcome: {
    label: string;
    artifactKinds: string[];
    acceptanceCriteria: string[];
  };
  inputSlots: TaskTemplateInputSlot[];
  ledgerRouting: TaskTemplateLedgerRouting;
  method: Array<{
    key: string;
    kind: "extract" | "retrieve" | "generate" | "transform" | "verify";
    label: string;
    required: boolean;
  }>;
  externalEffect: boolean;
  approvalPolicy: "none" | "before_effect" | "before_sensitive_write";
  state: "draft" | "published" | "paused" | "superseded";
};
```

模板的 `method` 只是单个任务内部的方法，不进入普通用户的任务列表，也不能包含创建其他任务或未声明的外部动作。

### 4.2 TaskTemplateInputSlot

```ts
type TaskTemplateInputSlot = {
  key: string;
  label: string;
  sourceKinds: Array<"ledger_record" | "ledger_record_set" | "artifact" | "local_content">;
  recordTypes: string[];
  artifactKinds: string[];
  required: boolean;
  cardinality: "one" | "many";
  freshness: "current" | "execution_snapshot" | "either";
  purpose: "required" | "reference";
};
```

`recordTypes` 使用客户、缺陷、合同、素材、文章、发布记录等业务类型，不使用 Airtable、飞书、CSV 等提供方名称。

### 4.3 LedgerRecordRef

新增通用业务台账记录引用：

```ts
type LedgerRecordRef = {
  ledgerDefinitionId: string;
  recordId: string;
  recordType: string;
  businessKey: string | null;
  title: string;
  revision: string | number | null;
  fingerprint: string;
  observedAt: string;
};
```

`recordId` 是系统稳定标识。提供方的行号、Base ID、路径等放在连接器私有定位信息中，不暴露给普通用户，也不直接交给 Agent。

### 4.4 TaskRecordBinding

Work Item 新增可选的记录绑定：

```ts
type TaskRecordBinding = {
  id: string;
  slotKey: string | null;
  direction: "input" | "output";
  role: "required" | "reference" | "primary_ledger" | "related_ledger";
  record: LedgerRecordRef | null;
  ledgerDefinitionId: string;
  selection: {
    fieldKeys: string[];
    queryId: string | null;
    rowLimit: number | null;
  };
  snapshot: {
    revision: string | number | null;
    fingerprint: string;
    capturedAt: string;
    evidenceRefs: Array<{ artifactId: string; field: string | null }>;
  } | null;
  resolution: {
    source: "explicit_user" | "current_context" | "intent_match" | "template_default";
    confidence: number;
    state: "resolved" | "needs_confirmation" | "stale" | "unavailable";
    reasons: string[];
  };
};
```

输入记录在任务执行前物化为任务资料包中的只读能力。输出绑定先形成归档或变更计划，不代表已经写入。

### 4.5 LedgerPostingPlan

任务结果验证通过后形成台账处理计划：

```ts
type LedgerPostingPlan = {
  workItemId: string;
  resultRevision: number;
  primary: LedgerPostingOperation | null;
  related: LedgerPostingOperation[];
  state: "proposed" | "approved" | "committed" | "partially_committed" | "invalidated" | "cancelled";
};

type LedgerPostingOperation = {
  ledgerDefinitionId: string;
  recordId: string | null;
  action: "create" | "update" | "append_activity" | "link_only";
  fields: Record<string, unknown>;
  sourceEvidence: Array<{ artifactId: string; field: string | null }>;
  approvalRequired: boolean;
};
```

现有 `ledger-upserts` 继续作为文件台账的安全提交实现。后续提供方只需实现相同的预览、版本检查、提交和审计合同。

任务修订或资料快照在提交前发生变化时，仍待审批的计划进入 `invalidated`，旧授权不得继续提交。用户可以沿用原拟写入内容对当前任务修订重新生成差异预览，但必须再次核对并取得新的单次审批；这一步不代表系统已经重新计算业务结果。

### 4.6 与现有 LedgerEntry 的命名边界

`packages/protocol/src/economics.ts` 中的 `LedgerEntry` 是成本和经济核算记录。本设计中的台账是业务台账。代码中应使用 `BusinessLedgerDefinition`、`BusinessLedgerRecordRef` 等明确名称，避免与经济台账混淆。

## 5. 意图到执行的决策流程

```text
1. 理解用户表达
   ↓
2. 拆成一个或多个明确离散任务
   ↓ 每个任务独立处理
3. 匹配一个单任务模板
   ↓
4. 解析用户明确提到、当前正在查看或已选择的记录
   ↓
5. 按模板输入槽补充候选台账记录
   ↓
6. 只对影响结果的歧义提一个普通用户问题
   ↓
7. 固化任务输入引用和执行快照
   ↓
8. 执行并按输出合同验收
   ↓
9. 形成主台账归档和关联台账活动的预览
   ↓
10. 按风险确认并提交，留下来源和回执
```

### 5.1 记录解析优先级

按以下顺序解析输入记录：

1. 用户本次明确选择或点名的记录；
2. 用户正在查看的台账记录；
3. 本次消息引用的任务结果或知识内容；
4. 当前项目、客户、合同或内容上下文中的唯一高置信记录；
5. 模板推荐的台账类型中的候选记录。

系统不得仅因为名称相似就在多个客户、合同或金额记录之间静默选择。

### 5.2 置信度交互

- **高置信**：自动绑定，在创建预览中显示“基于客户 A”。
- **中置信**：给出推荐，用户可以直接创建或修改。
- **低置信且必需**：只问一个结果导向问题，例如“你指的是客户 A 还是客户 A 华东项目？”
- **低置信且可选**：先不绑定，不阻塞任务。

### 5.3 多意图处理

“根据今天的代码写文章、做三张配图并发布公众号”应创建文章、图片、平台适配、草稿保存和发布等离散任务。每个任务分别匹配模板并拥有自己的记录绑定；上游结果通过产物引用成为下游输入，而不是共享一个巨型模板实例。

## 6. 普通用户体验

### 6.1 任务输入区

用户仍只需描述要做什么。系统在任务预览中使用两组简短信息：

- **基于**：客户 A、合同 2026-018、今天的编码记录；
- **完成后记录到**：客户方案台账。

默认不显示记录 ID、字段映射、查询表达式、模板版本或连接器名称。

### 6.2 从台账记录发起任务

每条记录提供“基于这条记录做事”。点击后打开普通任务输入框，并自动带入当前记录上下文。用户可以说：

- “给这个客户做一份续费方案”；
- “根据这条缺陷记录修复并测试”；
- “把这篇素材改写成口播稿”。

### 6.3 任务创建预览

普通用户看到：

```text
准备做：为客户 A 制作续费方案
将使用：客户 A、最近两次报价
预计得到：一份可审核的续费方案
完成后：记录到客户方案台账，并更新客户跟进动态
```

模板名称只作为次要提示“按你常用的客户方案方式处理”。用户可以展开专业视图检查匹配原因和数据范围。

### 6.4 任务完成反馈

结果页明确区分：

- 结果已生成；
- 已记录到哪个主台账；
- 关联了哪些业务记录；
- 哪些变更仍等待确认；
- 输入记录在执行后是否发生变化。

不使用“ledger upsert”“routine run”“business key”等术语。

### 6.5 专业视图

专业视图可以显示：

- 模板 family、版本和匹配依据；
- 输入槽到具体记录的绑定；
- 读取字段、查询范围、快照和新鲜度；
- 结果到台账字段的映射；
- 变更预览、审批、提交回执和审计；
- 任务间显式产物依赖。

## 7. 模板发布约束

模板发布前增加以下校验：

1. 必须声明唯一 `taskKind` 和主要结果。
2. 主要结果必须可以独立验收。
3. 输入槽和输出归档角色必须使用业务类型。
4. 一个模板不得包含多个对外业务结果。
5. `create_issue` 不得作为普通单任务模板的内部步骤。
6. `ledger_upsert` 迁移为 `ledgerRouting` 和结果后的 Posting Plan，不得与内容生成混成不可取消的原子流程。
7. 对外动作模板必须声明 `externalEffect=true` 和批准策略。
8. 模板步骤不得产生未声明的新任务。

旧 Business Routine 可以继续作为已确认自动化运行，但不再直接等同于普通用户的任务模板。普通界面的“我的模板”只展示满足单任务约束的定义；多任务 Routine 在专业视图中显示为“自动化方案”。

## 8. 兼容与迁移

### 8.1 Work Item

新增字段全部可选，旧任务保持可读：

- `taskTemplateBindingV2`；
- `recordBindings`；
- `ledgerPostingPlanId`。

现有 `myTemplateBinding` 继续读取，并在绑定单任务模板时生成 V2 快照。`inputAssets` 和 `localContentRefs` 保持现有执行路径，逐步作为统一任务资源引用的一种来源。

### 8.2 Routine Definition

- 通过发布校验的单结果定义可投影为 `TaskTemplateDefinition`。
- 包含多个业务结果或 `create_issue` 的定义标记为 `automation_recipe`，不参与单任务自动匹配。
- 现有运行记录和审计记录不改写。

### 8.3 Ledger Definition

P0 不替换现有文件台账实现，而是在其上增加通用记录读取合同。现有询价、报价和订单台账首先适配为三种业务台账类型；后续再扩展客户、素材、内容、缺陷、版本等类型。

### 8.4 失败与恢复

- 输入记录不存在：任务进入“需要补充资料”，不回退到猜测。
- 输入记录版本变化：标记过期，低风险可刷新快照，高风险要求重新确认。
- 主台账不可写：结果仍安全保留，归档操作可单独重试。
- 关联台账部分失败：主结果不回滚，显示未完成关联并支持幂等重试。
- 多台账写入：沿用现有批量预览、日志和补偿能力。

## 9. P0 → P2 开发计划

### P0：统一引用和单任务模板边界

目标：一条台账记录可以安全成为一个离散任务的输入，任务结果可以明确归属一个主台账。

1. 在 protocol 增加 `BusinessLedgerRecordRef`、`TaskRecordBinding`、`TaskTemplateContractV2` 和 `LedgerPostingPlan`。
2. 为现有 Ledger Definition 增加按业务键读取单条记录、返回稳定引用和版本指纹的只读服务。
3. Work Item 支持保存、校验和展示记录绑定；执行前写入任务资料清单和快照。
4. 模板匹配从“整个意图计划一次匹配”调整为“每个离散任务分别匹配一次”。
5. 增加单任务模板发布校验，并将不合格 Routine 分类为自动化方案。
6. 首页任务预览显示“基于”和“完成后记录到”，任务详情显示“使用了”和“已记录到”。
7. 台账记录详情提供“基于这条记录做事”。
8. 结果完成后形成归档预览；敏感更新继续要求批准。

P0 首批覆盖：客户记录 → 客户方案、素材记录 → 文章、缺陷记录 → 软件修复。

### P1：自动整理和多台账关联

目标：普通用户大多数时候无需手动选择台账，同时可以自然纠正。

1. 增加台账类型、实体、业务键和当前界面的上下文解析。
2. 支持多条记录和受限查询快照作为任务输入。
3. 根据 `taskKind + artifactKind + entity` 推荐主台账和关联台账。
4. 支持自然语言纠正：“记到客户 A，不是客户 B”“这次不要更新发布台账”。
5. 记录纠正证据，在同项目、同任务类型和同数据角色中学习，不跨范围泛化。
6. 通知中心增加“结果已生成但尚未归档”和“台账记录已变化，需要确认”。
7. 增加内容生产、平台发布、合同审查、销售跟进和版本发布的台账类型。

### P2：专业治理、模板学习和跨台账工作

目标：支持公司级多专业任务，同时保持普通视图简单。

1. 从成功任务学习 Task Template V2 的输入槽、结果合同和台账路由，不学习隐藏巨型流程。
2. 支持跨台账只读关联查询和聚合任务，例如按客户汇总合同、报价和跟进记录。
3. 提供专业台账模板与字段治理，但仍隐藏连接器协议。
4. 将多任务 Routine 正式升级为可选“自动化方案”，逐项展示将创建的离散任务并单独保留审批。
5. 增加模板、记录绑定、归档准确性和用户纠正率评测集。
6. 支持提供方无关的远程业务记录适配器，并统一预览、版本冲突和撤销合同。

## 10. 验收场景

### 10.1 普通用户主路径

1. 用户在客户 A 记录上说“做一份续费方案”。系统只创建一个方案任务，自动显示客户 A 为输入和方案台账为归档目标。
2. 用户选择素材记录说“写成一篇 1500 字文章”。系统使用文章模板，不创建下载、漫画或发布任务。
3. 用户选择缺陷记录说“修复并测试”。系统创建软件实现和软件验证两个离散任务，分别匹配模板，并用实现结果连接测试任务。
4. 用户说“把今天编码整理成文章和三张图”。系统创建编码整理、文章和图片任务，每项拥有自己的模板和台账归属。
5. 用户只说“根据客户 A 做方案”，但存在两个同名客户时，系统先询问一次，不静默选择。

### 10.2 数据正确性

1. 任务可以从台账记录回到原始记录，并能证明执行时读取的版本。
2. 原记录在执行前发生变化时，系统不会继续使用已过期的高风险字段。
3. 一个结果只有一个主归档，不因关联多个台账产生多份互相漂移的副本。
4. 台账提交失败不丢失任务结果，重试不重复新增记录。
5. 每次创建、更新、关联和批准都能追溯到任务、结果版本、模板版本和输入证据。

### 10.3 模板与意图边界

1. 一个离散任务最多自动绑定一个主要任务模板。
2. 多意图表达中的每个任务分别匹配模板。
3. 模板内部方法不会出现在任务列表，也不会产生未声明外部动作。
4. “下一步建议”不会自动创建任务，除非用户确认或存在已启用自动化。
5. 用户跳过模板后，任务仍可按通用能力执行。

## 11. 质量指标

P0 上线时至少记录以下指标：

- 必需输入记录正确绑定率；
- 主台账归属正确率；
- 因记录歧义产生的澄清率；
- 用户更换输入记录或归档目标的纠正率；
- 过期记录在执行前被拦截的比例；
- 台账提交成功率、幂等重试率和部分失败率；
- 多意图拆分后模板逐任务匹配准确率；
- 未经明确意图创建额外任务或外部动作的数量，目标必须为零。

离线评测至少覆盖自媒体、软件开发、商务助理、人事、财务、法务、客服、采购、销售、运营、翻译和数据分析。每个专业同时包含：明确记录、同名歧义、多记录输入、记录过期、模板不匹配和多意图拆分样例。

## 12. 明确不做的事情

- 不把每本台账做成独立任务系统。
- 不要求普通用户先学习字段、模板、连接器或工作流再创建任务。
- 不默认把整个台账交给模型读取。
- 不因模板建议而创建用户没有表达的任务。
- 不把一次内容生成和一次对外发布合并成同一个模板。
- 不在任务结果尚未验收时直接改写权威业务记录。
- 不用任务依赖图替代人的不确定决策和后续意图。
