# “我的主机”受控连接与文件传输开发规划

状态：开发版 v0.6（阶段 1—4 已完成；阶段 6 的普通用户入口 H1 开发中）
首要用户：需要查看、传输文件或排查自有电脑和 Linux 主机，但不希望学习 SSH/SFTP 或暴露任意命令执行能力的普通所有者
产品入口：一级“我的主机”；站点发布时从“我的站点 → 专业设置”选择已验证主机

## 当前实现进度

阶段 1 的服务端与桌面安全凭据层已完成：现有 SSH Target 已扩展为多用途主机连接；`/api/hosts` 支持指纹观察、带 revision 的显式确认、真实认证和 SFTP 能力验证；公网/私网目标策略、DNS 结果固定、危险地址阻断、全链路超时和错误脱敏已经落地。桌面端按 hostId 使用系统安全存储独立加密私钥、口令或密码，服务状态、HTTP 响应和事件中只保留 `credential://ssh/{hostId}` 引用。

阶段 2 已完成受控文件范围、真实 SFTP `realpath/lstat/readdir`、路径和符号链接边界、revision、团队隔离及只读远程文件浏览。一级“我的主机”现已提供主机列表、添加向导、概览/远程文件/传输任务，以及文件范围创建、重新验证、停用和目录浏览；专业模式额外显示设置页签与连接元数据。运行时专用 SSH 目标不会混入文件主机列表，普通模式不展示技术设置。

阶段 3 已开放范围级受控上传与下载：管理员可分别启停上传/下载权限；每次传输均显示文件、大小、范围和目标路径并要求显式确认；上传默认保留两份，支持拒绝同名文件和在主机具备原子重命名能力时明确覆盖。服务端使用同目录 `0600` 临时文件、分块 SFTP 读写、最终路径回查、10 MB 上传/25 MB 下载上限和 SHA-256 摘要，失败会清理半成品。下载只返回 `attachment` + `nosniff`，并阻止常见密钥、环境凭据和非普通文件。任务元数据、进度、失败码、关联重试和团队审计会持久化，文件内容不会进入状态库。

阶段 4 已接入生产可用的 `ssh_static` 站点适配器：站点目标只引用同团队已验证的 `site_publish` 文件范围，不重复保存 SSH 凭据或目录；服务端上传完整不可变版本，逐文件远端回读并核对 SHA-256，再通过 OpenSSH POSIX rename 原子替换 `current` 软链接。切换后使用固定解析地址、原域名 TLS SNI 和受限响应体检查公开 HTTPS 首页；内容不一致或不可访问时恢复切换前实际指针，恢复失败会升级为人工处置状态。回滚重新核对范围外的受管回执后切换历史版本，并对失败回滚执行反向恢复。专业设置可选择可用范围和域名，普通发布页继续显示四步业务进度与可执行错误说明。

当前仍不提供远程通用删除、目录写入、任意本地下载路径、任意命令执行、跨重启断点续传、传输中取消或历史站点版本自动清理。真实主机地址、凭据、目录、域名和 Web 服务配置继续由用户后续填写。

## 1. 产品命名与边界

一级产品能力命名为“我的主机”，它是远程主机连接、受控文件范围、传输任务和操作记录的统一管理入口。

界面名称统一为：

| 对象 | 普通视图 | 专业视图 / 内部概念 |
| --- | --- | --- |
| 发布目标 | 自有主机 | SSH 静态主机 |
| 连接对象 | 不直接展示 | 主机连接 |
| 可操作目录 | 不直接展示 | 文件范围 |
| 上传或下载 | 发布网站 / 下载备份 | 文件传输 |
| 一次执行 | 正在上传 / 正在下载 | 传输任务 |
| 可核验结果 | 操作结果 | 传输凭证 |

