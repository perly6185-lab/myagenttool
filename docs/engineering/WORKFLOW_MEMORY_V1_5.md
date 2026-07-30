# Workflow Memory V1.5 真实商务闭环

V1.5 把 V1.4 已验证的商务 Routine 从固定夹具推进到受控真实目录试运行。范围仍是本地优先、证据驱动和人工治理：系统不会扫描整台电脑，不会把文档中的指令当成系统指令，不会静默覆盖文件，也不会自动发送报价。

关联工作：

- Epic：[#1561](https://github.com/perly6185-lab/myagenttool/issues/1561)
- 受治理执行器：[#1562](https://github.com/perly6185-lab/myagenttool/issues/1562)
- 报价模板与缺失信息：[#1563](https://github.com/perly6185-lab/myagenttool/issues/1563)
- 增量询价接入：[#1564](https://github.com/perly6185-lab/myagenttool/issues/1564)
- 多询价并发与台账串行：[#1565](https://github.com/perly6185-lab/myagenttool/issues/1565)
- 真实试运行与发布门禁：[#1566](https://github.com/perly6185-lab/myagenttool/issues/1566)

## 阶段 1：受治理 Routine 执行器

V1.4 的 Routine 状态机允许 `retrieve`、`generate` 和 `create_issue` 步骤进入运行状态，但需要调用方手工报告完成。V1.5 阶段 1 为这三类步骤增加固定、可审核的本地执行器：

| 步骤 | 执行器 | 行为 |
| --- | --- | --- |
| `retrieve` | `local.reference-retrieval.v1` | 从当前授权来源和已确认业务案例中选择最多 20 个仍然有效的参考资料，只返回有界 Artifact 引用。 |
| `generate` | `local.markdown-quotation-draft.v1` | 用已确认业务字段生成本地 Markdown 报价草稿；文件名绑定 Routine 版本和运行，使用独占写入，绝不覆盖不同内容。 |
| `create_issue` | `local.confirmed-order-issue.v1` | 仅在当前业务案例含有已确认且指纹未变化的订单证据时创建或复用一个订单子 Issue。 |

执行接口：

```text
POST /api/workflow-memory/routine-work-items/{workItemId}/steps/{stepKey}/execute
```

请求必须提供当前 Routine 修订号和调用方生成的幂等键。执行成功或业务执行失败都会更新可恢复的步骤状态；过期修订、来源撤销、租户不匹配和不受信任的执行器标识在执行前拒绝。

## 本地输出边界

- 基线生成器只写 Markdown 草稿。用户确认模板、DOCX/XLSX 输出和缺失字段对话由 #1563 扩展。
- 默认目录为授权来源下的 `outputs/quotations`，发布的 Routine 可配置另一个来源内相对目录。
- 目录逐级检查，不跟随符号链接；绝对路径、`..`、目录逃逸和目标冲突都会失败。
- 文件使用独占、禁止跟随链接的创建方式。相同运行重试只在已有内容完全相同时复用，内容不同则报告冲突。
- 草稿只使用已确认业务实体和字段建议，不复制原始文档全文，也不执行文档里的 Prompt、公式或命令。
- 草稿明确标记为待审核；报价审批、台账登记和任何外部发送仍是不同的人工治理动作。

## 并发、幂等与恢复

- 检索继续使用现有设备并发上限；台账写入继续使用已有的预览、锁和修订门禁。
- 每个步骤、输出和子 Issue 使用不包含业务原文的稳定幂等标识。
- 服务在步骤运行中中断后，将步骤恢复为明确失败状态；用户从该步骤重试。
- 报价文件已经落盘但状态提交中断时，相同运行会校验并复用完全相同的文件，不会再生成一份。
- 订单条件和订单执行器共享同一子 Issue 幂等身份，重复点击只返回原任务。

## 当前限制

- Markdown 草稿是结构化执行证明，不等同于企业正式报价模板。
- 价格、税率、交期等关键事实的完整性门禁和询问对话尚未在本阶段启用。
- V1.5 扩大灰度前，必须完成 #1563–#1566，并通过真实或脱敏案例门禁。
