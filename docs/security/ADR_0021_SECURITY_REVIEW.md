# ADR 0021 实现安全评审

日期：2026-07-27
范围：ADR 0021 的 I1–I7 基础层
结论：**有条件通过身份、会话、恢复与供应商一致性测试基础；真实企业身份提供方上线继续阻断**

这不是 Security、Product、Platform owner 对 ADR 的正式批准，也不授权
企业微信、飞书、钉钉适配器或真实二维码上线。

## 已关闭的高风险项

| 风险 | 控制与证据 |
| --- | --- |
| 浏览器长期 Bearer | Web 客户端不再把会话 token 写入 localStorage；服务端仅持久化 opaque session 的 SHA-256 hash。 |
| 会话窃取与跨站写入 | Session 使用 HttpOnly、SameSite=Lax Cookie；生产策略增加 Secure；所有 Cookie 认证的受保护写请求校验独立 CSRF secret。 |
| 隐式本地 owner | 开启认证后，`MYAGENT_LOCAL_MODE=1` 才允许本地登录；匿名 actor 使用 `anonymous` 权限并由全局 gate 拒绝。 |
| 会话无限存活 | 30 分钟 idle、12 小时 absolute 上限；当前设备撤销和 user session epoch 全设备撤销已进入服务层。 |
| 挑战泄露或重放 | 256-bit 浏览器 binding、provider/device 绑定、120 秒过期、hash-only 持久化、单次 `authorized -> consumed` 以及 replay audit。 |
| 提供方越权 | Provider 输出只规范化外部身份事实；adapter 输入中的本地 user/team/role 字段被丢弃。 |
| 配置即误上线 | `/api/identity/options` 只公开“已配置且已注册”的 adapter；当前注册表为空，所以任何企业提供方都不可用。 |
| 回调注入与 provider mix-up | 共享核心按事务生成 state、PKCE S256 和 nonce，严格绑定 HTTPS 授权源、issuer 与 redirect URI；授权码先按哈希全局保留再交换，超时可中止，失败只返回统一错误和闭集审计原因。 |
| 供应商故障扩大 | 企业微信、飞书、钉钉分别具备独立 kill switch；关闭后不会被能力发现，新事务和在途回调都 fail-closed，且不会隐式开启本地或密码入口。 |
| 密码枚举与在线猜测 | 密码登录必须同时提交 teamId 与 userId；失败预算按两者的哈希隔离，第三次起渐进延迟、第五次产生团队安全告警，所有账号状态统一返回 `invalid_credentials`。未知账号仍执行同一条 scrypt 校验路径。 |
| 恢复码泄露或重放 | 团队管理员恢复码使用 256-bit 随机值，只保存 SHA-256 hash，绑定 `password_reset` 用途、团队和用户，15 分钟到期且只能消费一次；提交失败使用独立于密码登录的租户感知渐进节流；秘密不进入 URL、浏览器持久存储或审计事件。 |
| 恢复后旧会话存活 | 完成恢复同步轮换 scrypt 密码、递增 session epoch 并撤销该用户全部现有会话；客户端不会自动登录。 |
| 恢复越权 | owner/admin 只能在当前非本地团队内为较低权限且非自己的账号授权；admin 不能恢复 admin/owner，owner 不能恢复 owner；网页路径拒绝 `team_local`。 |

## 有条件通过项

- I1 协议为 v1 闭集；增加 provider 需要协议变更和兼容性测试。
- I2 的旧 Bearer **读取**暂作 API/测试兼容；新签发默认关闭，只有
  `MYAGENT_LEGACY_BEARER_AUTH=1` 才能签发，而且该模式会屏蔽企业 provider
  发现。
- Loopback HTTP 可显式使用非 Secure Cookie 进行本地开发；生产部署必须
  使用 `MYAGENT_SECURE_COOKIES=1` 或 production 策略。
- I7 只注册无网络、无真实身份、无生产秘密的合成 sandbox；生产运行时仍未
  注册真实 provider profile/adapter，因此企业入口保持 fail-closed。