“我的主机”不是任意 SSH 终端，也不接受自由 shell 命令、`rsync` 参数、Nginx 配置片段、任意本地路径或不受约束的远程路径。远程终端与 Agent Runtime 继续使用已有 SSH Runtime Target 契约；文件传输只复用连接身份、凭据引用和主机信任，不自动获得终端权限。

## 2. 首版目标与非目标

首版必须完成：

1. 安全保存多个 SSH 主机连接及其凭据引用。
2. 真实 SSH 握手、主机指纹确认和连接能力检查。
3. 为每台主机配置一个或多个受控文件范围。
4. 在受控范围内浏览、上传和下载普通文件。
5. 所有写操作先生成计划，再显式确认和执行。
6. 提供进度、取消、失败重试、摘要校验和操作记录。
7. 让“我的站点”通过同一传输内核完成不可变上传、原子激活、验证和回滚。

首版不实现：

- 通用 SSH 终端、远程命令面板或用户输入的部署脚本。
- 远程软件安装、Nginx 自动改写、防火墙或系统用户管理。
- 主机间任意复制、双向实时同步、冲突自动合并。
- 自动接受未知主机指纹、默认开启 SSH Agent Forwarding。
- 直接删除任意远程目录；只允许清理本产品创建且不再使用的版本目录。
- 把下载内容直接写入调用方提供的任意本地绝对路径。

## 3. 与现有能力的关系

当前 `sshTargets` 已提供团队隔离、主机/端口/用户、认证方式、外部凭据引用、指纹策略、风险摘要和持久化。原有 `/api/ssh-targets/:id/test` 为兼容性静态预检；新增 `/api/hosts/:id/observe-fingerprint`、`confirm-fingerprint` 和 `verify` 执行经过显式信任确认的真实 SSH 握手与 SFTP 能力检查。

首版采用增量复用，不复制第二套 SSH 身份：

- `sshTargets` 继续作为连接身份和信任根；“我的主机”对外使用“主机连接”读模型。
- 原有 `workspaceRoot` 只服务远程 Runtime，不作为文件传输权限。
- 新增独立 `hostFileScopes`，每个范围绑定一个 SSH Target 和一个经过远端 `realpath` 固定的根目录。
- 远程 Runtime、普通文件传输、站点发布分别申请用途，不因连接相同而互相继承目录或操作权限。
- 站点 `ssh_static` 适配器只引用已经验证的“站点发布”文件范围，不再次保存主机、密钥或目录副本。
- 现有 `/api/ssh-targets` 保持兼容；新增 `/api/hosts` 作为“我的主机”聚合接口，避免破坏既有 Runtime 测试和状态。

## 4. 核心数据模型

### 4.1 主机连接 `sshTarget`

在现有字段上增量补充：

```text
purpose          runtime | file_transfer | site_publish，可多选
connectionStatus untested | fingerprint_pending | ready | error | disabled
observedFingerprint
verifiedAt
lastConnectedAt
networkPolicy    public_only | allow_private_network
capabilities     sftp、posixRename、symlink、fsync、maxPacket 等检查结果
revision
```

主机连接只保存 `credentialRef`。桌面端通过系统安全存储保存每台主机的私钥、私钥口令或密码；引用建议使用 `credential://ssh/{hostId}`，不得回读明文。首个生产版本优先支持显式私钥，密码和默认 SSH Agent 身份保留兼容但不能用于无人值守站点发布。

### 4.2 文件范围 `hostFileScope`

```text
id                hfs_*
ownerTeamId
sshTargetId
label
purpose           general_files | site_publish | backup
rootPath          用户配置的展示路径
resolvedRootPath  远端 realpath 后固定的路径
permissions       list、download、upload、create_directory
overwritePolicy   deny | confirm_each_plan
limits            单文件、总字节、文件数量、目录深度
status            setup | ready | error | disabled
revision
```

范围根目录不得是 `/`、用户主目录、系统配置目录、设备目录或未能解析的路径。每次操作都以 `resolvedRootPath` 为边界重新校验，不能只在创建范围时检查一次。

