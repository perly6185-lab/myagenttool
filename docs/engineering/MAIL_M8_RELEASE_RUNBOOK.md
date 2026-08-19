# M8 邮箱发布与 7 天试运行手册

状态：M8B、M8C、M8D-1 和 M8D-2 已实现；M8D-3 等待真实测试账号完成连续 7 个自然日。

## 发布前单一门禁

运行：

```powershell
pnpm release:mail
```

该命令固定执行中文 200 条、英文 200 条、提示注入 50 条的合成评测，并验证数据集 SHA-256 指纹、版本化基线 `tools/dev/fixtures/mail-classifier-baseline-v1.json`、分类精确率/召回率、未知率、注入安全降级、吞吐、查询索引性能、租户隔离、重复移动、超时、重启和无副作用试运行。命令已加入 CI `eval-gates`，任一门槛失败都会非零退出。

固定门槛：待处理精确率不低于 90%、召回率不低于 80%、订阅精确率不低于 95%、未知率不高于 35%、50 条注入样例安全降级率 100%，确定性邮件头分类吞吐不低于每秒 10,000 封。

## 三级开放与回退

三个阶段必须按顺序开放，自动整理默认关闭：

1. 只读智能分类：`MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED=1`。紧急回退设为 `0`，普通收件箱仍可读取。
2. 手动邮箱目录：`MYAGENTTOOL_MAIL_ORGANIZE_MANUAL_ENABLED=1`。只允许用户查看完整批次并逐次确认。
3. 自动整理：`MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ENABLED=1`，并用 `MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ACCOUNTS=测试账号应用ID` 限定账号。该级依赖前两级；任一前级关闭时自动失败关闭。

回退时只关闭对应开关并重启本地服务，不删除历史作业或审计记录。自动整理暂停后，必须先同步核对；系统不会在启动或恢复时自动补移动。

## 启动 7 天试运行

试运行文件默认保存在已被 Git 忽略的 `.myagenttool/mail-rollout-pilot.json`，只保存账号别名、日期、阶段和聚合计数，不保存邮件主题、地址、正文、附件名或消息标识。

先使用不敏感的测试账号别名初始化：

```powershell
pnpm mail:pilot:start -- --account test-mail-a --timezone Asia/Shanghai
```

每天结束后只记录当天一次。示例：

```powershell
pnpm mail:pilot:record -- --phase readonly --scenarios offline --sync-runs 5
pnpm mail:pilot:record -- --phase manual --scenarios credential_expired,restart --sync-runs 5 --move-batches 2
pnpm mail:pilot:record -- --phase automatic --scenarios conflict --sync-runs 5 --move-batches 3
pnpm mail:pilot:status
```

需要补录已经结束的自然日时增加 `--at 2026-08-18T20:00:00+08:00`。开始时间始终取本机当前时间，不能覆盖；记录不得早于开始日，也不得填写当天或未来日期。阶段只能从 `readonly` 前进到 `manual`，再前进到 `automatic`，不能倒退；同一试运行时区的自然日不能覆盖。

每天还应核对并按实际值传入以下参数；默认值为零：

- `--duplicate-moves`：确认发生的重复移动数；
- `--cross-tenant-writes`：跨租户写入数；
- `--unreconciled-jobs`：当日结束仍无法核对的作业数；
- `--recovery-failures`：无法从产品恢复流程处理的异常数。

## 完成条件

`pnpm mail:pilot:status` 仅在以下条件全部满足时输出 `passed: true`：

- 至少 7 个连续自然日；
- 三个开放阶段都留下记录，且顺序没有倒退；
- 断网、凭据失效、重启、冲突四种演练全部覆盖；
- 重复移动、跨租户写入、未核对作业和恢复失败全部为零。

任何安全计数非零都不得发布。修复后使用新的证据文件重新开始 7 天计时，旧文件保留用于复盘；合成测试或一次性演练不能替代真实连续运行。