- Callback 核心目前把合格事务推进到 `authorized`，但尚未连接真实供应商
  endpoint、成员关系解析、团队选择或会话签发。

## 未关闭的发布阻断

1. 正式 ADR owner ratification 尚未完成。
2. 启动时尚未强制验证 TLS、可信反向代理和生产 Cookie 配置。
3. I7 已用共享 harness 验证 PKCE S256、nonce/state、issuer、redirect URI、
   code 单次消费、超时、脱敏失败和 mix-up 防护；I8–I10 仍须逐一核验真实
   厂商 endpoint、应用类型、scope、回调域、租户字段和官方 sandbox 行为。
4. Verified tenant membership、显式多团队选择及禁用 membership 的端到端
   会话失效仍未接入。
5. 团队密码限流、告警和管理员恢复已在 I6 实现；本地 owner 仍只能走待建设
   的主机级管理命令，网页恢复保持 fail-closed。
6. 独立 provider kill switch 及合成授权源 allow-list 已由 I7 演练；生产
   CSP、真实授权源 allow-list、共享屏幕披露测试和红队仍属于 I8–I11 硬门禁。

## I5 UI 跟进（2026-07-27）

本地入口、“我的”会话详情、当前设备退出和全设备退出已接入 I1–I4
服务端契约。企业入口仅显示服务端实际发布的 provider；注册表为空时明确
显示未启用。等待页只显示 origin、当前电脑、provider 与过期时间，不显示
个人或团队资料，也不生成二维码。真实团队候选、比较码和 provider 授权
仍由 I7–I10 阻断。

## I6 密码回退与管理员恢复（2026-07-27）

账号密码入口现要求显式团队编号，服务端采用 15–128 字符、常见值与上下文
值阻断、无字符组合规则的密码策略。登录节流记录、恢复授权与安全告警进入
持久化白名单；节流记录只保存租户感知的标识哈希。管理员在“我的”中核验
成员后签发 15 分钟单次恢复码，恢复码仅在响应中显示一次；成员通过请求正文
提交，不写 URL 或 localStorage。恢复成功后不会创建会话，并撤销全部旧会话。

专项证据覆盖：跨租户失败预算隔离、密码与恢复码独立渐进节流、告警阈值、
角色越权、本地团队拒绝、恢复码 hash-only 持久化、到期、重放、密码轮换与
全设备会话失效。

## I7 供应商一致性与合成沙箱（2026-07-27）

共享 provider-neutral 核心与企业微信、飞书、钉钉三套合成 sandbox 已实现。
合同测试覆盖逐事务 state、PKCE S256、nonce、精确 issuer/redirect、浏览器
binding、租户 claim、授权码跨事务单次消费、挑战到期、交换超时、异常脱敏、
授权源 allow-list、秘密参数拒绝和独立 kill switch。原始 state、nonce、
code verifier、授权码及 adapter token 均不进入持久化状态。

测试 fixtures 使用 `.sandbox.example`、合成用户/租户和刻意的假 token，
不联网、不包含生产 client secret 或真实个人数据。该证据证明共享边界可测试，
不证明任一真实厂商协议已兼容，也不解除 I8–I11 上线门禁。

## 验证要求

- Protocol contract tests：provider/mode/state 闭集及 adapter 不得赋权。
- Unit security tests：策略 fail-closed、hash-only session、CSRF、idle/absolute
  expiry、epoch revoke、binding mismatch、expiry、single-use/replay audit，以及
  tenant-aware password throttle、恢复权限、15 分钟到期与单次消费。
- HTTP integration：显式 local/password login、无浏览器 token、
  HttpOnly/SameSite、CSRF 拒绝、管理员授权、恢复后全部旧会话立即失效，
  以及 provider 能力发现、S256 challenge 与禁用后 fail-closed。
- Provider conformance：三种合成 adapter 共用同一套 state、PKCE/nonce、
  issuer、单次 code、租户 claim、超时、脱敏和 kill-switch 合同测试。
- Full server/web typecheck、lint、existing tenancy compatibility regression。

任何未关闭的发布阻断都不得用 UI 文案、装饰性二维码或“beta”标签绕过。