### 4.3 传输计划 `hostTransferPlan`

```text
id                htp_*
direction         upload | download
scopeId
sourceSnapshot    受管上传暂存、站点发布包或远端文件清单
destination       相对于范围根目录或受管下载区的相对路径
manifest          path、type、bytes、sha256、覆盖变化
checks            errors、warnings、配额和能力检查
scopeRevision
hostRevision
expiresAt
status            planned | confirmed | expired | cancelled
```

计划摘要绑定主机 revision、范围 revision、方向、所有路径和内容 SHA-256。确认后任何字段变化都必须重新生成计划。

### 4.4 传输任务 `hostTransfer`

```text
id                htr_*
planId
status            queued | connecting | transferring | verifying | completed | failed | cancelled
progress          stage、completedItems、totalItems、completedBytes、totalBytes
attempt
failure           清理后的错误码和普通/专业说明
receipt           最终远端路径、清单摘要、验证方式、完成时间
createdBy
createdAt / updatedAt
```

任务必须可持久化恢复。进程重启后，未完成任务先标记为 interrupted 并重新核对远端暂存状态，不能假设上传成功，也不能自动激活站点版本。

## 5. 受控文件操作协议

### 5.1 连接和信任

1. 首次连接只读取远端主机公钥指纹，不自动信任。
2. 用户在独立确认步骤核对并保存指纹。
3. 后续每次连接严格匹配固定指纹；变化时立即阻断上传、下载和发布。
4. DNS 解析结果在连接前检查，拒绝回环、链路本地、云元数据地址和解析漂移。访问私网主机必须单独开启并确认风险。
5. 禁止 ProxyCommand、任意跳板命令、Agent Forwarding 和调用方注入 SSH 参数。

### 5.2 路径边界

- 所有调用方路径必须是相对路径，统一 `/` 分隔，不接受空字节、控制字符、`..`、驱动器路径和绝对路径。
- 创建范围时记录远端 `realpath`；每层目录通过 `lstat` 检查。
- 默认拒绝符号链接、设备、Socket、FIFO 和其他特殊文件。
- 如果站点发布需要 `current` 符号链接，它只能由发布适配器在固定位置创建和替换，普通文件浏览器不能操作。
- 列表、上传和下载均有文件数、目录深度、单文件大小、总字节和执行时间上限。

### 5.3 上传

上传来源只能是：

- 用户在当前操作中明确选择并进入受管暂存区的文件；
- MyAgentTool 受管素材；
- 已确认的站点发布包；
- 已验证传输任务产生的受管文件。

上传先写到范围内的 `.myagenttool/staging/{transferId}`，逐项核对大小和 SHA-256，再通过远端原子重命名进入目标位置。默认禁止覆盖；需要覆盖时必须在计划中逐项列出。失败或取消只清理当前任务自己的暂存目录。

### 5.4 下载

下载前先固定远端清单、文件类型、大小和目标范围。内容进入本地受管下载区，完成签名/摘要校验后，用户才能执行“保存到本地”或“在文件管理器中显示”。服务端 API 不接受任意本地目标路径。

首版拒绝下载符号链接目标、特殊文件、超限目录和传输中发生 revision/大小变化的文件。压缩打包如需实现，只能在本地对已下载字节进行，不在远端拼接 shell 命令。

### 5.5 删除与清理

普通文件传输首版不提供通用删除。站点版本清理只允许删除 `<scopeRoot>/releases/{publicationId}` 形态、由当前团队创建、有范围外受管回执、且不是 current/previous 指向的目录。清理必须先展示释放空间、保留版本和精确目录清单，再单独确认。

## 6. SSH 静态站点发布协议

主机管理员需要预先完成一次系统配置：创建最小权限用户、专用目录，并让 Nginx/其他静态服务器把站点根目录指向 `<scopeRoot>/current`。MyAgentTool 不修改 Nginx 配置。

