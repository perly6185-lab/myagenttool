import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { siteApi } from "./site-api";
import type { SitePilotMilestone, SitePilotScenario, SitePilotSession, SiteStatusAnswer } from "./site-types";

export function useSitePilot() {
  const search = new URLSearchParams(window.location.search);
  const pilotParam = search.get("sitePilot")?.trim() ?? "";
  const enabled = Boolean(pilotParam);
  const campaignCode = pilotParam && pilotParam !== "1" ? pilotParam : undefined;
  const requestedScenario = search.get("pilotTask");
  const assignedScenario = ["first_setup", "content_maintenance", "status_understanding"].includes(requestedScenario ?? "") ? requestedScenario as SitePilotScenario : null;
  const query = useQuery({ queryKey: ["site-pilot-active", campaignCode], queryFn: () => siteApi.activePilotSession(campaignCode), enabled, retry: false });
  const [session, setSession] = useState<SitePilotSession | null>(null);
  const sessionRef = useRef<SitePilotSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<"completed" | "abandoned" | "withdrawn" | null>(null);
  const [invitationStatus, setInvitationStatus] = useState<"available" | "active" | "completed" | "abandoned" | "expired" | "withdrawn" | null>(null);
  useEffect(() => {
    const next = query.data?.session ?? null;
    setSession(next);
    sessionRef.current = next;
    setInvitationStatus(query.data?.invitationStatus ?? null);
  }, [query.data]);
  const keep = useCallback((next: SitePilotSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);
  const start = useCallback(async (scenario: SitePilotScenario) => {
    setPending(true); setError(null); setResult(null);
    try { keep((await siteApi.startPilotSession(scenario, campaignCode)).session); if (campaignCode) setInvitationStatus("active"); } catch (next) { setError(next); } finally { setPending(false); }
  }, [campaignCode, keep]);
  const recordMilestone = useCallback(async (milestone: SitePilotMilestone) => {
    const current = sessionRef.current;
    if (!enabled || !current || current.status !== "active" || current.milestones.some((item) => item.key === milestone)) return;
    try {
      keep((await siteApi.updatePilotSession(current.id, { expectedRevision: current.revision, milestone })).session);
    } catch {
      const fresh = await siteApi.activePilotSession(campaignCode).catch(() => ({ session: null, invitationStatus: null, assignedScenario: null, workspace: null }));
      keep(fresh.session);
      setInvitationStatus(fresh.invitationStatus);
    }
  }, [campaignCode, enabled, keep]);
  const finish = useCallback(async (input: { taskCompleted?: boolean; independent?: boolean; statusAnswer?: SiteStatusAnswer; easeRating: number }) => {
    const current = sessionRef.current;
    if (!current) return;
    setPending(true); setError(null);
    try {
      await siteApi.updatePilotSession(current.id, { expectedRevision: current.revision, action: "complete", outcome: input });
      keep(null); setResult("completed"); if (campaignCode) setInvitationStatus("completed");
    } catch (next) { setError(next); } finally { setPending(false); }
  }, [campaignCode, keep]);
  const abandon = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    setPending(true); setError(null);
    try {
      await siteApi.updatePilotSession(current.id, { expectedRevision: current.revision, action: "abandon" });
      keep(null); setResult("abandoned"); if (campaignCode) setInvitationStatus("abandoned");
    } catch (next) { setError(next); } finally { setPending(false); }
  }, [campaignCode, keep]);
  const withdraw = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    setPending(true); setError(null);
    try { await siteApi.deletePilotSession(current.id); keep(null); setResult("withdrawn"); if (campaignCode) setInvitationStatus("withdrawn"); } catch (next) { setError(next); } finally { setPending(false); }
  }, [campaignCode, keep]);
  return { enabled, campaignCode, assignedScenario: query.data?.assignedScenario ?? assignedScenario, invitationStatus, workspace: query.data?.workspace ?? null, session, loading: enabled && query.isLoading, pending, error, result, start, recordMilestone, finish, abandon, withdraw };
}

export type SitePilotController = ReturnType<typeof useSitePilot>;

