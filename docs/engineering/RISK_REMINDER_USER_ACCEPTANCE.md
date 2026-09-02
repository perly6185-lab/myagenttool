# 风险提醒真实用户验收手册

更新时间：2026-09-02

状态：R5.1 验收展示面和候选谱系门禁已就绪，尚未产生真实用户结论。自动化测试只能验证场景、观察记录和评分门槛，不能代替真实参与者。

## 验收问题

验证普通用户在不打开专业详情的情况下，能否从结果卡回答：

1. 发生了什么；
2. 为什么现在是这个状态；
3. 下一步应该做什么；
4. 点击主要动作会影响什么。

通过条件固定为：至少 5 名 `ordinary_user` 完成全部 8 个场景，共 160 个回答；答题前未打开专业详情的正确回答比例至少为 90%；以下关键误解必须为 0：

- 把“缺少验证”理解为“已经发现代码缺陷”；
- 把“创建 Pull Request”理解为“已经合并主分支”。

某个场景的独立理解率低于 90% 时，评分报告会生成 `scenario_comprehension_below_target` 待修复项。总体通过不能抹去这些单场景问题。

## 验收材料

- 场景集：[risk-reminder-user-acceptance-v1.json](../../packages/protocol/src/risk-reminder-user-acceptance-v1.json)
- 空白观察表：[risk-reminder-user-acceptance-observations.example.json](../../tools/dev/fixtures/risk-reminder-user-acceptance-observations.example.json)
- 评分器：[work-item-risk-reminder-acceptance.mjs](../../tools/dev/work-item-risk-reminder-acceptance.mjs)
- 参与者展示面：`/_acceptance/risk-reminders`

场景集固定覆盖：开发交付通过、验证缺失、复核矛盾、明确问题、办公批次成功、部分失败、已回滚，以及写状态未知但可查看详情。所有内容均为合成资料，不使用真实项目名、文件名、字段值或命令输出。

## 执行步骤

1. 先把待验收代码整理成 clean commit；任何后续产品或场景修改都会使本轮观察失效。
2. 在该 commit 上构建并启动 Web，使用 1440×900 的浏览器视口打开 `http://127.0.0.1:3000/_acceptance/risk-reminders`。页面不得显示“当前构建不可用于正式验收”。
3. 展开“主持人设置与记录信息”，把 `version`、`productCommit`、`sourceState`、`locale` 和 `viewport` 原样复制到观察表。`sourceState` 必须为 `clean`。
4. 招募至少 5 名不参与本功能开发的普通用户，为其分配 `participant-01` 形式的匿名编号。
5. 复制空白观察表到仓库外的受控位置，不在模板中填写姓名、邮箱、电话或组织信息。
6. 每个场景只使用隐藏展示面中的真实结果卡与审核决策组件。页面不加载主持人答案、不请求服务端数据，也不会执行写操作。
7. 每个场景先展示第一层结果信息，逐一询问四个固定问题。不要解释术语、暗示答案或先打开专业详情。
8. 参与者回答后，由主持人参照协议数据中的 `facilitatorGuide`，把每个回答标为 `correct`、`incorrect` 或 `not_answered`。
9. 若参与者在回答前要求打开专业详情，记录 `professionalDetailsOpenedBeforeAnswers: true`；回答后的复盘查看不改变该字段。
10. 只记录时长分桶和关键误解枚举，不记录原话。完成后由主持人设置完成时间和 `facilitatorAttestation: true`。
11. 执行评分命令。退出码为 0 才表示 R5 通过；非 0 必须先处理报告中的记录错误或理解问题。

观察表必须保留场景命令输出的 `datasetDigest`。ID、版本或摘要任一不匹配都会阻止旧观察记录在改动后的场景上重放。

观察表还必须绑定参与者实际看到的 Web 构建：`productCommit` 必须是 40 位 Git commit，`sourceState` 必须为 `clean`，locale 固定为 `zh-CN`，视口必须落在 1280×720 至 1920×1200。P4.14 会再次要求 `productCommit` 与发布候选 commit 完全一致。

```bash
pnpm accept:risk-reminders:verify
pnpm accept:risk-reminders:scenarios
pnpm --filter @myagenttool/web build
pnpm --filter @myagenttool/web serve
pnpm accept:risk-reminders -- --responses /absolute/path/to/observations.json
pnpm accept:risk-reminders -- --responses /absolute/path/to/observations.json --json
```

## 观察记录契约

参与者只保留匿名 ID 和用户类型：

```json
{
  "id": "participant-01",
  "profile": "ordinary_user"
}
```

每个参与者和场景必须恰好有一条观察记录：

```json
{
  "participantId": "participant-01",
  "scenarioId": "development_verification_missing",
  "professionalDetailsOpenedBeforeAnswers": false,
  "durationBucket": "under_30s",
  "answers": {
    "what_happened": "correct",
    "why": "correct",
    "next_step": "correct",
    "action_impact": "correct"
  },
  "criticalMisconceptions": []
}
```

观察文件顶层还必须保留展示面元数据：

```json
{
  "surface": {
    "version": "risk-reminder-ui-v1",
    "productCommit": "40-character-clean-candidate-commit",
    "sourceState": "clean",
    "locale": "zh-CN",
    "viewport": { "width": 1440, "height": 900 }
  }
}
```

`durationBucket` 只允许 `under_30s`、`30_to_60s`、`over_60s` 或 `not_recorded`。它用于后续体验诊断，不进入本阶段放行分数。

评分器会拒绝重复参与者、重复场景、缺失矩阵、未知枚举、版本不匹配，以及带有姓名、联系方式、文件路径、命令、原始回答、凭据或正文等字段的记录。`study.notes` 和待修复项只能写脱敏结论。

## 结论与待修复项

评分报告的 `releaseReady` 是 R5 的唯一机器结论；同时必须保存以下有限证据供 R6 引用：

- 数据集 ID、版本和 SHA-256 摘要；
- 完成参与者数与场景观察数；
- 不依赖专业详情的正确回答数、分母和比例；
- 关键误解次数；
- 低于目标的场景 ID 与理解率；
- 主持人确认和完成时间。

不要提交原始录音、逐字稿、截图、真实任务内容或参与者身份信息。需要修复文案时，只记录场景 ID、问题码、严重度和脱敏后的简短结论；修复后以新数据集版本重新验收，不能覆盖原结论。

## 与发布门禁的边界

R5 包就绪不等于 R5 已通过。只有真实观察文件通过评分，才可以进入 R6/P4.14 发布证据阶段。R6 只引用有限的聚合结论，不把观察原始文件打入发布包。