固定目录布局：

```text
<scopeRoot>/
  .myagenttool-site.json
  .myagenttool-receipts/spb_xxx.json
  releases/
    .staging-spb_xxx/
    spb_xxx/
  current -> releases/spb_xxx
```

站点文件和目录分别使用 `0644` 与 `0755`，以便独立的 Web 服务用户只读访问；管理标记和发布回执使用 `0600`/`0700`，并位于 `current` 指向的 Web 根目录之外。首次“测试连接”会在空的受管范围内创建管理标记、回执目录和版本目录；如果已经存在未受管的 `releases` 或 `current`，系统拒绝接管。

发布流程：

1. 预检连接、指纹、文件范围、剩余空间和原子重命名/符号链接能力。
2. 把完整静态包上传到独立 staging 目录。
3. 从远端重新读取并核对清单摘要；没有可靠验证就不能进入激活。
4. 将 staging 原子改名为不可变 release 目录。
5. 创建 `current.next`，确认只指向本次 release，再原子替换 `current`。
6. 从配置的网站 URL 读取首页并核对发布包 SHA-256。
7. 验证成功后记录活动版本和传输凭证；失败时重新指向上一健康版本并再次验证。

如果远端 SFTP 服务不支持可靠的原子 rename/symlink 组合，目标只能用于普通文件传输，不能标记为生产可用的站点发布目标。后续可以增加固定协议的远端 helper，但仍不得接受自由命令。

回滚只改变 `current` 指向，不重新上传历史包。保留策略默认保存当前版本、上一健康版本和最近若干历史版本；清理永远位于独立发布完成之后。

## 7. API 草案

```text
GET    /api/hosts
POST   /api/hosts
GET    /api/hosts/:hostId
PATCH  /api/hosts/:hostId
POST   /api/hosts/:hostId/observe-fingerprint
POST   /api/hosts/:hostId/confirm-fingerprint
POST   /api/hosts/:hostId/verify

GET    /api/hosts/:hostId/file-scopes
POST   /api/hosts/:hostId/file-scopes
PATCH  /api/hosts/:hostId/file-scopes/:scopeId
GET    /api/host-file-scopes?purpose=site_publish
GET    /api/host-file-scopes/:scopeId/entries?path=relative/path

POST   /api/host-transfer-plans
GET    /api/host-transfer-plans/:planId
POST   /api/host-transfer-plans/:planId/confirm
GET    /api/host-transfers
GET    /api/host-transfers/:transferId
POST   /api/host-transfers/:transferId/cancel
POST   /api/host-transfers/:transferId/retry
GET    /api/host-transfers/:transferId/download
```

所有接口按当前团队做存在性隐藏；创建/修改主机和范围仅管理员可用。上传、下载和发布还需同时通过用途、范围权限和计划确认，主机权限不能替代站点权限。

## 8. 产品界面

### 8.1 一级“我的主机”

```text
我的主机                                      [添加主机]

网站生产主机       连接正常 · 1 个文件范围    [打开]
备份主机           需要确认新指纹              [继续设置]

最近传输
网站版本 v8        上传并验证完成              [查看凭证]
资料备份.zip        下载中 63%                  [查看进度]
```

主机详情固定为四个页签：概览、远程文件、传输任务、设置。添加主机向导分为“连接资料—安全凭据—确认指纹—文件范围”四步。技术字段只在专业视图展示。

### 8.2 我的站点

普通视图只显示“发布位置：自有主机”和发布状态，不出现 SSH、SFTP、私钥、远程目录、软链接或指纹。连接失效时主操作为“请技术人员检查发布位置”。

专业设置选择已经验证且用途为 `site_publish` 的文件范围；未验证范围不能被保存为活动发布目标。站点发布页面继续使用现有四阶段进度，不新增另一套传输状态。

## 9. 分阶段开发

### 阶段 1：连接内核与安全凭据

