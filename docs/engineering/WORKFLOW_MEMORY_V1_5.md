# Workflow Memory V1.5 真实商务闭环

V1.5 把 V1.4 已验证的商务 Routine 从固定夹具推进到受控真实目录试运行。范围仍是本地优先、证据驱动和人工治理：系统不会扫描整台电脑，不会把文档中的指令当成系统指令，不会静默覆盖文件，也不会自动发送报价。

关联工作：

- Epic：[#1561](https://github.com/perly6185-lab/myagenttool/issues/1561)
- 受治理执行器：[#1562](https://github.com/perly6185-lab/myagenttool/issues/1562)
- 报价模板与缺失信息：[#1563](https://github.com/perly6185-lab/myagenttool/issues/1563)
- 增量询价接入：[#1564](https://github.com/perly6185-lab/myagenttool/issues/1564)
- 多询价并发与台账串行：[#1565](https://github.com/perly6185-lab/myagenttool/issues/1565)
- 真实试运行与发布门禁：[#1566](https://github.com/perly6185-lab/myagenttool/issues/1566)
- 试运行操作与回滚：
  [WORKFLOW_MEMORY_V1_5_PILOT.md](WORKFLOW_MEMORY_V1_5_PILOT.md)

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

## 阶段 3A：稳定增量接入基础

历史目录的首次授权扫描继续建立基线；后续新文件通过独立的增量接入检查进入持久化稳定观察，不会改变已有历史扫描语义。

```text
POST /api/workflow-memory/sources/{sourceId}/scan-intake
GET  /api/workflow-memory/intake-observations?sourceId={sourceId}
```

- 增量接入只遍历当前租户明确授权且仍处于 active 的来源，继续应用扩展名、临时文件、秘密文件、深度和数量上限。
- 新文件或变化文件至少经过两次一致观察，并跨越稳定窗口；读取前后大小、修改时间或状态变化时重新等待。
- 路径敏感指纹继续用于证据漂移判断；授权内容读取模式下另存路径无关内容身份，用于副本、移动和改名去重。
- metadata 模式不会为了去重读取文件正文，只能使用文件系统元数据身份；无法证明相同的副本不会被静默合并。
- 观察状态、稳定时间、接入游标和后续触发收据使用现有本地持久化保存；公开观察结果不返回内部签名或内容身份。
- 相同内容副本指向原 Artifact；原路径消失后的同内容新路径被视为移动并沿用 Artifact 身份。
- 超大文件、文件消失、来源撤销、符号链接、目录逃逸和跨租户访问失败关闭，且不会删除或改写用户文件。

## 阶段 3B：确认后生成询价任务

“新询价接收”把稳定观察接到已发布的商务 Routine，但不会自动执行文件推断。普通用户在已授权来源上点击一次“检查新询价”，界面会完成稳定窗口复查；只有打开确认框、核对关键字段、选择工作流并显式确认后，系统才创建本地任务。

```text
POST /api/workflow-memory/intake-observations/{observationId}/inspect
POST /api/workflow-memory/intake-observations/{observationId}/accept
```

- 检查只展示当前文件的识别类型、字段证据和可用的已发布询价 Routine，不创建 Business Case 或 Issue。
- 接受请求必须携带观察修订、用户确认、Routine 标识和调用方幂等键；询价编号缺失时保持在确认框中补充，不自动猜测业务身份。
- 确认时再次校验磁盘文件的内部签名和内容身份；文件在稳定扫描后又发生变化时退回等待稳定，不使用过期证据。
- metadata 来源不能确认询价正文；需改为受控文本读取后再处理。
- 相同业务编号指向不同证据时进入人工核对，不静默合并，也不创建第二个任务。
- 确认后依次形成已确认 Business Entity、Business Case、固定 Routine 版本的本地 Issue 和触发收据。
- 请求重放、服务在创建 Issue 后但写收据前中断、文件移动或改名，都会通过下游幂等身份和内容收据收敛到原任务。
- 公开观察和收据只返回相对路径、业务编号、Routine 版本及本地任务引用；不暴露绝对路径、内容哈希或请求哈希。
- 来源撤销、证据排除/消失、Routine 停用、跨租户访问和过期修订均在创建任务前失败关闭。

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
- 稳定接入与显式确认触发已形成端到端闭环，但当前只面向 `inquiry` 文档和已发布的询价 Routine。
- 多询价并发和台账串行已由 #1565 完成。扩大灰度前仍须使用 #1566 的正式
  试运行门禁验证至少十个经授权真实或脱敏案例；仓库内十案例仅是合成演练，
  不计入真实准确率。

## 阶段 5：真实试运行与发布门禁

阶段 5 增加严格的试运行清单、聚合指标和 Go/No-Go 报告：

- `synthetic`、`deidentified` 和 `real` 数据明确区分；只有后两类且授权信息完整
  时才计入正式案例。
- 清单只接受固定字段，不允许携带原文、绝对路径、Prompt、Secret 或文件哈希。
- 报告角色 Top-1、关系 Top-1/Top-5、未知覆盖、纠正率、完成率、重复数、
  审批覆盖、恢复和安全结果。
- 合成演练进入免费 CI 门禁，但即使全绿仍输出正式 `NO_GO`；正式命令必须显式
  指向本地授权清单。
- 正式发布要求至少十案例、角色 Top-1 ≥80%、关系 Top-1 ≥75%、零强制未知
  猜测、零重复写入、100% 修改审批，以及安全和恢复场景全部通过。

```bash
pnpm eval:commercial-pilot:rehearsal

WORKFLOW_MEMORY_PILOT_MANIFEST=/local/path/pilot-manifest.json \
pnpm eval:commercial-pilot -- \
  --out-json .myagenttool/pilot-reports/v1.5.json \
  --out-md .myagenttool/pilot-reports/v1.5.md
```
