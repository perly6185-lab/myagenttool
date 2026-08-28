import { useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, FileText, GitBranch, Loader2, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  confirmPrivateTutorAuthoredContent,
  confirmPrivateTutorKnowledgeMapDraft,
  generatePrivateTutorAuthoredContent,
  publishPrivateTutorKnowledgeMapDraft,
  updatePrivateTutorAuthoredContent,
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
  const mapConfirmed = draft.confirmation?.revision === draft.revision;
  const activeAuthoredContent = draft.authoredContentVersions?.find((item) => item.version === draft.activeAuthoredContentVersion) ?? null;
  const authoredErrorCount = activeAuthoredContent?.validationIssues.filter((issue) => issue.severity === "error").length ?? 0;
  const contentConfirmed = activeAuthoredContent?.status === "confirmed"
    && activeAuthoredContent.confirmation?.revision === activeAuthoredContent.revision;
  const canConfirm = errorCount === 0 && draft.draftKnowledgeComponents.length > 0 && !mapConfirmed;
  const canAuthor = errorCount === 0 && mapConfirmed && !activeAuthoredContent;
  const canConfirmContent = mapConfirmed && Boolean(activeAuthoredContent) && authoredErrorCount === 0 && !contentConfirmed;
  const canPublish = errorCount === 0 && mapConfirmed && contentConfirmed;

  const selectedKc = draft.draftKnowledgeComponents.find((kc) => kc.id === selectedKcId);
  const selectedSourceRefs = selectedKc?.sourceRefs?.length ? selectedKc.sourceRefs : selectedKc?.sourceRef ? [selectedKc.sourceRef] : [];
  const selectedSections = selectedSourceRefs.map((ref) => ({
    ref,
    section: material.sections.find((section) => section.id === ref.sectionId),
  })).filter((item) => item.section);
  const selectedAuthoredContent = activeAuthoredContent?.knowledgeContents.find((item) => item.knowledgeId === selectedKcId) ?? null;

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

  async function confirm() {
    setBusy(true);
    setError("");
    setSaveMessage("");
    try {
      const saved = await updatePrivateTutorKnowledgeMapDraft(draft.id, {
        packageName: draft.packageName,
        subjectId: draft.subjectId,
        domain: draft.domain,
        draftModules: draft.draftModules,
        draftTopics: draft.draftTopics,
        draftKnowledgeComponents: draft.draftKnowledgeComponents,
      });
      if (saved.validationIssues.some((issue) => issue.severity === "error")) {
        setDraft(saved);
        setError("知识地图仍有校验错误，请修正后再确认。");
        return;
      }
      const confirmedDraft = await confirmPrivateTutorKnowledgeMapDraft(draft.id, {
        expectedRevision: saved.revision,
        acknowledgeSourceReview: true,
      });
      setDraft(confirmedDraft);
      setSaveMessage("来源与知识结构已确认，可以生成教学内容。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认失败，请检查来源和知识结构。");
    } finally {
      setBusy(false);
    }
  }

  async function authorContent(forceRegenerate = false) {
    setBusy(true);
    setError("");
    setSaveMessage("");
    try {
      const result = await generatePrivateTutorAuthoredContent(draft.id, { forceRegenerate });
      setDraft(result.draft);
      setSaveMessage(`教学内容 v${result.authoredContent.version} 已生成，请逐项复核讲解、题目、参考答案和评分锚点。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成教学内容失败，请重新确认知识地图。" );
    } finally {
      setBusy(false);
    }
  }

  async function confirmContent() {
    if (!activeAuthoredContent) return;
    setBusy(true);
    setError("");
    setSaveMessage("");
    try {
      const saved = await updatePrivateTutorAuthoredContent(draft.id, {
        knowledgeContents: activeAuthoredContent.knowledgeContents,
      });
      if (saved.authoredContent.validationIssues.some((issue) => issue.severity === "error")) {
        setDraft(saved.draft);
        setError("教学内容仍有校验错误，请修正后再确认。" );
        return;
      }
      const result = await confirmPrivateTutorAuthoredContent(draft.id, {
        expectedRevision: saved.authoredContent.revision,
        acknowledgeContentReview: true,
      });
      setDraft(result.draft);
      setSaveMessage("教学内容和评分锚点已确认，可以发布。" );
    } catch (err) {
      setError(err instanceof Error ? err.message : "教学内容确认失败，请检查校验结果。" );
    } finally {
      setBusy(false);
    }
  }

  async function saveAuthoredContent() {
    if (!activeAuthoredContent) return;
    setBusy(true);
    setError("");
    setSaveMessage("");
    try {
      const result = await updatePrivateTutorAuthoredContent(draft.id, {
        knowledgeContents: activeAuthoredContent.knowledgeContents,
      });
      setDraft(result.draft);
      setSaveMessage("教学内容修订已保存，需重新确认后才能发布。" );
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存教学内容失败，请检查来源约束。" );
    } finally {
      setBusy(false);
    }
  }

  function updateSelectedAuthoredContent(updater: (item: NonNullable<typeof selectedAuthoredContent>) => NonNullable<typeof selectedAuthoredContent>) {
    if (!activeAuthoredContent || !selectedAuthoredContent) return;
    const nextContent = {
      ...activeAuthoredContent,
      status: "in_review" as const,
      confirmation: null,
      knowledgeContents: activeAuthoredContent.knowledgeContents.map((item) =>
        item.knowledgeId === selectedAuthoredContent.knowledgeId ? updater(item) : item),
    };
    setDraft({
      ...draft,
      status: "content_in_review",
      authoredContentVersions: draft.authoredContentVersions.map((item) =>
        item.version === nextContent.version ? nextContent : item),
    });
  }

  async function publish() {
    setBusy(true);
    setError("");
    try {
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
    setDraft({ ...draft, draftKnowledgeComponents: nextKcs, confirmation: null, activeAuthoredContentVersion: null, status: "in_review" });
  }

  function removeKc(kcId: string) {
    const nextKcs = draft.draftKnowledgeComponents.filter((kc) => kc.id !== kcId).map((kc) => ({
      ...kc,
      prerequisiteDraftIds: kc.prerequisiteDraftIds.filter((id) => id !== kcId),
    }));
    setDraft({ ...draft, draftKnowledgeComponents: reorderKnowledge(nextKcs), confirmation: null, activeAuthoredContentVersion: null, status: "in_review" });
    if (selectedKcId === kcId) setSelectedKcId(null);
  }

  function togglePrerequisite(kcId: string, prereqId: string) {
    const kc = draft.draftKnowledgeComponents.find((k) => k.id === kcId);
    if (!kc) return;
    const has = kc.prerequisiteDraftIds.includes(prereqId);
    const nextIds = has
      ? kc.prerequisiteDraftIds.filter((id) => id !== prereqId)
      : [...kc.prerequisiteDraftIds, prereqId];
    const nextKcs = draft.draftKnowledgeComponents.map((item) =>
      item.id === kcId ? { ...item, prerequisiteDraftIds: nextIds } : item);
    setDraft({ ...draft, draftKnowledgeComponents: nextKcs, confirmation: null, activeAuthoredContentVersion: null, status: "in_review" });
    void saveDraft({ draftKnowledgeComponents: nextKcs });
  }

  function moveSelected(direction: -1 | 1) {
    if (!selectedKc) return;
    const sameTopic = draft.draftKnowledgeComponents.filter((item) => item.topicId === selectedKc.topicId);
    const currentIndex = sameTopic.findIndex((item) => item.id === selectedKc.id);
    const target = sameTopic[currentIndex + direction];
    if (!target) return;
    const next = [...draft.draftKnowledgeComponents];
    const left = next.findIndex((item) => item.id === selectedKc.id);
    const right = next.findIndex((item) => item.id === target.id);
    [next[left], next[right]] = [next[right], next[left]];
    const reordered = reorderKnowledge(next);
    setDraft({ ...draft, draftKnowledgeComponents: reordered, confirmation: null, activeAuthoredContentVersion: null, status: "in_review" });
    void saveDraft({ draftKnowledgeComponents: reordered });
  }

  function splitSelected() {
    if (!selectedKc) return;
    let suffix = 2;
    while (draft.draftKnowledgeComponents.some((item) => item.id === `${selectedKc.id}_part_${suffix}`)) suffix += 1;
    const secondId = `${selectedKc.id}_part_${suffix}`;
    const objectives = selectedKc.learningObjectives.length > 1
      ? selectedKc.learningObjectives
      : [selectedKc.learningObjectives[0] ?? "理解并能够解释本节核心概念"];
    const midpoint = Math.max(1, Math.ceil(objectives.length / 2));
    const first = { ...selectedKc, name: `${selectedKc.name}（一）`, learningObjectives: objectives.slice(0, midpoint) };
    const second = {
      ...selectedKc,
      id: secondId,
      name: `${selectedKc.name}（二）`,
      learningObjectives: objectives.slice(midpoint).length ? objectives.slice(midpoint) : [...objectives],
      prerequisiteDraftIds: [selectedKc.id],
    };
    const index = draft.draftKnowledgeComponents.findIndex((item) => item.id === selectedKc.id);
    const next = reorderKnowledge([
      ...draft.draftKnowledgeComponents.slice(0, index),
      first,
      second,
      ...draft.draftKnowledgeComponents.slice(index + 1),
    ]);
    setDraft({ ...draft, draftKnowledgeComponents: next, confirmation: null, activeAuthoredContentVersion: null, status: "in_review" });
    void saveDraft({ draftKnowledgeComponents: next });
  }

  function mergeWithNext() {
    if (!selectedKc) return;
    const sameTopic = draft.draftKnowledgeComponents.filter((item) => item.topicId === selectedKc.topicId);
    const nextKnowledge = sameTopic[sameTopic.findIndex((item) => item.id === selectedKc.id) + 1];
    if (!nextKnowledge) return;
    const sourceRefs = uniqueSourceRefs([
      ...(selectedKc.sourceRefs ?? (selectedKc.sourceRef ? [selectedKc.sourceRef] : [])),
      ...(nextKnowledge.sourceRefs ?? (nextKnowledge.sourceRef ? [nextKnowledge.sourceRef] : [])),
    ]);
    const merged = {
      ...selectedKc,
      name: `${selectedKc.name} / ${nextKnowledge.name}`,
      shortDescription: [selectedKc.shortDescription, nextKnowledge.shortDescription].filter(Boolean).join("；"),
      learningObjectives: [...new Set([...selectedKc.learningObjectives, ...nextKnowledge.learningObjectives])],
      prerequisiteDraftIds: [...new Set([...selectedKc.prerequisiteDraftIds, ...nextKnowledge.prerequisiteDraftIds])]
        .filter((id) => id !== selectedKc.id && id !== nextKnowledge.id),
      sourceRef: sourceRefs[0],
      sourceRefs,
      candidateQuestions: [...(selectedKc.candidateQuestions ?? []), ...(nextKnowledge.candidateQuestions ?? [])]
        .map((question, index) => ({ ...question, id: `q_${index + 1}` })),
    };
    const next = reorderKnowledge(draft.draftKnowledgeComponents
      .filter((item) => item.id !== nextKnowledge.id)
      .map((item) => {
        if (item.id === selectedKc.id) return merged;
        return {
          ...item,
          prerequisiteDraftIds: [...new Set(item.prerequisiteDraftIds
            .map((id) => id === nextKnowledge.id ? selectedKc.id : id))],
        };
      }));
    setDraft({ ...draft, draftKnowledgeComponents: next, confirmation: null, activeAuthoredContentVersion: null, status: "in_review" });
    void saveDraft({ draftKnowledgeComponents: next });
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
              onChange={(e) => setDraft({ ...draft, packageName: e.target.value, confirmation: null, activeAuthoredContentVersion: null, status: "in_review" })}
              className="mt-1 w-full max-w-md rounded border-none bg-transparent p-0 text-xl font-bold focus:ring-0"
              aria-label="内容包名称"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {draft.subjectDetection?.mode === "automatic" ? "自动识别" : "已选择"}：{draft.subjectId === "math" ? "数学" : draft.subjectId}
              {draft.evaluationSubjectId ? ` · ${draft.evaluationSubjectId} 评测器` : ""}
              {draft.aggregation?.strategy === "textbook_units_v1" ? ` · 按 ${draft.aggregation.detectedUnitCount} 个单元合并` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveMessage ? <span className="text-xs text-emerald-600">{saveMessage}</span> : null}
            <Button variant="secondary" onClick={onClose} disabled={busy}>返回</Button>
            <Button variant="secondary" onClick={() => void saveDraft({})} disabled={busy}>保存草稿</Button>
            <Button variant="secondary" onClick={() => void confirm()} disabled={!canConfirm || busy}>
              {mapConfirmed ? "知识地图已确认" : "确认来源与结构"}
            </Button>
            {canAuthor ? <Button variant="secondary" onClick={() => void authorContent()} disabled={busy}>生成教学内容</Button> : null}
            {activeAuthoredContent ? <Button variant="secondary" onClick={() => void authorContent(true)} disabled={busy}>重新生成</Button> : null}
            {activeAuthoredContent ? (
              <Button variant="secondary" onClick={() => void confirmContent()} disabled={!canConfirmContent || busy}>
                {contentConfirmed ? "教学内容已确认" : "确认教学内容"}
              </Button>
            ) : null}
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
                {mapConfirmed ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-3" /> 地图已确认</span> : null}
                {activeAuthoredContent ? <span className="flex items-center gap-1 text-sky-600">教学内容 v{activeAuthoredContent.version}</span> : null}
                {contentConfirmed ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-3" /> 内容已确认</span> : null}
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
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => moveSelected(-1)}>上移</Button>
                    <Button size="sm" variant="secondary" onClick={() => moveSelected(1)}>下移</Button>
                    <Button size="sm" variant="secondary" onClick={splitSelected}>拆分</Button>
                    <Button size="sm" variant="secondary" onClick={mergeWithNext}>与下一项合并</Button>
                  </div>
                  <label className="block text-sm font-medium">
                    知识点名称
                    <input
                      value={selectedKc.name}
                      onChange={(e) => updateKc(selectedKc.id, { name: e.target.value })}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block text-sm font-medium">
                    学习目标 (每行一条)
                    <textarea
                      value={selectedKc.learningObjectives.join("\n")}
                      onChange={(e) => updateKc(selectedKc.id, { learningObjectives: e.target.value.split("\n").filter(Boolean) })}
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
                            onChange={() => togglePrerequisite(selectedKc.id, kc.id)}
                            className="size-4 accent-emerald-600"
                          />
                          <span className="truncate">{kc.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedSections.map(({ ref, section }) => section ? (
                  <div key={`${ref.sectionId}-${ref.pageNumber ?? "line"}`} className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-sky-800 dark:text-sky-200">
                      <BookOpen className="size-4" />
                      原文对照 {ref.pageNumber ? `(第 ${ref.pageNumber} 页)` : ""}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{section.title} · 行 {section.lineStart} - {section.lineEnd}</p>
                    <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-background p-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {ref.excerpt}
                    </div>
                  </div>
                ) : null)}

                {selectedAuthoredContent ? (
                  <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">教学内容复核 · v{activeAuthoredContent?.version}</p>
                        <p className="mt-1 text-xs text-muted-foreground">讲解和参考答案必须来自原文；教学提示和问题标为规则生成。</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-background px-2 py-1 text-xs">{contentConfirmed ? "已确认" : "待确认"}</span>
                        <Button size="sm" variant="secondary" onClick={() => void saveAuthoredContent()} disabled={busy}>保存教学内容</Button>
                      </div>
                    </div>
                    <label className="block text-xs font-medium text-muted-foreground">
                      原文讲解
                      <textarea
                        aria-label="原文讲解"
                        value={selectedAuthoredContent.teachingContent.explanation}
                        onChange={(event) => updateSelectedAuthoredContent((item) => ({
                          ...item,
                          teachingContent: { ...item.teachingContent, explanation: event.target.value },
                        }))}
                        rows={4}
                        className="mt-1 w-full rounded-lg border bg-background p-2 text-sm leading-relaxed text-foreground"
                      />
                    </label>
                    <label className="block text-xs font-medium text-muted-foreground">
                      学习引导（规则生成）
                      <textarea
                        aria-label="学习引导"
                        value={selectedAuthoredContent.teachingContent.guidance}
                        onChange={(event) => updateSelectedAuthoredContent((item) => ({
                          ...item,
                          teachingContent: { ...item.teachingContent, guidance: event.target.value },
                        }))}
                        rows={2}
                        className="mt-1 w-full rounded-lg border bg-background p-2 text-sm text-foreground"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <span className="rounded bg-background p-2">诊断 {selectedAuthoredContent.diagnosticQuestions.length}</span>
                      <span className="rounded bg-background p-2">辅导 {selectedAuthoredContent.tutoringQuestions.length}</span>
                      <span className="rounded bg-background p-2">独立练习 {selectedAuthoredContent.dailyQuestions.length}</span>
                      <span className="rounded bg-background p-2">复习 {selectedAuthoredContent.reviewQuestions.length}</span>
                    </div>
                    {selectedAuthoredContent.dailyQuestions[0] ? (
                      <div className="space-y-3 rounded-lg bg-background p-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">
                            独立练习
                            <textarea
                              aria-label="独立练习题目"
                              value={selectedAuthoredContent.dailyQuestions[0].prompt}
                              onChange={(event) => updateSelectedAuthoredContent((item) => ({
                                ...item,
                                dailyQuestions: item.dailyQuestions.map((question, index) =>
                                  index === 0 ? { ...question, prompt: event.target.value } : question),
                              }))}
                              rows={2}
                              className="mt-1 w-full rounded-lg border bg-card p-2 text-sm text-foreground"
                            />
                          </label>
                        </div>
                        {selectedAuthoredContent.dailyQuestions[0].kind === "rubric_response" ? <>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">
                              参考答案（原文约束）
                              <textarea
                                aria-label="参考答案"
                                value={selectedAuthoredContent.dailyQuestions[0].referenceAnswer ?? ""}
                                onChange={(event) => updateSelectedAuthoredContent((item) => ({
                                  ...item,
                                  dailyQuestions: item.dailyQuestions.map((question, index) =>
                                    index === 0 ? { ...question, referenceAnswer: event.target.value } : question),
                                }))}
                                rows={3}
                                className="mt-1 w-full rounded-lg border bg-card p-2 text-sm leading-relaxed text-foreground"
                              />
                            </label>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">评分锚点</p>
                            <div className="mt-2 space-y-2">
                            {(selectedAuthoredContent.dailyQuestions[0].rubric?.anchors ?? []).map((anchor) => (
                              <div key={anchor.id} className="rounded border p-2">
                                <p className="font-medium">{anchor.band}</p>
                                <p className="mt-1 text-muted-foreground">{anchor.description}</p>
                                <label className="mt-1 block text-muted-foreground">
                                  示例
                                  <textarea
                                    aria-label={`${anchor.band} 评分锚点示例`}
                                    value={anchor.sample}
                                    onChange={(event) => updateSelectedAuthoredContent((item) => ({
                                      ...item,
                                      dailyQuestions: item.dailyQuestions.map((question, questionIndex) =>
                                        questionIndex === 0 ? {
                                          ...question,
                                          rubric: {
                                            ...question.rubric!,
                                            anchors: question.rubric!.anchors.map((candidate) =>
                                              candidate.id === anchor.id ? { ...candidate, sample: event.target.value } : candidate),
                                          },
                                        } : question),
                                    }))}
                                    rows={2}
                                    className="mt-1 w-full rounded border bg-card p-2 text-foreground"
                                  />
                                </label>
                              </div>
                            ))}
                            </div>
                          </div>
                        </> : (
                          <div className="rounded border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/30">
                            <p className="font-medium">数学专用评测 · {selectedAuthoredContent.dailyQuestions[0].kind}</p>
                            {selectedAuthoredContent.dailyQuestions[0].kind === "numeric" ? (
                              <label className="mt-2 block text-muted-foreground">确定性答案
                                <input aria-label="数学确定性答案" value={selectedAuthoredContent.dailyQuestions[0].expectedAnswer ?? ""} onChange={(event) => updateSelectedAuthoredContent((item) => ({ ...item, dailyQuestions: item.dailyQuestions.map((question, index) => index === 0 ? { ...question, expectedAnswer: event.target.value } : question) }))} className="mt-1 h-9 w-full rounded border bg-card px-2 text-foreground" />
                              </label>
                            ) : <p className="mt-2 text-muted-foreground">正确选项：{selectedAuthoredContent.dailyQuestions[0].expectedChoice}</p>}
                          </div>
                        )}
                        <p className="text-xs text-amber-700 dark:text-amber-300">当前题目仅形成练习反馈；M7.4 运行时验证前不写入高置信度掌握证据。</p>
                      </div>
                    ) : null}
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

function reorderKnowledge(items: DraftKnowledgeComponent[]) {
  return items.map((item, index) => ({ ...item, orderIndex: index + 1 }));
}

function uniqueSourceRefs(refs: NonNullable<DraftKnowledgeComponent["sourceRefs"]>) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.sourceHash}:${ref.sectionId}:${ref.pageNumber ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
