# 首台内网主机 ×“我的站点”真实验证规划

状态：内网 HTTP 验收通过；测试域名注册与 AliDNS 权威托管已确认；内网可信 HTTPS、证书续期和正式协议发布待完成
适用主机：`validation-host-01` / `<LAN_HOST_IP>:22` / Linux x86_64
原则：不在仓库、服务状态、日志或文档中保存密码；所有远端写入限定在专用测试范围；不复用已有 Nginx 容器的数据目录。

## 1. 验证目标

把真实主机验证纳入同一条产品链路，而不是只用命令行证明 SSH 可登录：

1. 在“我的主机”创建 `site_publish` 主机。
2. 观察并显式确认主机指纹。
3. 通过进程内凭据保险库验证密码登录、SFTP、原子 rename 和 symlink。
4. 创建并验证专用发布范围。
5. 在“我的站点”选择该范围，验证 `ssh_static` 发布目标。
6. 完成首次发布、二次发布、线上内容摘要核对和上一健康版本恢复。
7. 留存脱敏测试证据，并运行站点、主机、Electron 和 Web 回归测试。
8. 使用专用测试子域名和 AliDNS DNS-01 获取公开可信证书，在不开放公网入口的情况下完成真实 HTTPS、续期和恢复验证。

## 2. 固定边界

- 远端专用范围：`/srv/myagenttool-sites/site-e2e`。
- 受管 Web 根：`/srv/myagenttool-sites/site-e2e/current`。
- 内网成功链路使用独立范围 `/srv/myagenttool-sites/site-lan-e2e`，避免和失败保护证据互相覆盖。
- 内网访问入口为 `http://<LAN_HOST_IP>:8088/`，由独立容器 `myagenttool-site-lan-e2e-nginx` 提供，不占用已有 80 端口。
- HTTPS 验收使用专用测试子域名；浏览器通过内网 DNS 或本机 hosts 指向 `<LAN_HOST_IP>`，ACME 只使用公网可见的 `_acme-challenge.<TEST_DOMAIN>` TXT。
- HTTPS 使用独立 443 服务和独立证书目录；不接管现有 80 端口容器，也不把证书私钥放入站点发布范围或 Web 根。
- 该范围只用于测试站点，不保存用户资料、生产密钥或其他服务数据。
- 当前已验证版本只管理站点标记、回执、不可变版本和 `current` 指针。HTTPS 阶段按 v0.20 规划增加 AliDNS DNS-01、独立证书范围和固定 Nginx 重载 profile；执行前必须再次展示并确认精确变更。
- 主机管理员仍负责一次性创建专用 443 Nginx 容器/配置、只读挂载 Web 根和证书范围；MyAgentTool 不修改防火墙、系统用户或已有容器。
- 清理只能在列出精确范围、确认当前/上一健康版本不再使用后单独执行。