export function SitePilotPanel({ pilot, zh, siteExists }: { pilot: SitePilotController; zh: boolean; siteExists: boolean | null }) {
  const [scenario, setScenario] = useState<SitePilotScenario>(pilot.assignedScenario ?? "first_setup");
  const [consent, setConsent] = useState(false);
  const [taskCompleted, setTaskCompleted] = useState(true);
  const [independent, setIndependent] = useState(true);
  const [statusAnswer, setStatusAnswer] = useState<SiteStatusAnswer>("unsure");
  const [easeRating, setEaseRating] = useState(4);
  useEffect(() => {
    if (pilot.session || siteExists == null) return;
    if (pilot.assignedScenario) { if (scenario !== pilot.assignedScenario) setScenario(pilot.assignedScenario); return; }
    if (siteExists && scenario === "first_setup") setScenario("content_maintenance");
    if (!siteExists && scenario !== "first_setup") setScenario("first_setup");
  }, [pilot.assignedScenario, pilot.session, scenario, siteExists]);
  if (!pilot.enabled) return null;
  const labels = zh ? {
    title: "真实用户试用", privacy: "仅记录任务步骤和选择题结果，不采集页面正文、自由文本、账号或云平台凭据。你可以随时撤回并删除本次记录。",
    scenario: "本次任务", first: "首次创建官网", maintenance: "独立修改并保存内容", status: "判断网站是否真正上线",
    taskGuide: "任务说明", estimated: "预计用时", minutes: "约 2 分钟",
    consent: "我已了解并同意记录本次任务步骤", start: "开始试用任务", active: "试用记录中", done: "完成并提交", unfinished: "结束，未完成", withdraw: "撤回并删除记录",
    completed: "是否完成了任务？", independent: "是否在没有他人操作帮助下完成？", statusQuestion: "你认为网站目前是什么状态？", ease: "整体上手难度（5 表示非常容易）",
    private: "仅自己可预览", local: "已生成版本，但互联网访客还不能访问", public: "互联网访客可以访问", unsure: "不确定",
    load: "正在恢复试用任务…", error: "试用记录暂时无法保存；你的站点操作不受影响。",
    submitted: "本次试用已提交，感谢参与。", abandoned: "已记录本次任务未完成。", withdrawn: "本次试用记录已删除。",
    assigned: "任务已由邀请链接分配；链接只允许访问本次临时试用站点，不能访问正式官网。", unavailable: "此任务与当前站点状态不匹配，请联系试用组织者获取正确链接。",
    used: "这个一次性邀请链接已经使用，不能再次提交。需要重试时，请联系试用组织者生成新链接。",
    sandbox: "你正在独立的临时试用站点中操作，不会读取或修改正式官网，也不会使用真实云平台配置。试用数据将在链接到期后清理。",
    sandboxStatus: "这是独立的只读临时站点。请观察当前状态并回答问题；它不会读取或修改正式官网，也不会使用真实云平台配置。",
  } : {
    title: "Real-user pilot", privacy: "Only task milestones and multiple-choice answers are recorded. Page content, free text, accounts, and cloud credentials are never collected. You can withdraw and delete this record at any time.",
    scenario: "Task", first: "Create a website for the first time", maintenance: "Edit and save content independently", status: "Identify whether the website is truly online",
    taskGuide: "Task instructions", estimated: "Estimated time", minutes: "about 2 minutes",
    consent: "I understand and consent to recording task milestones", start: "Start pilot task", active: "Pilot in progress", done: "Complete and submit", unfinished: "End as incomplete", withdraw: "Withdraw and delete",
    completed: "Did you complete the task?", independent: "Did you complete it without someone else operating the product?", statusQuestion: "What is the website's current status?", ease: "Overall ease of use (5 means very easy)",
    private: "Private preview only", local: "Release generated, but not reachable by internet visitors", public: "Reachable by internet visitors", unsure: "Not sure",
    load: "Restoring pilot task…", error: "The pilot record could not be saved. Your site work is unaffected.",
    submitted: "This pilot task was submitted. Thank you.", abandoned: "This task was recorded as incomplete.", withdrawn: "This pilot record was deleted.",
    assigned: "This task was assigned by the invitation link. It can access only this temporary workspace, never the production site.", unavailable: "This task does not match the current site state. Ask the pilot organizer for the correct link.",
    used: "This one-time invitation has already been used and cannot be submitted again. Ask the pilot organizer for a new link if a retry is needed.",
    sandbox: "You are working in an isolated temporary site. It cannot read or change the production website or use real cloud configuration, and it is cleaned up after the link expires.",
    sandboxStatus: "This is an isolated read-only site. Review its current state and answer the question; it cannot access the production site or real cloud configuration.",
  };
  const scenarioLabels = { first_setup: labels.first, content_maintenance: labels.maintenance, status_understanding: labels.status };
  const taskSteps = zh ? {
    first_setup: ["填写“站点名称”和“一句话介绍”；其他信息可以按需填写。", "点击“创建站点”，看到新站点后即完成；无需发布。"],
    content_maintenance: ["打开“首页”，将页面标题改为“欢迎了解山岚工作室”。", "点击“保存修改”，看到“1 项未发布修改”后即完成；无需发布。"],
    status_understanding: ["观察站点名称旁的状态提示；如需确认，可以打开预览。", "开始任务后选择你认为的网站状态，然后提交；不要修改站点。"],
  } : {
    first_setup: ["Enter the Site name and One-line introduction. The other fields are optional.", "Select Create site. The task is complete when the new site appears; do not publish."],
    content_maintenance: ["Open Home and change the page title to “Welcome to Shanlan Studio”.", "Select Save changes. The task is complete when “1 unpublished change” appears; do not publish."],
    status_understanding: ["Review the status beside the site name. Open Preview if you need more context.", "After starting, choose the website state you believe is correct and submit; do not edit the site."],
  } satisfies Record<SitePilotScenario, string[]>;
  const visibleScenario = pilot.session?.scenario ?? scenario;
  const taskUnavailable = siteExists != null && ((scenario === "first_setup" && siteExists) || (scenario !== "first_setup" && !siteExists));
  const invitationUsed = Boolean(pilot.campaignCode && !pilot.session && pilot.invitationStatus && pilot.invitationStatus !== "available");
  if (pilot.loading) return <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{labels.load}</CardContent></Card>;
  return <Card id="site-pilot-panel" className="scroll-mt-4 border-primary/30 bg-primary/[0.02]">
    <CardHeader><div className="flex items-center gap-2"><ClipboardCheck className="size-5 text-primary" /><CardTitle>{labels.title}</CardTitle></div><p className="text-sm leading-5 text-muted-foreground">{labels.privacy}</p></CardHeader>
    <CardContent className="space-y-4">
      {pilot.workspace?.isolated ? <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">{pilot.assignedScenario === "status_understanding" ? labels.sandboxStatus : labels.sandbox}</p> : null}
      <section aria-label={labels.taskGuide} className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{labels.taskGuide}：{scenarioLabels[visibleScenario]}</p><span className="text-xs text-muted-foreground">{labels.estimated} {labels.minutes}</span></div>
        <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">{taskSteps[visibleScenario].map((step, index) => <li key={step} className="flex gap-2"><span className="font-medium text-foreground">{index + 1}.</span><span>{step}</span></li>)}</ol>
      </section>
      {!pilot.session ? <>
        {pilot.result ? <p role="status" className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">{pilot.result === "completed" ? labels.submitted : pilot.result === "abandoned" ? labels.abandoned : labels.withdrawn}</p> : null}
        <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{labels.scenario}</span><Select aria-label={labels.scenario} disabled={Boolean(pilot.assignedScenario)} value={scenario} onChange={(event) => setScenario(event.target.value as SitePilotScenario)}><option value="first_setup" disabled={siteExists === true}>{labels.first}</option><option value="content_maintenance" disabled={siteExists === false}>{labels.maintenance}</option><option value="status_understanding" disabled={siteExists === false}>{labels.status}</option></Select></label>
        {pilot.assignedScenario ? <p className="text-xs text-muted-foreground">{labels.assigned}</p> : null}
        {taskUnavailable ? <p role="alert" className="text-sm text-warning">{labels.unavailable}</p> : null}
        {invitationUsed ? <p role="alert" className="text-sm text-warning">{labels.used}</p> : null}
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{labels.consent}</span></label>
        <Button disabled={!consent || pilot.pending || taskUnavailable || invitationUsed} onClick={() => void pilot.start(scenario)}>{pilot.pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{labels.start}</Button>
      </> : <>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3"><span className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="size-4 text-primary" />{labels.active}：{scenarioLabels[pilot.session.scenario]}</span><span className="text-xs text-muted-foreground">{pilot.session.milestones.length} {zh ? "个步骤已记录" : "milestones"}</span></div>
        {pilot.session.scenario !== "status_understanding" ? <YesNo label={labels.completed} value={taskCompleted} onChange={setTaskCompleted} zh={zh} /> : null}
        {pilot.session.scenario === "content_maintenance" ? <YesNo label={labels.independent} value={independent} onChange={setIndependent} zh={zh} /> : null}
        {pilot.session.scenario === "status_understanding" ? <label className="block space-y-1.5"><span className="text-sm font-medium">{labels.statusQuestion}</span><Select aria-label={labels.statusQuestion} value={statusAnswer} onChange={(event) => setStatusAnswer(event.target.value as SiteStatusAnswer)}><option value="private">{labels.private}</option><option value="local">{labels.local}</option><option value="public">{labels.public}</option><option value="unsure">{labels.unsure}</option></Select></label> : null}
        <label className="block space-y-1.5"><span className="text-sm font-medium">{labels.ease}</span><Select aria-label={labels.ease} value={easeRating} onChange={(event) => setEaseRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value}</option>)}</Select></label>
        <div className="flex flex-wrap gap-2"><Button disabled={pilot.pending} onClick={() => void pilot.finish({ ...(pilot.session?.scenario !== "status_understanding" ? { taskCompleted } : {}), ...(pilot.session?.scenario === "content_maintenance" ? { independent } : {}), ...(pilot.session?.scenario === "status_understanding" ? { statusAnswer } : {}), easeRating })}>{labels.done}</Button><Button variant="secondary" disabled={pilot.pending} onClick={() => void pilot.abandon()}>{labels.unfinished}</Button><Button variant="ghost" disabled={pilot.pending} onClick={() => void pilot.withdraw()}><Trash2 />{labels.withdraw}</Button></div>
      </>}
      {pilot.error ? <p role="alert" className="text-sm text-destructive">{labels.error}</p> : null}
    </CardContent>
  </Card>;
}

function YesNo({ label, value, onChange, zh }: { label: string; value: boolean; onChange: (value: boolean) => void; zh: boolean }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{label}</legend><div className="flex gap-2"><Button type="button" size="sm" variant={value ? "secondary" : "ghost"} aria-pressed={value} onClick={() => onChange(true)}>{zh ? "是" : "Yes"}</Button><Button type="button" size="sm" variant={!value ? "secondary" : "ghost"} aria-pressed={!value} onClick={() => onChange(false)}>{zh ? "否" : "No"}</Button></div></fieldset>;
}
