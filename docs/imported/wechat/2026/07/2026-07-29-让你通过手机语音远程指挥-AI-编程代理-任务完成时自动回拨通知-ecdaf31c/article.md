---
title: "让你通过手机语音远程指挥 AI 编程代理，任务完成时自动回拨通知"
source_provider: wechat
content_type: article
source_url: "https://mp.weixin.qq.com/s/DvO9AEFLx7XLoOqRuQxXJg"
canonical_url: "https://mp.weixin.qq.com/s/DvO9AEFLx7XLoOqRuQxXJg"
author: "魏咕咕响"
published_at: 2026-07-29
imported_at: "2026-08-08T07:01:32.312Z"
local_issue_id: "lwi_7905"
url_hash: ecdaf31c1b790bdd6b92835e474e8ce6a2c68387fb5bf04488b10b56833a30b6
---
**Voxa** 是一套让开发者用手机远程与 AI 代理交互的开源工具，简单说它就像一个"电话助手"——你对着手机说话布置任务，它在你电脑上干活，干完了自动给你打电话通知你。

**举个例子**

假设你是一个程序员，正在外面散步，突然想到：

> ❝
>
> "我有个 bug 要修——用户登录后头像不显示，帮我查一下代码里 User 模块的 avatar 字段是不是有问题。"

你掏出手机，打开 Voxa，像发微信语音一样说出这段话。然后你继续散步。

Voxa 把你的语音转成文字，发给你家里电脑上正在运行的 AI Agent。Agent 自动打开代码库，找到 User 模块，检查 avatar 相关代码，找到问题所在，把修复方案写好。

一切搞定后，你的手机响了——就像有人给你打电话一样。接起来，Agent 告诉你："找到了，头像字段在接口里被误写成了 avater，已经帮你改好了。"

你完全不需要坐在电脑前，全程只用嘴说、用耳朵听。

### **要点**

- 核心体验：用户语音输入 → AI 代理在电脑上执行任务 → 任务完成时自动拨打用户手机回铃通知。
- 支持平台：macOS 和 iPhone 已实测通过；Windows 可用但尚未测试；Android 暂未支持。
- 支持的 AI 代理：Claude Code 已确认可用；Codex 和 Gemini 尚未支持。
- 自托管方案完全免费，只需自带 API Key，无需依赖官方中继服务（完整文档见 voxa.space/docs）
- 官方也提供托管式中继/推送服务，零配置安装，免费起步，付费计划可解锁更多代理分钟数。
- 架构分两层：仓库包含笔记本端服务器和手机端 Web 客户端（均 MIT 开源）；原生 iOS App 和托管中继/计费服务位于独立私有仓库中。

### **安装**

安装入口为 voxa.space/setup，按指引安装并配对手机即可。完整文档位于 voxa.space/docs。

项目由 **Ti（Qutibah Ananzeh）** 开发，采用 **MIT** 开源协议。

> ❝
>
> 项目地址：https://github.com/voxa-code/voxa