- 扩展现有 SSH Target 的用途、revision、连接状态和能力检查。
- 桌面安全存储支持按 hostId 保存多个 SSH 凭据。
- 实现真实握手、指纹观察/确认和严格校验。
- 增加网络目标、端口、认证方式和日志脱敏测试。

验收：没有确认指纹不能浏览或传输；私钥和密码不进入状态、HTTP 响应、事件和日志；重启后只恢复引用和信任状态。

### 阶段 2：文件范围与只读浏览

- 新增文件范围模型、持久化、权限和 revision。
- 实现真实 `realpath/lstat/list`，完成路径与符号链接边界。
- 提供专业视图主机列表、添加向导、范围设置和只读文件浏览。

验收：跨团队、越界路径、绝对路径、`..`、符号链接逃逸和特殊文件全部失败关闭；普通视图不暴露技术字段。

### 阶段 3：受控上传与下载

- 新增逐次确认、任务进度、最多三次关联重试和摘要凭证。
- 实现内存受管上传、远端同目录 staging、浏览器附件下载和摘要核对。
- 完成同名冲突策略、覆盖二次确认、大小上限和失败清理。
- 完成“远程文件”和“传输任务”界面。

验收：未确认操作不能连接或改变远端；失败不会留下可见半成品；下载不能指定任意本地路径；敏感文件、符号链接、特殊文件和超限内容均失败关闭；状态与审计不包含文件内容。

阶段 3 后续硬化项（不阻塞当前受控小文件传输）：跨重启断点续传、主动取消、服务端恶意内容扫描和显式幂等键去重。

### 阶段 4：SSH 静态站点真实适配器

- `ssh_static` 引用已验证的 `site_publish` 文件范围。
- 实现不可变上传、远端回读核验、原子切换、健康检查和回滚。
- 接入现有发布计划、进度、失败恢复和历史版本模型。
- 通过验收后把适配器 `productionReady` 改为 `true`。

验收：新版本验证前旧站保持可用；激活失败自动恢复上一健康版本；远端不支持原子能力时明确拒绝生产发布。

完成情况：已完成。自动测试覆盖受管目录归属、逐文件回读、原子切换、公开内容不一致恢复、回执回滚、能力拒绝、SFTP 错误脱敏、站点服务无二次凭据引用和范围列表团队隔离。真实 Linux + Nginx 小范围试用仍属于阶段 5。

### 阶段 5：清理、诊断与真实主机试用

- 实现受控版本清理计划、空间预警和主机诊断。
- 增加连接中断、磁盘满、指纹变化、权限变化和远端内容篡改演练。
- 使用隔离 OpenSSH/SFTP 测试主机完成自动化验收，再进行小范围真实 Linux + Nginx 试用。

真实试验主机必须使用独立的应用级目录和服务边界，不接管主机已有 Nginx 中间件容器，也不以私网 HTTP 代替生产协议要求的可信 HTTPS 核对。具体设备记录只放在后续真实验证 PR 中，避免基础能力依赖环境专属文档。

内网先行验收使用独立 8088 容器与独立发布范围完成了 v1、v2 和恢复；该模式由验收脚本的适配器注入点提供，不进入生产配置，也不改变 `ssh_static` 默认的公网 HTTPS 安全协议。

阶段 5 增补“域名与 HTTPS”协作边界：证书签发属于“我的站点”的域名生命周期，不复用普通 `site_publish` 或文件传输范围。主机侧独立 `tls_certificate` 范围、禁止浏览/普通传输、范围重叠阻断、固定 Docker Nginx profile、原子证书切换及失败恢复代码已经实现。内网 HTTPS 健康检查连接该主机已验证的固定私网地址，保留站点域名 SNI、显式 staging CA 和完整证书指纹校验。

