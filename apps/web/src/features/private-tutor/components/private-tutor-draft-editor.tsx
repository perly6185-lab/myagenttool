import { useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, FileText, GitBranch, Loader2, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  publishPrivateTutorKnowledgeMapDraft,
  updatePrivateTutorKnowledgeMapDraft,
  type KnowledgeMapDraft,
  type MaterialDocument,
} from "../private-tutor-api";
import type { DraftKnowledgeComponent } from "../private-tutor-model";

interface PrivateTutorDraftEditorProps {
  material: MaterialDocument;
  draft: KnowledgeMapDraft;
  onClose: () => void;
  onPublished: (packageId: string) => void;
}

export function PrivateTutorDraftEditor({ material, draft: initialDraft, onClose, onPublished }: PrivateTutorDraftEditorProps) {
  const [draft, setDraft] = useState<KnowledgeMapDraft>(initialDraft);
  const [selectedKcId, setSelectedKcId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const errorCount = draft.validationIssues.filter((i) => i.severity === "error").length;
  const warningCount = draft.validationIssues.filter((i) => i.severity === "warning").length;
  const canPublish = errorCount === 0 && draft.draftKnowledgeComponents.length > 0;

  const selectedKc = draft.draftKnowledgeComponents.find((kc) => kc.id === selectedKcId);
  const selectedSection = selectedKc?.sourceRef
    ? material.sections.find((s) => s.id === selectedKc.sourceRef?.sectionId)
    : null;

  async function saveDraft(updates: Partial<KnowledgeMapDraft>) {
    setBusy(true);
    setError("");
    setSaveMessage("");
    try {
      const saved = await updatePrivateTutorKnowledgeMapDraft(draft.id, {
        packageName: updates.packageName ?? draft.packageName,
        subjectId: updates.subjectId ?? draft.subjectId,
        domain: updates.domain ?? draft.domain,
        draftModules: updates.draftModules ?? draft.draftModules,
        draftTopics: updates.draftTopics ?? draft.draftTopics,
        draftKnowledgeComponents: updates.draftKnowledgeComponents ?? draft.draftKnowledgeComponents,
      });
      setDraft(saved);
      setSaveMessage("草稿已保存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError("");
    try {
      await saveDraft({});
      const result = await publishPrivateTutorKnowledgeMapDraft(draft.id);
      onPublished(result.packageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败，请检查草稿校验结果。");
    } finally {
      setBusy(false);
    }
  }

  function updateKc(kcId: string, updates: Partial<DraftKnowledgeComponent>) {
    const nextKcs = draft.draftKnowledgeComponents.map((kc) => (kc.id === kcId ? { ...kc, ...updates } : kc));
    setDraft({ ...draft, draftKnowledgeComponents: nextKcs });
  }

  function removeKc(kcId: string) {
    const nextKcs = draft.draftKnowledgeComponents.filter((kc) => kc.id !== kcId).map((kc) => ({
      ...kc,
      prerequisiteDraftIds: kc.prerequisiteDraftIds.filter((id) => id !== kcId),
    }));
    setDraft({ ...draft, draftKnowledgeComponents: nextKcs });
    if (selectedKcId === kcId) setSelectedKcId(null);
  }

  function togglePrerequisite(kcId: string, prereqId: string) {
    const kc = draft.draftKnowledgeComponents.find((k) => k.id === kcId);
    if (!kc) return;
    const has = kc.prerequisiteDraftIds.includes(prereqId);
    const nextIds = has
      ? kc.prerequisiteDraftIds.filter((id) => id !== prereqId)
      : [...kc.prerequisiteDraftIds, prereqId];
    updateKc(kcId, { prerequisiteDraftIds: nextIds });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" />
              <span>{material.fileName}</span>
              <ChevronRight className="size-3" />
              <span>知识地图草稿</span>
            </div>
            <input
              value={draft.packageName}
              onChange={(e) => setDraft({ ...draft, packageName: e.target.value })}
              onBlur={() => void saveDraft({ packageName: draft.packageName })}
              className="mt-1 w-full max-w-md rounded border-none bg-transparent p-0 text-xl font-bold focus:ring-0"
              aria-label="内容包名称"
            />
          </div>
          <div className="flex items-center gap-3">
            {saveMessage ? <span className="text-xs text-emerald-600">{saveMessage}</span> : null}
            <Button variant="secondary" onClick={onClose} disabled={busy}>返回</Button>
            <Button onClick={() => void publish()} disabled={!canPublish || busy}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              发布为学习内容包
            </Button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-1/2 flex-col border-r overflow-y-auto bg-muted/10 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">知识结构</h3>
              <div className="flex gap-2 text-xs">
                {errorCount > 0 ? <span className="flex items-center gap-1 text-rose-600"><XCircle className="size-3" /> {errorCount} 个错误</span> : null}
                {warningCount > 0 ? <span className="flex items-center gap-1 text-amber-600"><GitBranch className="size-3" /> {warningCount} 个提示</span> : null}
                {errorCount === 0 && warningCount === 0 ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-3" /> 校验通过</span> : null}
              </div>
            </div>

            <div className="space-y-6">
              {draft.draftModules.map((mod) => {
                const modTopics = draft.draftTopics.filter((t) => t.moduleId === mod.id);
                return (
                  <div key={mod.id} className="rounded-xl border bg-card p-4 shadow-sm">
                    <h4 className="font-bold text-emerald-800 dark:text-emerald-200">{mod.name}</h4>
                    <div className="mt-3 space-y-3 pl-4 border-l-2 border-emerald-100 dark:border-emerald-900">
                      {modTopics.map((topic) => {
                        const topicKcs = draft.draftKnowledgeComponents.filter((kc) => kc.topicId === topic.id);
                        return (
                          <div key={topic.id}>
                            <p className="text-sm font-semibold">{topic.name}</p>
                            <div className="mt-2 space-y-2">
                              {topicKcs.map((kc) => (
                                <div
                                  key={kc.id}
                                  role="button"
                                  tabIndex={0}
                                  className={cn(
                                    "group flex items-start justify-between rounded-lg border p-3 transition-colors cursor-pointer",
                                    selectedKcId === kc.id ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30" : "bg-background hover:border-emerald-300"
                                  )}
                                  onClick={() => setSelectedKcId(kc.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setSelectedKcId(kc.id);
                                    }
                                  }}
                                >
                                  <div className="flex-1">
                                    <p className="text-sm font-medium">{kc.name}</p>
                                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{kc.shortDescription ?? ""}</p>
                                    {kc.prerequisiteDraftIds.length > 0 ? (
                                      <p className="mt-1 text-[10px] text-sky-600 dark:text-sky-400">前置: {kc.prerequisiteDraftIds.length} 个知识点</p>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); removeKc(kc.id); }}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-rose-600"
                                    aria-label="删除知识点"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex w-1/2 flex-col overflow-y-auto p-6">
            {selectedKc ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold">编辑知识点</h3>
                  <p className="text-sm text-muted-foreground">调整名称、目标与先修关系</p>
                </div>

                <div className="space-y-4 rounded-xl border bg-card p-4">
                  <label className="block text-sm font-medium">
                    知识点名称
                    <input
                      value={selectedKc.name}
                      onChange={(e) => updateKc(selectedKc.id, { name: e.target.value })}
                      onBlur={() => void saveDraft({ draftKnowledgeComponents: draft.draftKnowledgeComponents })}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block text-sm font-medium">
                    学习目标 (每行一条)
                    <textarea
                      value={selectedKc.learningObjectives.join("\n")}
                      onChange={(e) => updateKc(selectedKc.id, { learningObjectives: e.target.value.split("\n").filter(Boolean) })}
                      onBlur={() => void saveDraft({ draftKnowledgeComponents: draft.draftKnowledgeComponents })}
                      rows={3}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    />
                  </label>

                  <div>
                    <p className="text-sm font-medium">先修知识点</p>
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-2">
                      {draft.draftKnowledgeComponents.filter((kc) => kc.id !== selectedKc.id).map((kc) => (
                        <label key={kc.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedKc.prerequisiteDraftIds.includes(kc.id)}
                            onChange={() => {
                              togglePrerequisite(selectedKc.id, kc.id);
                              void saveDraft({ draftKnowledgeComponents: draft.draftKnowledgeComponents });
                            }}
                            className="size-4 accent-emerald-600"
                          />
                          <span className="truncate">{kc.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedSection ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-sky-800 dark:text-sky-200">
                      <BookOpen className="size-4" />
                      原文对照 {selectedSection.pageNumber ? `(第 ${selectedSection.pageNumber} 页)` : ""}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">行 {selectedSection.lineStart} - {selectedSection.lineEnd}</p>
                    <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-background p-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {selectedSection.content}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                <GitBranch className="size-12 opacity-20" />
                <p className="mt-4 text-sm">选择左侧的知识点进行编辑</p>
                <p className="mt-1 text-xs">可以修改名称、目标，并调整先修依赖关系</p>
              </div>
            )}
          </div>
        </div>

        {error ? (
          <div className="border-t bg-rose-50 px-6 py-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {error}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
