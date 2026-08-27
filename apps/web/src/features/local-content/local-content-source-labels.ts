export function localContentSourceLabels(language: "zh" | "en"): Record<string, string> {
  return language === "zh"
    ? { article_import: "导入文章", channel_article_import: "Channel 文章", channel_attachment_import: "Channel 附件", mail_archive: "归档邮件", mail_cache: "邮件缓存", local_task: "任务", work_item: "任务", task_input: "任务输入", task_material: "任务资料", task_output: "任务结果" }
    : { article_import: "Imported article", channel_article_import: "Channel article", channel_attachment_import: "Channel attachment", mail_archive: "Archived mail", mail_cache: "Mail cache", local_task: "Task", work_item: "Task", task_input: "Task input", task_material: "Task material", task_output: "Task result" };
}
