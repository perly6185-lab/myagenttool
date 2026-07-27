# 国内本地与企业登录实施树

来源：[#1536](https://github.com/perly6185-lab/myagenttool/issues/1536)、
[ADR 0021](../engineering/ADR_0021_PROVIDER_NEUTRAL_ENTERPRISE_IDENTITY.md)

本文件是待评审的 Issue 拆分，不代表任何供应商已启用。创建正式 Issue
时应沿用下列标题、依赖、验收和 rollout gate。

## 依赖关系

```text
I0 ADR 安全评审
 ├─ I1 身份能力发现与规范化契约
 ├─ I2 服务端会话、Cookie 与 CSRF 加固
 ├─ I3 显式本地模式
 └─ I4 一次性登录挑战与审计
       ├─ I5 中文身份入口与“我的”会话管理
       ├─ I6 密码回退与管理员恢复
       └─ I7 供应商适配器测试工具
             ├─ I8 企业微信适配器
             ├─ I9 飞书适配器
             └─ I10 钉钉适配器
                    └─ I11 灰度、红队与上线门禁
```

I5 同时依赖 I1、I2、I3 和 I4。I8–I10 相互独立，但每项都依赖 I7，
并且任何一项都不能绕过 I11 单独上线。

## 建议 Issues

### I0 `[ADR]: Provider-neutral local and enterprise identity boundary`

- Area: security
- Risk: high
- Depends on: #1536
- Deliverable: ratify ADR 0021 or record rejected alternatives.
- Acceptance:
  - security, product, and platform owners approve session and tenant boundaries;
  - QR lifetime, replay response, local policy, recovery, and logout are decided;
  - provider credentials remain separate from Channel/Application credentials.

### I1 `[Task]: Identity options bootstrap and provider-neutral contract`

- Area: protocol
- Risk: high
- Depends on: I0
- Acceptance:
  - `/api/identity/options` exposes enabled modes without secrets;
  - normalized challenge, external identity, tenant candidate, and membership
    contracts have schema and compatibility tests;
  - adapters cannot assign roles or create teams.

### I2 `[Security]: Replace team bearer storage with revocable server sessions`

- Area: security
- Risk: high
- Depends on: I0
- Acceptance:
  - opaque session IDs are hashed at rest and sent only in Secure HttpOnly cookies;
  - idle/absolute expiry, rotation, current/all-device revoke, and CSRF pass tests;
  - role and membership changes invalidate or re-evaluate sessions;
  - legacy bearer mode is limited to an explicit migration flag and cannot be
    combined with enterprise rollout.

### I3 `[Security]: Make local single-user entry an explicit server policy`

- Area: server
- Risk: high
- Depends on: I0
- Acceptance:
  - no fallback actor receives owner authority when authentication is required;
  - local mode appears only when policy and deployment context allow it;
  - disabling local mode fails closed and does not affect team recovery;
  - loopback/local administrative recovery has an audited test path.

### I4 `[Security]: One-time authorization challenge store and identity audit`

- Area: security
- Risk: high
- Depends on: I0, I1, I2
- Acceptance:
  - hashed 256-bit challenge, browser/device/provider binding, 120-second maximum,
    compare-and-set terminal states, and replay response are tested;
  - audit records contain reason codes but no codes, tokens, QR payloads, or raw
    provider responses;
  - expired, rejected, cancelled, and replayed challenges cannot mint sessions.

### I5 `[Feature]: Simplified Chinese identity entry and session management`

- Area: web
- Risk: medium
- Depends on: I1, I2, I3, I4
- Acceptance:
  - local and team paths are distinct on desktop and mobile;
  - happy path, waiting, expiry, rejection, team selection, recovery, current
    device logout, and all-device logout have component and browser tests;
  - shared-screen state leaks no personal/team details before confirmation;
  - no QR is rendered unless the server returns a live reviewed challenge.

### I6 `[Security]: Tenant-aware password fallback and administrator recovery`

- Area: security
- Risk: high
- Depends on: I1, I2, I4
- Acceptance:
  - generic failures, rate limits, progressive delay, alerts, and tenant-aware
    identifiers pass abuse tests;
  - recovery grants are hashed, purpose-bound, single-use, and expire in 15 minutes;
  - completion rotates credentials and revokes every existing session.

### I7 `[Test]: Identity provider conformance and sandbox harness`

- Area: test
- Risk: high
- Depends on: I1, I4
- Acceptance:
  - contract suite tests callback state, PKCE/nonce where supported, issuer,
    one-time code, tenant claims, timeouts, and sanitized failures;
  - fixtures contain no production secret or real personal data;
  - each provider can be disabled independently.

### I8 `[Integration]: WeCom enterprise identity adapter`

- Area: integrations
- Risk: high
- Depends on: I7
- Acceptance:
  - current official member/admin and application-type differences are documented;
  - verified enterprise/member identifiers normalize through I1;
  - callback-domain, expiry, wrong-enterprise, denial, and replay tests pass;
  - WeCom Channel credentials and identity credentials are demonstrably separate.

### I9 `[Integration]: Feishu enterprise identity adapter`

- Area: integrations
- Risk: high
- Depends on: I7
- Acceptance:
  - current OAuth flow, issuer, tenant/open identifiers, scopes, and callback
    requirements are verified against official documentation;
  - rejection, expired code, multiple tenant, and token-redaction tests pass;
  - Feishu Channel credentials and identity credentials are separate.

### I10 `[Integration]: DingTalk enterprise identity adapter`

- Area: integrations
- Risk: high
- Depends on: I7
- Acceptance:
  - current QR/redirect path and organization identity contract are verified in
    the official sandbox;
  - rejection, expired code, wrong organization, and replay tests pass;
  - DingTalk Channel credentials and identity credentials are separate.

### I11 `[Security]: Enterprise identity staged rollout and red-team gate`

- Area: security
- Risk: high
- Depends on: I5, I6 and at least one of I8–I10
- Acceptance:
  - replay, phishing, provider mix-up, wrong tenant, shared screen, fixation,
    CSRF, brute force, recovery abuse, and logout tests pass;
  - provider kill switches and rollback are exercised;
  - audit/retention/privacy review is approved;
  - rollout starts with internal tenants and no automatic fallback to local mode.

## Review checklist

- [ ] Every Issue carries `risk/high` when it touches credentials, sessions,
      callbacks, membership, or recovery.
- [ ] I0–I4 complete before any real QR is shown.
- [ ] Provider sandbox evidence is attached to I8/I9/I10.
- [ ] No provider task changes Channel or Application credential storage.
- [ ] I11 is a hard release dependency, not a post-launch follow-up.

## 实施状态（2026-07-27）

- I0：实现级安全评审对 I1–I7 基础层 **有条件通过**；Security、Product、Platform
  owner 的正式 ratification 仍未完成。
- I1：闭集 provider/mode/state 契约、外部身份规范化和能力发现已实现；
  当前没有注册任何真实 provider adapter，因此 `providers` 为空。
- I2：浏览器已迁移到 HttpOnly 服务端会话、CSRF、空闲/绝对过期、当前设备
  注销与全设备撤销基础；旧 Bearer 仅保留显式迁移开关。
- I3：认证开启时本地模式必须显式配置，匿名 actor 不再继承本地 owner
  权限；主机级本地恢复仍属于 I6。
- I4：哈希化、120 秒、浏览器/设备/provider 绑定、单次消费和脱敏审计基础
  已实现；I7 已为合成回调补齐 PKCE/nonce、issuer 与 sandbox conformance，
  真实厂商回调及成员关系仍由 I8–I10 阻断。
- I5：中文本地/团队入口和“我的”当前会话已接入真实 options/session API；
  覆盖无提供方、等待、过期、拒绝、管理员恢复说明、当前设备退出与全部设备
  退出。真实团队选择只会在 I7–I10 提供已验证成员候选后启用，当前不会展示
  假二维码、假团队或装饰性成功状态。
- I6：团队感知的账号密码入口、统一失败、scrypt 等时校验、密码与恢复码独立
  的持久化渐进节流、团队安全告警和管理员协助恢复已实现。恢复码只保存哈希，
  绑定用途/团队/用户，15 分钟单次使用；完成后轮换密码并撤销全部会话，且不会
  自动登录。网页路径拒绝本地团队、所有者自助及越级恢复；本地 owner 的主机级
  命令仍保持阻断，不以网页“万能恢复”替代。
- I7：共享 provider-neutral callback 核心及企业微信、飞书、钉钉合成 sandbox
  已实现；同一合同验证 state、PKCE S256、nonce、精确 issuer/redirect、单次
  code、租户 claim、超时、异常脱敏、授权源 allow-list 与独立 kill switch。
  fixtures 不联网且不含生产秘密或真实个人数据。生产注册表仍为空，真实 endpoint、
  scope、应用类型和官方 sandbox 证据继续由 I8–I10 阻断。

详见 [ADR 0021 安全评审](../security/ADR_0021_SECURITY_REVIEW.md)。
