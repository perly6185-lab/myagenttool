import { ArrowRight, Bot, Database, MessageSquareText, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalWorkItem } from "./task-view-types";

type TaskContextSummary = NonNullable<LocalWorkItem["taskContextSummary"]>;

const PROVIDER_LABELS: Record<string, [string, string]> = {
  wechat_ilink: ["微信", "WeChat"],
  wecom: ["企业微信", "WeCom"],
  dingtalk: ["钉钉", "DingTalk"],
  feishu: ["飞书", "Feishu"],
  slack: ["Slack", "Slack"],
  teams: ["Teams", "Teams"],
};

function sourceLabel(source: TaskContextSummary["materials"][number]["source"], zh: boolean) {
  const labels = {
    channel_attachment: zh ? "Channel 附件" : "Channel attachment",
    task_file: zh ? "任务文件" : "Task file",
    my_materials: zh ? "我的资料" : "My materials",
    local_resource: zh ? "本地资料" : "Local material",
    remote_resource: zh ? "远程资料" : "Remote material",
    business_record: zh ? "业务记录" : "Business record",
  };
  return labels[source];
}

function roleLabel(role: TaskContextSummary["materials"][number]["role"], zh: boolean) {
  const labels = {
    required_input: zh ? "必须使用" : "Required",
    reference: zh ? "参考" : "Reference",
    query_source: zh ? "查询来源" : "Query source",
    change_target: zh ? "允许修改" : "Change target",
    output: zh ? "结果归档" : "Result archive",
  };
  return labels[role];
}

function originLabel(origin: TaskContextSummary["origin"], zh: boolean) {
  if (origin.kind === "channel") {
    const provider = origin.provider ? PROVIDER_LABELS[origin.provider]?.[zh ? 0 : 1] ?? origin.provider : null;
    return [provider, origin.label].filter(Boolean).join(" · ");
  }
  const labels: Record<string, [string, string]> = {
    manual: ["手工创建", "Created manually"],
    issue: ["外部 Issue", "External issue"],
    meeting: ["会议", "Meeting"],
    email: ["邮件", "Email"],
    chat: ["聊天", "Chat"],
    phone: ["电话", "Phone"],
    import: ["导入", "Import"],
  };
  return labels[origin.kind]?.[zh ? 0 : 1] ?? origin.label;
}

function methodLabel(method: TaskContextSummary["method"], zh: boolean) {
  if (method.kind === "template") return method.name;
  if (method.name === "处理方式待确认") return zh ? method.name : "Method needs confirmation";
  if (method.name === "本任务方案") return zh ? method.name : "This task's plan";
  return method.name;
}

export function WorkItemContextCard({
  summary,
  language,
  onOpenChannel,
}: {
  summary: TaskContextSummary | null | undefined;
  language: "zh" | "en";
  onOpenChannel?: () => void;
}) {
  if (!summary) return null;
  const zh = language === "zh";
  const visibleMaterials = summary.materials.slice(0, 5);
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/[0.025] p-4" aria-labelledby="task-context-summary-title" data-testid="work-item-context-card">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Route className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h4 id="task-context-summary-title" className="text-sm font-semibold">{zh ? "这项任务会怎么完成" : "How this task will be completed"}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {zh ? "来源、处理方式、资料范围和结果去向属于同一项任务。" : "The source, method, material scope, and destination belong to the same task."}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-background/80 px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><MessageSquareText className="size-3.5" aria-hidden />{zh ? "需求来源" : "Request source"}</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>{originLabel(summary.origin, zh)}</span>
            {summary.origin.kind === "channel" && summary.origin.sourceMessageCount > 1 ? <Badge tone="neutral">{zh ? `${summary.origin.sourceMessageCount} 条相关消息` : `${summary.origin.sourceMessageCount} related messages`}</Badge> : null}
            {summary.origin.kind === "channel" && onOpenChannel ? <Button size="sm" variant="ghost" onClick={onOpenChannel}>{zh ? "查看 Channel" : "Open Channel"}<ArrowRight aria-hidden /></Button> : null}
          </dd>
        </div>

        <div className="rounded-lg bg-background/80 px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bot className="size-3.5" aria-hidden />{zh ? "处理方式" : "Method"}</dt>
          <dd className="mt-1 text-sm font-medium">
            {methodLabel(summary.method, zh)}
            {summary.method.version != null ? <Badge className="ml-2" tone="neutral">v{summary.method.version}</Badge> : null}
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              {summary.method.expectedOutput
                ? `${zh ? "预计得到" : "Expected"}：${summary.method.expectedOutput}`
                : summary.method.kind === "template" ? (zh ? "使用已保存模板" : "Uses a saved template") : (zh ? "按本任务方案处理" : "Uses this task's plan")}
            </span>
          </dd>
        </div>

        <div className="rounded-lg bg-background/80 px-3 py-2.5 sm:col-span-2">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Database className="size-3.5" aria-hidden />{zh ? "本任务使用的资料" : "Materials for this task"}</dt>
          <dd className="mt-2">
            {visibleMaterials.length ? (
              <ul className="flex flex-wrap gap-2">
                {visibleMaterials.map((material) => (
                  <li key={material.id} className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm">
                    <span className="max-w-[18rem] truncate">{material.title}</span>
                    <Badge tone="neutral">{sourceLabel(material.source, zh)}</Badge>
                    <Badge tone={material.role === "change_target" ? "warning" : "neutral"}>{roleLabel(material.role, zh)}</Badge>
                  </li>
                ))}
                {summary.materials.length > visibleMaterials.length ? <li className="self-center text-xs text-muted-foreground">+{summary.materials.length - visibleMaterials.length}</li> : null}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{zh ? "未指定额外资料，只使用任务说明和项目内容。" : "No extra materials; only the task description and project content are used."}</p>}
          </dd>
        </div>

        <div className="rounded-lg bg-background/80 px-3 py-2.5 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">{zh ? "结果去向" : "Result destination"}</dt>
          <dd className="mt-1 text-sm font-medium">
            {summary.delivery.destination === "channel"
              ? (zh ? `先在任务中确认，再回传到 ${summary.delivery.label}` : `Review in the task first, then return it to ${summary.delivery.label}`)
              : (zh ? "保留在当前任务中，等待你确认" : "Keep it in this task for your review")}
          </dd>
        </div>
      </dl>
    </section>
  );
}
