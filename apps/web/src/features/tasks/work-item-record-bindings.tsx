import { Database, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LocalWorkItem } from "./task-view-types";

function recordBindingStateLabel(state: string, language: string) {
  const labels: Record<string, [string, string]> = {
    resolved: ["已就绪", "Ready"],
    needs_confirmation: ["待确认", "Needs confirmation"],
    stale: ["资料已变化", "Stale"],
    unavailable: ["暂不可用", "Unavailable"],
  };
  return labels[state]?.[language === "zh" ? 0 : 1] ?? state;
}

export function WorkItemRecordBindings({
  item,
  language,
  locked,
  pendingId,
  onRefresh,
  error,
}: {
  item: LocalWorkItem;
  language: string;
  locked: boolean;
  pendingId: string | null;
  onRefresh: (binding: NonNullable<LocalWorkItem["recordBindings"]>[number]) => void;
  error: string | null;
}) {
  const bindings = item.recordBindings ?? [];
  if (!bindings.length) return null;
  return (
    <section className="rounded-xl border border-border p-4" aria-labelledby={`work-item-records-${item.id}`}>
      <div className="flex items-start gap-2">
        <Database className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 id={`work-item-records-${item.id}`} className="text-sm font-semibold">{language === "zh" ? "业务资料" : "Business materials"}</h4>
            <Badge tone="neutral">{bindings.length}</Badge>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {language === "zh" ? "本任务已限定可使用的业务记录；执行时只读取声明的范围。" : "This task has a bounded set of business records; execution reads only the declared scope."}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {bindings.map((binding) => {
          const record = binding.record;
          const purpose = binding.direction === "output"
            ? (language === "zh" ? "结果归档" : "Result archive")
            : binding.role === "required"
              ? (language === "zh" ? "必须使用" : "Required")
              : (language === "zh" ? "可供参考" : "Reference");
          return (
            <div key={binding.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/45 px-3 py-2 text-sm">
              <span className="min-w-[8rem] flex-1 truncate">{record?.title ?? (language === "zh" ? "待生成的业务记录" : "Business record to be created")}</span>
              {record?.businessKey ? <span className="text-xs text-muted-foreground">{record.businessKey}</span> : null}
              <Badge tone="neutral">{purpose}</Badge>
              <Badge tone={binding.resolution.state === "resolved" ? "success" : "warning"}>
                {recordBindingStateLabel(binding.resolution.state, language)}
              </Badge>
              {binding.selection.fieldKeys.length ? <span className="max-w-[16rem] truncate text-xs text-muted-foreground">{binding.selection.fieldKeys.join(", ")}</span> : null}
              {!locked && ["stale", "needs_confirmation"].includes(binding.resolution.state) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pendingId === binding.id}
                  onClick={() => onRefresh(binding)}
                >
                  {pendingId === binding.id ? <RefreshCw className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                  {language === "zh" ? "刷新并确认" : "Refresh and confirm"}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {locked && bindings.some((binding) => ["stale", "needs_confirmation"].includes(binding.resolution.state)) ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {language === "zh" ? "任务已开始执行，当前资料快照已固定；如需更换资料，请创建新的任务。" : "Execution has started, so the current material snapshot is fixed. Create a new task to use different material."}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