## 3. 当前实测基线

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 局域网路由 | 通过 | 验证机与目标位于 `10.10.10.0/24` |
| TCP 22 | 通过 | SSH 端口可连接 |
| 主机指纹 | 通过 | `SHA256:c+2y8wjR5V4wFYlnNbvmx14MRXnBkfhFanGrH8LY0Yw` |
| 密码登录 | 通过 | `devagent` 登录成功；密码未持久化 |
| SFTP | 通过 | 协议 v3 |
| 原子 rename | 通过 | OpenSSH `posix-rename` 可用 |
| symlink | 通过 | SFTP symlink 可用 |
| 主机空间 | 通过 | 根卷约 56 GiB 可用（实测时） |
| HTTP 80 | 已存在 | Docker `nginx:alpine` 返回 200 |
| HTTPS 443 | 未就绪 | 端口拒绝连接 |
| 域名注册 | 通过 | 测试域名注册局 RDAP 返回 200 |
| 权威 DNS | 通过 | `dns25.hichina.com`、`dns26.hichina.com` |
| 公网 A/AAAA | 未配置且非阻塞 | DNS-01 与内网访问不要求公网地址记录 |
| AliDNS RAM 凭据 | 待用户配置 | 必须使用独立最小权限 RAM AccessKey，不使用主账号 AccessKey |
| Nginx 数据挂载 | 未就绪 | 现有容器仅挂载日志，不挂载测试发布范围 |
| 应用级主机接入 | 通过 | HTTP API 完成创建、凭据注入、指纹确认和能力验证 |
| `site_publish` 范围 | 通过 | `/srv/myagenttool-sites/site-e2e` 已验证为真实专用目录 |
| “我的站点”SSH 目标 | 通过 | `ssh_static` 状态为 `ready`，站点凭据引用为 `null` |
| 受管远端布局 | 通过 | 已创建标记、回执目录和 `releases`；尚未创建 `current` |
| HTTPS 失败保护 | 通过 | 真实上传后因健康检查失败，活动发布保持为空且 `current` 被撤销 |
| 内网 v1 发布 | 通过 | `spb_0022`，HTTP 200，首页 1424 bytes |
| 内网 v2 发布 | 通过 | `spb_0026`，HTTP 200，首页 1430 bytes |
| 内网恢复 v1 | 通过 | `current` 恢复到 `spb_0022`，首页恢复为 1424 bytes |
| 内网暴露边界 | 通过 | 活动首页 200；标记与回执 403；`releases` 404 |

现有 80 端口 Nginx 属于主机已有中间件环境，不作为 MyAgentTool 测试站点接管目标。

## 4. 分阶段执行

### A. 应用级主机接入

使用隔离的本地状态启动真实服务端，通过 HTTP API 执行：

1. `POST /api/hosts`：用途设为 `site_publish`，网络策略显式设为 `allow_private_network`。
2. `POST /api/hosts/:id/observe-fingerprint`：结果必须与已记录指纹一致。
3. 通过桌面凭据内部只写接口注入 `credential://ssh/:hostId`；响应和状态不得包含密码。
4. `POST /api/hosts/:id/confirm-fingerprint`：携带当前 revision。
5. `POST /api/hosts/:id/verify`：必须得到 SFTP、rename、symlink 能力。

验收：主机状态为 `ready`，凭据只存在于本次进程内存，服务停止后不可读取。

仓库提供 `pnpm verify:my-site:ssh-real` 作为可重复执行入口。主机、用户、指纹、范围和测试域名通过 `MYAGENTTOOL_REAL_SSH_*` / `MYAGENTTOOL_REAL_SITE_DOMAIN` 环境变量提供；密码只在进程环境中短暂存在。设置 `MYAGENTTOOL_REAL_EXPECT_PUBLISH_FAILURE=1` 会额外验证 HTTPS 失败后不产生活动发布且不保留 `current`。

设置 `MYAGENTTOOL_REAL_RUN_PUBLICATION=1` 与 `MYAGENTTOOL_REAL_SITE_URL=http://<LAN_HOST_IP>:8088/` 会启用显式内网验收映射，依次执行 v1、v2 和恢复。该映射只通过服务组合器的集成测试注入点启用；生产运行没有对应环境开关，仍使用固定公网解析和 HTTPS 核对。

### B. 受管范围和站点目标

1. 主机管理员一次性创建专用空目录并把所有者设为 `devagent`。
2. `POST /api/hosts/:id/file-scopes`：用途 `site_publish`，权限 `list/upload/download`，状态 `ready`。
3. 创建隔离测试站点并把发布目标设为 `ssh_static`，`remoteProjectRef` 指向该范围。
4. 验证发布目标，确认系统只在专用范围内创建受管标记、回执目录和 releases 目录。

验收：范围真实路径不漂移、不经过符号链接；站点不保存第二份 SSH 凭据引用；已有非受管布局时失败关闭。

### C. AliDNS 安全连接与 staging 签发

