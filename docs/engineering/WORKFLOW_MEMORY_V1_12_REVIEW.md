# Workflow Memory V1.12 发布审核记录

审核范围：岗位助手、目录监控、Issue 成果回流、纠错学习、影子评测、发布评审、
规则发布与回滚，以及同一工作区内的 V1.6 正式试运行增强。

## 审核结论

代码审核未保留阻断项。候选版本可以进入提交、合并和授权目录观察模式灰度；不能因为
自动化回归通过而直接启用执行模式。

## 审核发现与处置

| 严重度 | 发现 | 处置 | 回归证据 |
| --- | --- | --- | --- |
| 高 | 三次都选择“都不合适”仍可能通过影子门禁 | 候选必须同时胜过当前结果和“都不合适”票数 | `shadow gate rejects a candidate when every reviewer prefers neither result` |
| 高 | 发布后的类型映射没有应用到实际建议，只应用了动作 | 活动规则先解析受治理类型映射，再选择目标类型动作；回滚恢复旧类型 | 服务测试和真实浏览器发布/回滚闭环 |
| 中 | 类型未变化、步骤未变化或无关原因可以夹带纠正 | 服务端拒绝无实质变化或原因不匹配的纠正证据 | `learning requires representative evidence and rejects unsafe corrections` |
| 中 | 改变文件类型时仍默认保留旧类型动作 | UI 自动带出新类型的标准步骤，修改后重新要求确认 | `records explicit usefulness feedback` |
| 中 | 批量状态变更和外部 Issue 拉取未即时投影 Outcome | 为批量更新、远端冲突选择和远端拉取补充变更回调 | `projects work-item status and verification changes immediately` |
| 低 | 发布评审直接显示内部英文原因代码 | 中文和英文 UI 显示普通用户可理解的门禁说明 | Adaptive Workbench 组件回归 |

## 权限与安全检查

- 来源、策略、反馈、Outcome、草稿、规则和通知均按 team、项目和来源隔离。
- Policy、Monitor、学习草稿、发布和回滚只允许 owner/admin 管理。
- 纠正、影子偏好、执行模式、监控、发布和回滚均有明确确认门槛。
- 发布评审绑定草稿 revision、评测内容、配置和活动规则，旧指纹不能发布。
- 自动能力限定为本地 Issue，不包含外发、覆盖文件或修改来源资料。
- 后台目录监控有全局并发上限、同来源互斥、失败退避和中断恢复。
- `docs/imported/` 未纳入提交范围，也未读取或修改其中内容。

## 回归结果

2026-08-01 本地审核结果：

- Server：2292 个单元测试通过。
- Server Integration：174 个集成测试通过。
- Web：101 个测试文件、486 项测试通过。
- TypeScript：`tsc --noEmit` 通过。
- Browser：Chromium 真实 HTTP 服务 5 个场景通过，完整学习闭环使用 390×844 移动端视口。
- Patch：`git diff --check` 通过。

仓库的 `docs:check` 脚本依赖 PowerShell；当前 macOS 环境未安装 `pwsh`，因此该脚本未能
执行。V1.12 新增文档不包含外部链接或相对文件链接，未产生待解析的 Markdown 链接。

## 灰度限制

合并后只允许对资料所有者明确授权的单一业务子目录启用观察模式。没有授权目录、人工
期望结果或删除方案时，灰度保持未开始。观察样本不足、候选未明确胜出、采纳率或完成率
不达标时，不进入协助/执行模式。