Web 服务激活不开放通用远程终端。管理员先创建固定重载 profile，首版只允许 `docker inspect`、容器内 `nginx -t` 和固定 HUP 三个服务端映射动作；容器名经过白名单校验，不接受 Shell、参数或 Nginx 片段。证书私钥不进入主机状态、传输任务、下载 API、审计正文或 SSH 凭据记录；正式签发后的持久加密保险库仍属于下一阶段。

验收：清理不能删除活动/上一健康版本；所有失败均有普通说明、专业证据和可恢复方向；真实试用不使用生产主机或真实用户数据。

### 阶段 6：普通用户主机工作台与 AI 协作

- H1：一级入口在普通模式直接加载已连接设备，保留概览、远程文件和传输任务；登录账号、端口、地址、指纹和设置页签只在专业视图显示。
- H1：连接流程不修改全局体验模式；继续复用现有内网许可、凭据安全存储、指纹确认和推荐文件范围。
- H2：AI 只编排固定只读诊断和批准文件范围内的查找、读取与预览，把原始输出整理成普通结论和可展开证据。
- H3：上传或固定服务动作必须先生成绑定主机/范围 revision 的操作预案，经确认后执行并自动复查；不开放任意 Shell。

阶段 6 不重建 SSH/SFTP 内核，也不放宽路径、凭据或确认边界。普通视图只是更易用的投影，专业视图继续承担技术证据和故障排查。

## 10. 自动化测试矩阵

| 层级 | 必测内容 |
| --- | --- |
| 单元测试 | 主机/端口/指纹/凭据引用、路径规范化、范围边界、计划摘要、错误脱敏 |
| 服务测试 | 团队隔离、revision 冲突、幂等、状态持久化、任务恢复、清理保护 |
| SFTP 集成测试 | 握手、固定指纹、上传/下载、断线续传、rename/symlink 能力、远端回读校验 |
| 对抗测试 | DNS 漂移、私网/元数据地址、路径穿越、符号链接逃逸、特殊文件、超限和篡改 |
| 浏览器测试 | 添加主机、确认指纹、配置范围、上传/下载计划、普通/专业信息隔离 |
| 站点端到端 | 首次发布、二次发布、失败保持旧版、回滚、版本清理和公网首页核对 |
| TLS 端到端 | AliDNS staging/production DNS-01、TXT 清理、私网 SNI、证书原子切换、固定重载、续期和失败恢复 |

SFTP 集成环境必须是测试进程创建的隔离主机和目录，不读取开发者 `~/.ssh`，不依赖默认 SSH Agent，也不连接互联网主机。

## 11. 建议 Issue 拆分

1. 我的主机协议词汇、状态模型和兼容读模型。
2. 多主机桌面安全凭据连接器。
3. SSH 真实握手、指纹确认与网络目标防护。
4. 文件范围、路径 confinement 与只读 SFTP 浏览。
5. 传输计划、确认摘要和幂等协议。
6. 上传 staging、远端校验与失败清理。
7. 下载受管区、校验与安全导出。
8. 我的主机列表、添加向导和详情页。
9. 传输进度、取消、重试和操作凭证。
10. SSH 静态站点适配器与原子激活。
11. SSH 站点回滚、健康检查和保留清理。
12. 隔离 SFTP、浏览器和真实主机验收。
13. `tls_certificate` 范围、固定 Web 重载 profile 与私网可信 HTTPS 验收。

## 12. 完成定义

“我的主机”只有在以下条件同时满足后才能称为可用：

- 用户无需复制 shell 命令即可完成连接、上传和下载。
- 任何远程写入都有可预览、可确认、不可篡改的计划。
- 任意路径输入都不能越过已验证文件范围。
- 凭据和下载字节不会进入普通状态、日志或错误响应。
- 传输中断可核对、可重试，不会误报完成。
- SSH 静态站点发布能证明旧版保护、原子激活、线上验证和回滚。
- 普通用户只感知发布位置和业务状态，专业用户能够查看连接、路径、指纹和传输证据。
