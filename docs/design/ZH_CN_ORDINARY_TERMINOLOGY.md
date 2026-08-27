# zh-CN 普通用户术语表

本表约束首页、引导配置、移动端主导航、待办、我的和通知中心。主界面先说明用户要做什么；内部模型名只出现在折叠的技术详情或排障提示中。

| 内部概念 | 普通用户显示词 | 可选技术详情 | 使用规则 |
| --- | --- | --- | --- |
| Agent | 任务助手 | Agent | 只把 `Agent` 用作技术类型；Codex、Claude 和用户命名保持原样。 |
| Application | 应用 | Application | 应用及提供方名称保持原样。 |
| Channel | 消息渠道 | Channel | 企业微信等提供方或协议名称保持原样。 |
| Desktop Bridge | 电脑连接程序 | Desktop Bridge | 普通状态使用“这台电脑已连接/离线”。 |
| Issue | 工作事项 | GitHub Issue | `#1538` 等外部编号保持原样。 |
| PR | 合并请求 | Pull Request（PR） | GitHub 标题和用户内容不改写。 |
| Worktree | 隔离工作区 | Git worktree | 分支名和路径只在展开详情后显示。 |
| Invocation | 任务运行 | Invocation ID | 动作使用“运行”，标识使用“任务运行编号”。 |
| Trace | 运行记录 | Trace ID | 导航使用“运行记录”，技术详情可显示追踪编号。 |
| Transport status | 连接状态 / 更新方式 | transport state | 分别显示服务器、执行电脑和实时/定时更新，不暴露协议状态。 |
| Local content record | 资料 | content record | 主界面按标题和来源识别；“内容记录”只用于技术详情。 |
| Local Library | 我的资料 | Local Library | 一级导航和页面标题统一使用“我的资料”，不使用“本地资料库”作为主标题。 |
| Knowledge collection | 专题 | collection ID | 表示一个逻辑分组；加入专题不移动或复制原件。内部代码可继续使用 collection。 |
| Retrieval scope | 从哪里找 / 正在参考 | retrieval scope | 始终显示“全部资料 / 当前专题 / 已选资料”之一，不把“范围”作为必学概念。 |
| Citation | 引用来源 / 查看原文 | citation | 回答正文可用编号引用，动作统一使用“查看原文”。 |
| Managed original | 保存到本机的资料 | managed original | 必须说明可导出；不向普通用户展示应用数据目录。 |
| Referenced original | 原件仍在原位置 | referenced original | 添加已有文件或文件夹时明确未复制、未移动。 |
| Review digest | 资料回顾 | review digest | 默认由用户主动打开；通知必须另行开启并可关闭。 |
| Material work session | 资料工作会话 | material work session | 页面标题使用用户目的，例如“比较两份报价”，不把“会话”作为主标题。 |
| Action proposal | 下一步预案 | action proposal | 表示 AI 已准备但尚未执行的动作，必须说明“确认后才会执行”。 |
| Retained outcome | 保存的结果 | retained outcome | 动作使用“保存这份结果”，不使用“物化”或“成果对象”。 |
| Channel material capture | 保存资料 | knowledge capture | Channel 回复使用“正在保存到我的资料”；该过程不是任务，不显示任务编号或队列位置。 |
| Channel consultation | 先看看 / 帮我总结 | consultation invocation | 只读回答不显示“创建运行”；需要持续推进时再显示“创建任务”。 |

## 动作用词

| 意图 | 统一文案 |
| --- | --- |
| 开始任务 | 在此电脑上运行 / 开始执行 |
| 等待本机 | 排队等待此电脑 |
| 审批名词 | 审批 / 待审批 |
| 同意动作 | 批准；需要继续时使用“批准并继续” |
| 拒绝动作 | 拒绝 |
| 取消运行 | 取消任务 |
| 重试 | 重试；可能再次触发审批时使用“安全重试” |
| 永久删除 | 删除，并在确认说明中写清对象、范围和不可恢复性 |
| 添加资料 | 添加资料 |
| 对资料提问 | 问问这些资料 |
| 将回答转为任务 | 创建任务 |
| 查看回答来源 | 查看原文 |
| 加入逻辑专题 | 加入专题 |
| 继续使用结果 | 接着处理 |
| 保存 AI 结果 | 保存这份结果 |
| 索引维护 | 重新检查资料；仅在技术详情使用“重建索引” |

## 内容边界

- 不翻译用户输入、任务标题、分支名、路径、错误原文或任务助手生成的内容。
- 不翻译 Codex、Claude、GitHub、MCP、企业微信等产品、提供方或协议专名。
- 原始枚举值和内部标识只能出现在折叠的“技术详情”或排障界面。
- 新的普通用户文案应优先复用本表；全站资源完整性仍由 #1466 和 #1482 负责。
- “删除专题”“删除问答记录”“删除索引”和“删除原件”必须使用不同确认文案，不得互相暗示。
- AI 回答必须把“资料直接支持”“AI 推断”“资料存在冲突”和“资料不足”显示为不同状态。
