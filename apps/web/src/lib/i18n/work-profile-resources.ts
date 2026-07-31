import { i18n } from "@/lib/i18n";

export const workProfileTranslations = {
  "en-US": {
    title: "Work profile review",
    description: "Review what the system understands about your work and correct it before it is used.",
    systemUnderstanding: "System understanding",
    classification: "Classification",
    understanding: "Understanding",
    evidenceSource: "Evidence source",
    authorizedDirectory: "Source: an authorized project directory",
    noEvidence: "No directory evidence is available.",
    pendingCount: "{{count}} awaiting review",
    empty: "No active work-profile inferences. Deleted items remain in the audit history.",
    confirm: "Confirm",
    modify: "Modify",
    reject: "Reject",
    delete: "Delete",
    saveCorrection: "Save correction",
    confidence: "{{value}}% confidence",
    deleteTitle: "Delete this work-profile inference?",
    deleteDescription: "The inference will disappear, but an audit snapshot will be retained.",
    auditTitle: "Correction audit",
    auditEmpty: "Confirm, modify, reject, or delete an inference to create an audit record.",
    auditActor: "Action recorded for {{actor}}.",
    auditChange: "{{before}} → {{after}}",
    auditReason: "User corrected the system classification.",
    rejectReason: "User denied this inference.",
    deleteReason: "User removed this inference.",
    category: {
      role: "Role",
      domain: "Domain",
      work_type: "Work type",
      skill: "Skill",
      preference: "Preference",
    },
    value: { software_development: "Software development" },
    status: {
      pending: "Awaiting review",
      confirmed: "Confirmed",
      rejected: "Rejected",
    },
    auditAction: {
      confirmed: "Confirmed",
      modified: "Classification modified",
      rejected: "Rejected",
      deleted: "Deleted",
    },
  },
  "zh-CN": {
    title: "工作画像审阅",
    description: "审阅系统对你工作的理解，并在这些推断被使用前进行纠正。",
    systemUnderstanding: "系统理解",
    classification: "分类",
    understanding: "理解内容",
    evidenceSource: "证据来源",
    authorizedDirectory: "来源：已授权的项目目录",
    noEvidence: "暂无目录证据。",
    pendingCount: "{{count}} 条待审阅",
    empty: "当前没有有效的工作画像推断；已删除内容仍保留在审计记录中。",
    confirm: "确认",
    modify: "修改",
    reject: "否定",
    delete: "删除",
    saveCorrection: "保存纠正",
    confidence: "置信度 {{value}}%",
    deleteTitle: "删除这条工作画像推断？",
    deleteDescription: "推断将从画像中移除，但删除前快照会保留在审计记录中。",
    auditTitle: "纠正审计",
    auditEmpty: "确认、修改、否定或删除推断后，操作记录会显示在这里。",
    auditActor: "操作人：{{actor}}",
    auditChange: "{{before}} → {{after}}",
    auditReason: "用户纠正了系统分类。",
    rejectReason: "用户否定了此推断。",
    deleteReason: "用户删除了此推断。",
    category: {
      role: "角色",
      domain: "领域",
      work_type: "工作类型",
      skill: "技能",
      preference: "偏好",
    },
    value: { software_development: "软件开发" },
    status: {
      pending: "待审阅",
      confirmed: "已确认",
      rejected: "已否定",
    },
    auditAction: {
      confirmed: "已确认",
      modified: "已修改分类",
      rejected: "已否定",
      deleted: "已删除",
    },
  },
} as const;

let installed = false;

export function installWorkProfileTranslations() {
  if (installed) return;
  installed = true;
  for (const [locale, translation] of Object.entries(workProfileTranslations)) {
    i18n.addResourceBundle(locale, "common", { workProfile: translation }, true, true);
  }
}
