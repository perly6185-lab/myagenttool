# Channel P4 生产发布与故障处理手册

本手册覆盖微信 ClawBot / iLink 频道从灰度到生产的稳定性检查。频道使用已有的单一正式任务队列；Bridge 意图识别只是可选的预检，失败时自动回到本地确定性识别。

## 发布前检查

1. 启动服务并确认 `wechat_ilink` 频道处于 `enabled`，账户状态为 `connected`。
2. 用普通用户依次发送：文本、图片、语音、文件；确认都能出现在同一任务线程中。
3. 连续发送两条不同任务，确认第二条显示“前面还有 N 个任务”，且不会重复创建。
4. 对排队任务发送“暂停”，再发送“继续”；运行中的任务应明确提示不能安全暂停。
5. 完成一个任务后发送“重发结果”，确认文本和输出媒体都重新进入出站投递队列。
6. 断开网络后恢复，确认出站消息进入自动重试，服务重启后 `queued`、`retrying` 和 `sending` 投递能够恢复。

## Bridge 意图识别

默认关闭。开启时使用：

```env
MYAGENTTOOL_CHANNEL_INTENT_ENABLED=1
MYAGENTTOOL_CHANNEL_INTENT_AGENT_ID=agt_codex_cli
MYAGENTTOOL_CHANNEL_INTENT_TIMEOUT_MS=8000
MYAGENTTOOL_CHANNEL_INTENT_FAILURE_THRESHOLD=3
MYAGENTTOOL_CHANNEL_INTENT_COOLDOWN_MS=30000
```

连续失败达到阈值后会打开熔断器，在冷却期内直接使用本地规则，不会创建额外任务队列。控制命令（确认、取消、暂停、继续、重试、重发）始终优先走本地解析。

## 常见故障

### 微信显示未连接

检查控制台频道状态、iLink 账户的 `lastError` 和 `nextRetryAt`。若为 `reauth_required`，重新扫码登录；不要删除任务或投递记录。

### 任务已完成但微信没收到

在频道任务时间线查看“消息”状态。`retrying` 会自动重试；`failed_terminal` 可在控制台点击“重试发送”，或从微信回复“重发结果”。

### Bridge 意图识别持续失败

查看控制台 Bridge 统计中的失败、超时和熔断状态。先保持本地降级运行；确认 Bridge Agent、设备连接和授权状态后，再等待冷却期自动恢复。

### 重启后任务状态异常

先查看任务线程的“进展”和“下一步”，再检查任务投递记录。系统启动时会重建线程投递快照，并把崩溃遗留的 `sending` 记录重新置为 `retrying`。

## 验收命令

```bash
pnpm --dir apps/server lint
pnpm --dir apps/server test
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
```

真实微信验收必须使用测试账号和测试项目，确认文本、图片、语音、文件、长任务、多轮补充、暂停/继续、重发结果和重启恢复后，再进入灰度发布。
