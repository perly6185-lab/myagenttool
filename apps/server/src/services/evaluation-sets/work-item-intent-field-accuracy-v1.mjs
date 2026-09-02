const noMaterials = { inputs: [], changeTargets: [], source: "confirmed_task_context" };

const readOnlyForbidden = ["create", "modify", "delete", "move", "rename", "write"];

export const WORK_ITEM_INTENT_FIELD_ACCURACY_SET_V1 = Object.freeze({
  schemaVersion: 1,
  id: "work-item-intent-field-accuracy",
  version: 1,
  description: "Synthetic, de-identified regression cases for goal, action, materials, output, and delivery intent fields.",
  cases: [
    {
      id: "desktop-explicit-read-only-files",
      tags: ["desktop", "read-only", "development", "negation"],
      item: {
        id: "eval_desktop_read",
        title: "检查项目文件，不要修改",
        intentStatement: "检查项目文件，不要修改",
      },
      expected: {
        goal: { value: "检查项目文件，不要修改", source: "current_user" },
        action: { accessMode: "read_only", operation: "read_files", forbiddenActions: readOnlyForbidden, source: "current_user" },
        materials: noMaterials,
        output: { value: null, source: "safe_default" },
        delivery: { destination: "task", platformId: null, platformLabel: null, source: "safe_default" },
      },
    },
    {
      id: "desktop-created-output-with-versioned-input",
      tags: ["desktop", "write", "materials", "material-version", "output"],
      item: {
        id: "eval_desktop_output",
        title: "生成客户分析报告",
        intentStatement: "根据客户资料生成分析报告",
        localContentRefs: [{ id: "content_customer", title: "客户资料", purpose: "required_input", selectedVersion: 3, selectedFingerprint: "sha256:customer-v3" }],
        artifactContract: { produces: ["analysis.md"] },
      },
      expected: {
        goal: { value: "根据客户资料生成分析报告", source: "current_user" },
        action: { accessMode: "write", operation: "create_output", forbiddenActions: [], source: "deterministic_inference" },
        materials: {
          inputs: [{ id: "content_customer", title: "客户资料", purpose: "required_input", locality: "local", version: 3, fingerprint: "sha256:customer-v3" }],
          changeTargets: [],
          source: "confirmed_task_context",
        },
        output: { value: "analysis.md", source: "task_definition" },
        delivery: { destination: "task", platformId: null, platformLabel: null, source: "safe_default" },
      },
    },
    {
      id: "channel-read-only-with-channel-delivery",
      tags: ["channel", "read-only", "materials", "output", "delivery"],
      item: {
        id: "eval_channel_read",
        title: "客户台账任务",
        channelOrigin: { channelId: "channel_sales" },
        channelTaskContract: {
          source: "channel",
          goal: "分析客户台账",
          outputExpectation: "客户分析.md",
          operationIntent: { accessMode: "read_only", action: "query_data", forbiddenActions: [] },
        },
        inputAssets: [{ id: "asset_notes", originalName: "跟进记录.xlsx", version: 2, hash: "sha256:notes-v2" }],
      },
      expected: {
        goal: { value: "分析客户台账", source: "channel_contract" },
        action: { accessMode: "read_only", operation: "query_data", forbiddenActions: readOnlyForbidden, source: "channel_contract" },
        materials: {
          inputs: [{ id: "asset_notes", title: "跟进记录.xlsx", purpose: "required_input", locality: "local", version: 2, fingerprint: "sha256:notes-v2" }],
          changeTargets: [],
          source: "confirmed_task_context",
        },
        output: { value: "客户分析.md", source: "channel_contract" },
        delivery: { destination: "channel", platformId: null, platformLabel: null, source: "channel_contract" },
      },
    },
    {
      id: "channel-write-with-confirmed-task-delivery",
      tags: ["channel", "write", "change-target", "delivery-override"],
      item: {
        id: "eval_channel_write",
        title: "台账处理",
        channelOrigin: { channelId: "channel_ops" },
        channelTaskContract: {
          source: "channel",
          goal: "把确认状态写回客户台账",
          outputExpectation: "更新后的客户台账.xlsx",
          operationIntent: { accessMode: "write", action: "mutate_files", forbiddenActions: [] },
        },
        taskContextControl: { deliveryDestination: "task" },
        taskResourceRefs: [{ id: "ledger", title: "客户台账", purpose: "change_target", locality: "local", selectedVersion: 5, selectedFingerprint: "sha256:ledger-v5", capabilities: ["read", "commit_change"] }],
      },
      expected: {
        goal: { value: "把确认状态写回客户台账", source: "channel_contract" },
        action: { accessMode: "write", operation: "mutate_files", forbiddenActions: [], source: "channel_contract" },
        materials: {
          inputs: [],
          changeTargets: [{ id: "ledger", title: "客户台账", purpose: "change_target", locality: "local", version: 5, fingerprint: "sha256:ledger-v5", canCommit: true }],
          source: "confirmed_task_context",
        },
        output: { value: "更新后的客户台账.xlsx", source: "channel_contract" },
        delivery: { destination: "task", platformId: null, platformLabel: null, source: "confirmed_task_context" },
      },
    },
    {
      id: "template-output-authority",
      tags: ["desktop", "template", "output", "materials"],
      item: {
        id: "eval_template",
        title: "整理月度复盘",
        localContentRefs: [{ id: "content_month", title: "本月记录", purpose: "reference", version: "2026-08" }],
        myTemplateBinding: { definitionId: "template_monthly", familyId: "monthly", version: 4, name: "月度复盘", expectedOutput: "月度复盘.pptx" },
      },
      expected: {
        goal: { value: "整理月度复盘", source: "task_definition" },
        action: { accessMode: "unknown", operation: "unknown", forbiddenActions: [], source: "safe_default" },
        materials: {
          inputs: [{ id: "content_month", title: "本月记录", purpose: "reference", locality: "local", version: "2026-08", fingerprint: null }],
          changeTargets: [],
          source: "confirmed_task_context",
        },
        output: { value: "月度复盘.pptx", source: "template" },
        delivery: { destination: "task", platformId: null, platformLabel: null, source: "safe_default" },
      },
    },
    {
      id: "current-read-only-overrides-stale-write",
      tags: ["channel", "read-only", "authority-ratchet", "negation"],
      item: {
        id: "eval_read_override",
        title: "只读检查项目文件，不要修改",
        channelTaskContract: { source: "channel", operationIntent: { accessMode: "write", action: "mutate_files", forbiddenActions: [] } },
      },
      expected: {
        goal: { value: "只读检查项目文件，不要修改", source: "task_definition" },
        action: { accessMode: "read_only", operation: "read_files", forbiddenActions: readOnlyForbidden, source: "current_user" },
        materials: noMaterials,
        output: { value: null, source: "safe_default" },
        delivery: { destination: "channel", platformId: null, platformLabel: null, source: "channel_contract" },
      },
    },
    {
      id: "write-expansion-awaits-clarification",
      tags: ["channel", "read-only", "clarification", "authority-ratchet"],
      item: {
        id: "eval_write_conflict",
        title: "修改客户台账",
        intentStatement: "把已联系客户写回台账",
        channelTaskContract: { source: "channel", operationIntent: { accessMode: "read_only", action: "query_data", forbiddenActions: ["commit"] } },
      },
      expected: {
        goal: { value: "把已联系客户写回台账", source: "current_user" },
        action: { accessMode: "read_only", operation: "query_data", forbiddenActions: [...readOnlyForbidden, "commit"], source: "channel_contract" },
        materials: noMaterials,
        output: { value: null, source: "safe_default" },
        delivery: { destination: "channel", platformId: null, platformLabel: null, source: "channel_contract" },
      },
    },
    {
      id: "write-expansion-controlled-resolution",
      tags: ["channel", "write", "clarification-resolution", "authority-ratchet"],
      resolution: { code: "write_request_exceeds_confirmed_boundary", choiceId: "allow_write" },
      item: {
        id: "eval_write_resolved",
        title: "修改客户台账",
        intentStatement: "把已联系客户写回台账",
        channelTaskContract: { source: "channel", operationIntent: { accessMode: "read_only", action: "query_data", forbiddenActions: ["commit"] } },
      },
      expected: {
        goal: { value: "把已联系客户写回台账", source: "current_user" },
        action: { accessMode: "write", operation: "mutate_files", forbiddenActions: ["commit"], source: "confirmed_task_context" },
        materials: noMaterials,
        output: { value: null, source: "safe_default" },
        delivery: { destination: "channel", platformId: null, platformLabel: null, source: "channel_contract" },
      },
    },
    {
      id: "platform-target-and-channel-delivery",
      tags: ["channel", "write", "platform", "delivery", "output"],
      item: {
        id: "eval_platform",
        title: "平台内容任务",
        taskKind: "content_publish",
        channelOrigin: { channelId: "channel_content" },
        channelTaskContract: {
          source: "channel",
          goal: "发布现成文章到公众号",
          outputExpectation: "公众号文章",
          operationIntent: { accessMode: "write", action: "create_output", forbiddenActions: [] },
        },
        platformTarget: { id: "wechat_official", label: "公众号" },
      },
      expected: {
        goal: { value: "发布现成文章到公众号", source: "channel_contract" },
        action: { accessMode: "write", operation: "create_output", forbiddenActions: [], source: "channel_contract" },
        materials: noMaterials,
        output: { value: "公众号文章", source: "channel_contract" },
        delivery: { destination: "channel", platformId: "wechat_official", platformLabel: "公众号", source: "channel_contract" },
      },
    },
    {
      id: "mixed-material-identities-and-versions",
      tags: ["desktop", "write", "materials", "material-version", "change-target"],
      item: {
        id: "eval_materials",
        title: "更新供应商台账",
        intentStatement: "更新供应商台账",
        artifactContract: { produces: ["供应商台账.xlsx"] },
        inputAssets: [{ id: "asset_quote", originalName: "报价.xlsx", version: 2, hash: "sha256:quote-v2" }],
        localContentRefs: [{ id: "content_rules", title: "采购规则", purpose: "required_input", selectedVersion: 4, selectedFingerprint: "sha256:rules-v4" }],
        taskResourceRefs: [
          { id: "resource_catalog", title: "供应商目录", purpose: "query_source", locality: "remote", selectedVersion: "etag-7", selectedFingerprint: "sha256:catalog-7" },
          { id: "resource_ledger", title: "供应商台账", purpose: "change_target", locality: "local", selectedVersion: 8, selectedFingerprint: "sha256:ledger-v8", capabilities: ["read", "commit_change"] },
        ],
        recordBindings: [{ id: "binding_vendor", direction: "input", role: "reference", record: { title: "供应商主记录" }, snapshot: { revision: 9, fingerprint: "sha256:vendor-r9" } }],
      },
      expected: {
        goal: { value: "更新供应商台账", source: "current_user" },
        action: { accessMode: "write", operation: "mutate_files", forbiddenActions: [], source: "deterministic_inference" },
        materials: {
          inputs: [
            { id: "resource_catalog", title: "供应商目录", purpose: "query_source", locality: "remote", version: "etag-7", fingerprint: "sha256:catalog-7" },
            { id: "binding_vendor", title: "供应商主记录", purpose: "reference", locality: "managed", version: 9, fingerprint: "sha256:vendor-r9" },
            { id: "asset_quote", title: "报价.xlsx", purpose: "required_input", locality: "local", version: 2, fingerprint: "sha256:quote-v2" },
            { id: "content_rules", title: "采购规则", purpose: "required_input", locality: "local", version: 4, fingerprint: "sha256:rules-v4" },
          ],
          changeTargets: [{ id: "resource_ledger", title: "供应商台账", purpose: "change_target", locality: "local", version: 8, fingerprint: "sha256:ledger-v8", canCommit: true }],
          source: "confirmed_task_context",
        },
        output: { value: "供应商台账.xlsx", source: "task_definition" },
        delivery: { destination: "task", platformId: null, platformLabel: null, source: "safe_default" },
      },
    },
    {
      id: "channel-delivery-overridden-to-task",
      tags: ["channel", "read-only", "delivery-override"],
      item: {
        id: "eval_delivery_override",
        title: "客户资料处理",
        channelOrigin: { channelId: "channel_customer" },
        channelTaskContract: {
          source: "channel",
          goal: "分析客户资料",
          outputExpectation: "客户摘要.txt",
          operationIntent: { accessMode: "read_only", action: "query_data", forbiddenActions: [] },
        },
        taskContextControl: { deliveryDestination: "task" },
      },
      expected: {
        goal: { value: "分析客户资料", source: "channel_contract" },
        action: { accessMode: "read_only", operation: "query_data", forbiddenActions: readOnlyForbidden, source: "channel_contract" },
        materials: noMaterials,
        output: { value: "客户摘要.txt", source: "channel_contract" },
        delivery: { destination: "task", platformId: null, platformLabel: null, source: "confirmed_task_context" },
      },
    },
    {
      id: "current-user-delivery-prohibitions",
      tags: ["desktop", "write", "development", "prohibition"],
      item: {
        id: "eval_no_delivery_actions",
        title: "新增项目说明文档",
        intentStatement: "新增项目说明文档，不创建提交、不创建 PR、不推送远程",
      },
      expected: {
        goal: { value: "新增项目说明文档，不创建提交、不创建 PR、不推送远程", source: "current_user" },
        action: { accessMode: "write", operation: "mutate_files", forbiddenActions: ["commit", "pull_request", "push"], source: "current_user" },
        materials: noMaterials,
        output: { value: null, source: "safe_default" },
        delivery: { destination: "task", platformId: null, platformLabel: null, source: "safe_default" },
      },
    },
  ],
});
