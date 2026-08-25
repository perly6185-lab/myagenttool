import { Button } from "@/components/ui/button";
import { Eye, SlidersHorizontal } from "lucide-react";

export function WorkItemViewSwitch({
  mode,
  onChange,
  language,
  disabled = false,
}: {
  mode: "summary" | "expert";
  onChange: (mode: "summary" | "expert") => void;
  language: "zh" | "en";
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1" role="group" aria-label={language === "zh" ? "任务视图" : "Task view"}>
      <Button size="sm" variant={mode === "summary" ? "secondary" : "ghost"} aria-pressed={mode === "summary"} disabled={disabled} onClick={() => onChange("summary")}>
        <Eye aria-hidden />{language === "zh" ? "普通视图" : "Simple view"}
      </Button>
      <Button size="sm" variant={mode === "expert" ? "secondary" : "ghost"} aria-pressed={mode === "expert"} disabled={disabled} onClick={() => onChange("expert")}>
        <SlidersHorizontal aria-hidden />{language === "zh" ? "专业视图" : "Professional view"}
      </Button>
    </div>
  );
}
