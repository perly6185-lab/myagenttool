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

## 阶段 2：已确认模板与关键事实门禁

新发现的报价步骤使用 `local.confirmed-template-quotation.v2`。第一次执行只检查关键事实和模板，不写文件；价格、币种、税率、数量、交期或模板存在缺失/冲突时，步骤保持可继续状态，并在“日常工作”中显示普通业务语言的问题。

```text
POST /api/workflow-memory/routine-work-items/{workItemId}/steps/{stepKey}/quotation-inputs
```

- 每个事实显示标准值、缺失/冲突状态、来源摘要和有界 Artifact 证据。
- 用户补充值和模板选择必须显式确认；确认记录绑定用户、时间、步骤修订和幂等请求内容。
- 模板必须来自当前租户、项目和授权来源，且绑定当前 Artifact 指纹。文件变化、来源撤销或重新扫描后的指纹漂移会阻止生成。
- 支持的 Markdown 模板使用 `{{field_name}}` 占位符。主动 HTML、JavaScript、远程 Markdown 图片、动态链接目标、符号链接、越界路径和超大模板失败关闭。
- DOCX/XLSX 模板会显示为暂不可用；只有后续接入格式保存性校验后才能启用，当前不会把降级输出伪装成成功。
- 输出路径在写入前可见，包含 Routine 版本和草稿版本；同名不同内容绝不覆盖。
- 报价审批框显示生成文件、草稿正文、确认模板、字段值和来源。退回不会登记、发送或创建后续订单工作。

## 本地输出边界

- v1 基线生成器继续兼容已有已发布 Routine；v2 只从用户确认的 Markdown 模板生成草稿。
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

- Markdown 模板已进入受治理试运行，但 DOCX/XLSX 保存性生成仍未启用。
- 关键事实由已确认记录、当前文档证据和用户补充组成；不会自动推测缺失价格或商业条款。
- V1.5 扩大灰度前，仍须完成 #1564–#1566，并通过真实或脱敏案例门禁。
