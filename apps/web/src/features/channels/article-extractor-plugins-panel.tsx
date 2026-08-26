import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/data/use-console-actions";

type Plugin = Awaited<ReturnType<typeof api.listArticleExtractorPlugins>>["plugins"][number];
type InstallPlan = Awaited<ReturnType<typeof api.planArticleExtractorPluginInstall>>;

export function ArticleExtractorPluginsPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [contentSelector, setContentSelector] = useState("article");
  const [titleSelector, setTitleSelector] = useState("h1");
  const [authorSelector, setAuthorSelector] = useState("");
  const [dateSelector, setDateSelector] = useState("time");

  const manifest = useMemo(() => ({
    schemaVersion: 1,
    id: pluginIdForHost(host),
    name: name.trim() || `${host.trim()} 网页采集`,
    version: version.trim(),
    kind: "article_extractor",
    hosts: [host.trim().toLowerCase()],
    extraction: {
      content: selectorList(contentSelector),
      title: selectorList(titleSelector),
      author: selectorList(authorSelector),
      publishedAt: selectorList(dateSelector),
    },
    minimumTextLength: 120,
  }), [authorSelector, contentSelector, dateSelector, host, name, titleSelector, version]);

  async function refresh() {
    setLoading(true);
    try {
      setPlugins((await api.listArticleExtractorPlugins()).plugins);
    } catch (error) {
      setNotice(readError(error, "暂时无法读取网页采集能力。"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { setPlan(null); }, [manifest]);

  async function prepareInstall() {
    setPending(true);
    setNotice(null);
    try {
      setPlan(await api.planArticleExtractorPluginInstall(manifest));
    } catch (error) {
      setNotice(readError(error, "这些规则还不能安全启用，请检查网站和页面位置。"));
    } finally {
      setPending(false);
    }
  }

  async function confirmInstall() {
    if (!plan) return;
    setPending(true);
    setNotice(null);
    try {
      const grant = await api.issueApprovalGrant(plan.approval.action, plan.approval.targetId);
      await api.installArticleExtractorPlugin(plan.manifest, grant.token);
      setPlan(null);
      setNotice("网页采集能力已启用，无需重启。再次发送原链接即可使用。");
      await refresh();
    } catch (error) {
      setNotice(readError(error, "网页采集能力未启用，原有能力保持不变。"));
    } finally {
      setPending(false);
    }
  }

  async function disable(plugin: Plugin) {
    setPending(true);
    setNotice(null);
    try {
      const grant = await api.issueApprovalGrant("article_extractor_plugin.disable", plugin.id);
      await api.disableArticleExtractorPlugin(plugin.pluginId, grant.token);
      setNotice(`${plugin.name} 已停用；已有本地资料不会删除。`);
      await refresh();
    } catch (error) {
      setNotice(readError(error, "停用失败，当前版本仍保持启用。"));
    } finally {
      setPending(false);
    }
  }

  async function activate(plugin: Plugin, targetVersion: string) {
    setPending(true);
    setNotice(null);
    try {
      const grant = await api.issueApprovalGrant("article_extractor_plugin.activate", `${plugin.id}:${targetVersion}`);
      await api.activateArticleExtractorPluginVersion(plugin.pluginId, targetVersion, grant.token);
      setNotice(`${plugin.name} 已切换到 ${targetVersion}，无需重启。`);
      await refresh();
    } catch (error) {
      setNotice(readError(error, "版本切换失败，当前版本保持不变。"));
    } finally {
      setPending(false);
    }
  }

  return (
    <details className="rounded-lg border border-border px-4 py-3" data-testid="article-extractor-plugins">
      <summary className="cursor-pointer text-sm font-medium">高级：网页采集能力</summary>
      <div className="mt-3 space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">普通使用无需配置。仅当某个网站无法读取、且自动开发已生成经过测试的采集规则时，在这里复核并启用。规则只能读取指定 HTTPS 网站和页面位置，不能运行脚本或命令。</p>

        {loading ? <p className="text-xs text-muted-foreground">正在读取已安装能力…</p> : null}
        {plugins.map((plugin) => (
          <Card key={plugin.id}>
            <CardContent className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{plugin.name}</p>
                  <p className="text-xs text-muted-foreground">{plugin.hosts.join("、")} · 当前 {plugin.activeVersion}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={plugin.enabled ? "success" : "neutral"}>{plugin.enabled ? "已启用" : "已停用"}</Badge>
                  {plugin.enabled ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => void disable(plugin)}>停用</Button> : null}
                </div>
              </div>
              {plugin.versions.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">历史版本：</span>
                  {plugin.versions.filter((item) => item.version !== plugin.activeVersion).map((item) => (
                    <Button key={item.version} size="sm" variant="ghost" disabled={pending} onClick={() => void activate(plugin, item.version)}>切换到 {item.version}</Button>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}

        <div className="grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2">
          <Field label="网站域名" hint="精确域名，不使用 *；例如 news.example.com"><Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="news.example.com" /></Field>
          <Field label="能力名称"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="示例网站文章" /></Field>
          <Field label="版本"><Input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" /></Field>
          <Field label="正文位置" hint="必填；可用逗号填写多个备用位置"><Input value={contentSelector} onChange={(event) => setContentSelector(event.target.value)} placeholder="article, .post-content" /></Field>
          <Field label="标题位置"><Input value={titleSelector} onChange={(event) => setTitleSelector(event.target.value)} placeholder="h1, .post-title" /></Field>
          <Field label="作者位置"><Input value={authorSelector} onChange={(event) => setAuthorSelector(event.target.value)} placeholder=".author" /></Field>
          <Field label="发布日期位置"><Input value={dateSelector} onChange={(event) => setDateSelector(event.target.value)} placeholder="time, .published" /></Field>
        </div>

        {plan ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="font-medium">启用前确认</p>
            <p className="mt-1 text-xs text-muted-foreground">只允许读取 {String((plan.manifest.hosts as string[])[0])}；正文位置 {String(((plan.manifest.extraction as { content: string[] }).content).join("、"))}。规则校验值 {plan.checksum.slice(0, 12)}…</p>
            <div className="mt-3 flex gap-2"><Button size="sm" disabled={pending} onClick={() => void confirmInstall()}>{pending ? "正在启用…" : "确认启用"}</Button><Button size="sm" variant="secondary" disabled={pending} onClick={() => setPlan(null)}>返回修改</Button></div>
          </div>
        ) : <Button size="sm" variant="secondary" disabled={pending || !host.trim() || !contentSelector.trim()} onClick={() => void prepareInstall()}>{pending ? "正在检查…" : "检查并预览"}</Button>}
        {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
      </div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="space-y-1"><span className="text-xs font-medium">{label}</span>{children}{hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}</label>;
}

function selectorList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function pluginIdForHost(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `site.${normalized || "pending"}`.slice(0, 64).replace(/[.-]+$/g, "x");
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback}（${error.message}）` : fallback;
}