1. 在新增的“自有服务器 → 域名与 HTTPS → 阿里云 DNS”入口保存 RAM AccessKey；状态只保留 `credential://alidns/main`。
2. 先执行只读连接测试，确认凭据只能访问测试域名所需解析接口。
3. 使用 Let’s Encrypt staging 创建 DNS-01 order，观察 TXT 在 AliDNS 权威服务器可见后完成挑战，并按 RecordId 删除本次 TXT。
4. 对错误权限、错误域名、DNS 超时和 TXT 清理失败分别验证脱敏错误与可恢复状态。

验收：AccessKey、ACME 账号私钥和 TXT value 不进入持久状态、日志或 HTTP 读响应；staging 流程可重复且不残留记录。

### D. 正式证书与内网 443

1. 用户确认正式签发计划后，为专用测试子域名申请 Let’s Encrypt 证书。
2. 把证书写入 `/srv/myagenttool-tls/site-e2e/releases/<certificateId>/`，权限收紧后原子切换 `/srv/myagenttool-tls/site-e2e/current`。
3. 主机管理员创建独立 443 Nginx 服务：站点根只读指向 `/srv/myagenttool-sites/site-lan-e2e/current`，证书只读指向上述 TLS `current`，不改已有 80/8088 服务。
4. 在验收机配置 `<TEST_DOMAIN> -> <LAN_HOST_IP>` 的内网解析；应用健康检查直接连接已验证主机地址，同时使用该域名 SNI 和完整 CA 校验。
5. 核对证书链、SAN、有效期、首页 SHA-256，以及标记、回执和 releases 不可通过 HTTPS 读取。

验收：`https://<TEST_DOMAIN>/` 在局域网内受公开 CA 信任；不依赖公网 A/AAAA，不使用 `-k`、跳过校验或 HTTP 降级。

### E. HTTPS 内容发布、证书续期与恢复

1. 通过应用 API 在 HTTPS 目标执行 v1、v2 和恢复 v1，重复核对内容摘要和活动回执。
2. 使用 staging 强制模拟续期，验证新证书版本上传、原子切换、固定 Nginx reload 和 HTTPS 复验。
3. 模拟证书/私钥不匹配、重载失败和新证书复验失败；确认恢复上一证书指针并重新加载。
4. 验证到期前 30 天续期窗口、每日幂等检查、应用长期未运行时的到期预警和凭据撤销后的明确状态。

验收：内容版本与证书版本独立回滚；任一步失败时旧站和旧证书继续服务，恢复失败则停止后续发布并显示人工处置状态。

## 5. 回归矩阵

- 服务端：站点、主机、文件范围、SSH 静态适配器和 HTTP 集成测试。
- Electron：SSH 凭据安全存储、恢复和撤销测试。
- Web：我的主机、站点专业设置、发布和恢复界面测试。
- 浏览器：`my-site-real-server.spec.ts`，补充 SSH 目标选择与普通/专业信息隔离场景。
- 真实主机：重复执行 A/B；C–E 覆盖 DNS 权限、staging/正式签发、内网可信 HTTPS、首次/二次发布、证书续期、失败保护和双重恢复。

## 6. 当前阻塞与完成定义

当前 A、B 和内网 HTTP 发布/恢复均已完成；C 的 AliDNS 只读验证、staging DNS-01、CAA、TXT 等待与清理代码也已实现。D 的 `tls_certificate` 隔离范围、不可变证书版本、私钥 `0600`、逐文件回读与密钥匹配、原子 `current`、固定 Docker Nginx profile、固定私网地址 + 域名 SNI + 显式 staging CA 校验，以及失败/回执丢失恢复代码和自动化测试均已完成。尚未执行 C/D 的真实外部调用：需要先保存测试域名 RAM AccessKey、从官方来源配置 staging CA，并由主机管理员准备专用 TLS 目录及独立 443 容器。正式证书、持久加密保险库、续期调度与真实 D–E 演练仍待后续；主机 443 当前仍未由本项目变更。

首台验证主机现在可以标记为“内网真实主机 HTTP 验收通过”。C–E 与回归矩阵通过后标记为“内网可信 HTTPS 生产协议验收完成”；公网开放、备案和公网可达性是另一项独立决策，不作为本轮内网验收条件。
