import { Suspense, useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  Bot,
  ChevronDown,
  ChevronLeft,
  CircleGauge,
  Coins,
  Maximize2,
  Minimize2,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  UserRound,
  Wrench,
} from "lucide-react";
import { SECTION_VIEWS } from "@/app/routes";
import { pageRegistration } from "@/app/sections";
import { canDiscoverProfessionalPage, canManageProfessionalSettings } from "@/app/page-access";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useSessionUser } from "@/hooks/use-session-user";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { type SectionKey, useUiStore } from "@/store/ui-store";
import { MeView } from "@/features/me/me-view";
import { SettingsHomeView } from "./settings-home-view";
import {
  MY_SETTINGS_CATEGORIES,
  isMySettingsSection,
  settingsCategoryForSection,
  settingsSearchAliases,
  type MySettingsCategoryKey,
} from "./my-settings-model";

const CATEGORY_ICONS = {
  execution: Wrench,
  connections: AppWindow,
  automation: Bot,
  governance: ShieldCheck,
  resources: Coins,
  diagnostics: CircleGauge,
} satisfies Record<MySettingsCategoryKey, typeof Wrench>;

type SettingsRoot = "general" | "overview" | MySettingsCategoryKey;

function isSettingsRoute(section: SectionKey, dialogOpen: boolean) {
  return dialogOpen || section === "me" || section === "settings" || pageRegistration(section).surface !== "entry";
}

export function MySettingsDialog() {
  const { t, i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const sessionUser = useSessionUser();
  const canManage = canManageProfessionalSettings(sessionUser?.role);
  const professionalMode = useUiStore((state) => state.experienceMode) === "professional";
  const section = useUiStore((state) => state.section);
  const dialogOpen = useUiStore((state) => state.settingsDialogOpen);
  const setDialogOpen = useUiStore((state) => state.setSettingsDialogOpen);
  const returnSection = useUiStore((state) => state.surfaceReturnSection);
  const setReturnSection = useUiStore((state) => state.setSurfaceReturnSection);
  const setSection = useUiStore((state) => state.setSection);
  const selectedCategory = useUiStore((state) => state.settingsCategory);
  const setSelectedCategory = useUiStore((state) => state.setSettingsCategory);
  const query = useUiStore((state) => state.settingsQuery);
  const setQuery = useUiStore((state) => state.setSettingsQuery);
  const recentSections = useUiStore((state) => state.recentSettingsSections);
  const favoriteSections = useUiStore((state) => state.favoriteSettingsSections);
  const recordRecent = useUiStore((state) => state.recordRecentSettingsSection);
  const toggleFavorite = useUiStore((state) => state.toggleFavoriteSettingsSection);
  const [maximized, setMaximized] = useState(false);
  const open = isSettingsRoute(section, dialogOpen);

  const categories = useMemo(() => MY_SETTINGS_CATEGORIES.map((category) => ({
    ...category,
    pages: category.sections
      .filter((key) => (key !== "myHosts") || professionalMode)
      .filter((key) => canDiscoverProfessionalPage(key, sessionUser?.role))
      .map((key) => pageRegistration(key)),
  })).filter((category) => category.pages.length), [professionalMode, sessionUser?.role]);

  const searchablePages = useMemo(() => categories.flatMap((category) => category.pages.map((page) => ({
    category: category.key,
    page,
  }))), [categories]);
  const normalizedQuery = query.trim().toLowerCase();
  const searchTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const searchResults = normalizedQuery ? searchablePages.filter(({ page }) => {
    const searchable = `${t(page.labelKey)} ${t(page.blurbKey)} ${settingsSearchAliases(page.key)}`.toLowerCase();
    return searchTokens.every((token) => searchable.includes(token));
  }) : [];

  const currentLeaf = section !== "me" && section !== "settings" && isMySettingsSection(section)
    ? section
    : null;
  const activeCategory = currentLeaf ? settingsCategoryForSection(currentLeaf) : selectedCategory;
  const activeRoot: SettingsRoot = section === "me"
    ? "general"
    : currentLeaf
      ? activeCategory ?? "overview"
      : selectedCategory ?? "overview";
  const [expandedCategory, setExpandedCategory] = useState<MySettingsCategoryKey | null>(activeCategory);

  useEffect(() => {
    if (currentLeaf && activeCategory) setExpandedCategory(activeCategory);
  }, [activeCategory, currentLeaf]);

  const close = () => {
    const fallback = returnSection
      && returnSection !== "me"
      && pageRegistration(returnSection).surface === "entry"
      ? returnSection
      : "dashboard";
    setDialogOpen(false);
    setReturnSection(null);
    setSection(fallback);
  };

  const openRoot = (root: SettingsRoot) => {
    setDialogOpen(true);
    setQuery("");
    if (root === "general") {
      setExpandedCategory(null);
      setSelectedCategory(null);
      setSection("me");
      return;
    }
    if (root === "overview") {
      setExpandedCategory(null);
      setSelectedCategory(null);
      setSection("settings");
      return;
    }
    setSelectedCategory(root);
    setSection("settings");
  };

  const openCategory = (category: MySettingsCategoryKey) => {
    setExpandedCategory((current) => current === category ? null : category);
    openRoot(category);
  };

  const openPage = (target: SectionKey, category: MySettingsCategoryKey) => {
    setDialogOpen(true);
    setQuery("");
    setExpandedCategory(category);
    setSelectedCategory(category);
    recordRecent(target);
    setSection(target);
  };

  const currentCategory = activeCategory
    ? categories.find((category) => category.key === activeCategory) ?? null
    : null;
  const quickSections = [...favoriteSections, ...recentSections.filter((key) => !favoriteSections.includes(key))]
    .filter((key, index, values) => values.indexOf(key) === index)
    .filter((key) => canDiscoverProfessionalPage(key, sessionUser?.role))
    .slice(0, 6);

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("me.settings")}
      description={zh ? "常用偏好与专业能力集中在这里，不占用日常工作导航。" : "Personal preferences and professional capabilities without cluttering daily navigation."}
      size={maximized ? "viewport" : "2xl"}
      bodyClassName="flex-1 overflow-hidden"
      headerActions={(
        <button
          type="button"
          onClick={() => setMaximized((current) => !current)}
          aria-label={maximized ? (zh ? "还原弹框大小" : "Restore dialog size") : (zh ? "放大弹框" : "Maximize dialog")}
          title={maximized ? (zh ? "还原" : "Restore") : (zh ? "放大" : "Maximize")}
          className="hidden size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:grid"
        >
          {maximized ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
        </button>
      )}
    >
      <div className={cn("flex min-h-[420px] flex-col overflow-hidden rounded-lg border bg-background md:flex-row", maximized ? "h-full" : "h-[min(760px,calc(100vh-9rem))]")}>
        <div className="border-b bg-muted/20 p-3 md:hidden">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="mobile-settings-section">
            {zh ? "设置分类" : "Settings area"}
          </label>
          <select
            id="mobile-settings-section"
            value={activeRoot}
            onChange={(event) => {
              const root = event.target.value as SettingsRoot;
              if (root !== "general" && root !== "overview") setExpandedCategory(root);
              openRoot(root);
            }}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="general">{zh ? "常规" : "General"}</option>
            <option value="overview">{zh ? "专业概览" : "Professional overview"}</option>
            {categories.map((category) => <option key={category.key} value={category.key}>{t(`settingsHome.categories.${category.key}.title`)}</option>)}
          </select>
          {currentCategory ? (
            <div className="mt-2">
              <label className="sr-only" htmlFor="mobile-settings-page">{zh ? "具体能力" : "Capability"}</label>
              <select
                id="mobile-settings-page"
                value={currentLeaf ?? ""}
                onChange={(event) => {
                  if (event.target.value) openPage(event.target.value as SectionKey, currentCategory.key);
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{zh ? "选择具体能力" : "Choose a capability"}</option>
                {currentCategory.pages.map((page) => <option key={page.key} value={page.key}>{t(page.labelKey)}</option>)}
              </select>
            </div>
          ) : null}
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8"
              aria-label={zh ? "移动端搜索设置" : "Search settings on mobile"}
              placeholder={t("settingsHome.searchPlaceholder")}
            />
          </div>
        </div>

        <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/20 md:flex" aria-label={zh ? "我的设置分类" : "My settings areas"}>
          <div className="border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 pl-8"
                aria-label={t("settingsHome.search")}
                placeholder={t("settingsHome.searchPlaceholder")}
              />
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto p-2">
            <SettingsNavButton active={activeRoot === "general" && !normalizedQuery} icon={UserRound} label={zh ? "常规" : "General"} onClick={() => openRoot("general")} />
            <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{zh ? "专业能力" : "Professional"}</p>
            <SettingsNavButton active={activeRoot === "overview" && !normalizedQuery} icon={Settings2} label={zh ? "专业概览" : "Professional overview"} onClick={() => openRoot("overview")} />
            {categories.map((category) => (
              <div key={category.key}>
                <SettingsNavButton
                  active={activeRoot === category.key && !normalizedQuery}
                  icon={CATEGORY_ICONS[category.key]}
                  label={t(`settingsHome.categories.${category.key}.title`)}
                  count={category.pages.length}
                  expanded={expandedCategory === category.key}
                  controls={`settings-subnav-${category.key}`}
                  onClick={() => openCategory(category.key)}
                />
                {expandedCategory === category.key ? (
                  <div id={`settings-subnav-${category.key}`} className="mb-1 ml-5 border-l border-border/80 py-1 pl-2">
                    {category.pages.map((page) => {
                      const Icon = page.icon;
                      const active = currentLeaf === page.key && !normalizedQuery;
                      return (
                        <button
                          key={page.key}
                          type="button"
                          aria-current={active ? "page" : undefined}
                          onClick={() => openPage(page.key, category.key)}
                          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-background/70 hover:text-foreground")}
                        >
                          <Icon className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{t(page.labelKey)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto bg-card" aria-live="polite">
          <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
            {normalizedQuery ? (
              <SettingsSearchResults
                query={query}
                results={searchResults}
                favoriteSections={favoriteSections}
                onOpen={openPage}
                onFavorite={toggleFavorite}
              />
            ) : currentLeaf ? (
              <ProfessionalPagePanel
                section={currentLeaf}
                category={activeCategory}
                favorite={favoriteSections.includes(currentLeaf)}
                onBack={() => activeCategory && openRoot(activeCategory)}
                onFavorite={() => toggleFavorite(currentLeaf)}
              />
            ) : activeRoot === "general" ? (
              <MeView embedded />
            ) : activeRoot === "overview" ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold">{zh ? "专业能力概览" : "Professional overview"}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{zh ? "检查就绪状态，处理异常，并继续最近使用的专业能力。" : "Review readiness, resolve attention items, and continue recent professional work."}</p>
                </div>
                {!canManage && sessionUser?.role ? (
                  <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground" role="status">
                    {t("settingsRole.limited", { role: t(`identity.role.${sessionUser.role}`) })}
                  </p>
                ) : null}
                {quickSections.length ? (
                  <div className="flex flex-wrap gap-2" aria-label={zh ? "收藏与最近访问" : "Favorites and recent"}>
                    {quickSections.map((key) => {
                      const page = pageRegistration(key);
                      const category = settingsCategoryForSection(key);
                      return category ? <button key={key} type="button" onClick={() => openPage(key, category)} className="rounded-lg border bg-muted/20 px-3 py-2 text-sm hover:bg-muted">{t(page.labelKey)}</button> : null;
                    })}
                  </div>
                ) : null}
                <SettingsHomeView embedded />
              </div>
            ) : currentCategory ? (
              <ProfessionalCategoryPanel
                category={currentCategory}
                favoriteSections={favoriteSections}
                onOpen={openPage}
                onFavorite={toggleFavorite}
              />
            ) : null}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function SettingsNavButton({ active, icon: Icon, label, count, expanded, controls, onClick }: {
  active: boolean;
  icon: typeof UserRound;
  label: string;
  count?: number;
  expanded?: boolean;
  controls?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={cn("mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm", active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground")}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span> : null}
      {expanded != null ? <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", !expanded && "-rotate-90")} aria-hidden /> : null}
    </button>
  );
}

function ProfessionalCategoryPanel({ category, favoriteSections, onOpen, onFavorite }: {
  category: (typeof MY_SETTINGS_CATEGORIES)[number] & { pages: ReturnType<typeof pageRegistration>[] };
  favoriteSections: SectionKey[];
  onOpen: (section: SectionKey, category: MySettingsCategoryKey) => void;
  onFavorite: (section: SectionKey) => void;
}) {
  const { t } = useAppTranslation();
  return (
    <div>
      <h2 className="text-xl font-semibold">{t(`settingsHome.categories.${category.key}.title`)}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t(`settingsHome.categories.${category.key}.hint`)}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {category.pages.map((page) => {
          const Icon = page.icon;
          const favorite = favoriteSections.includes(page.key);
          return (
            <div key={page.key} className="group flex min-w-0 rounded-xl border bg-background hover:border-primary/40 hover:bg-muted/20">
              <button type="button" onClick={() => onOpen(page.key, category.key)} className="flex min-w-0 flex-1 items-start gap-3 p-4 text-left">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden /></span>
                <span className="min-w-0"><strong className="block text-sm font-semibold">{t(page.labelKey)}</strong><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{t(page.blurbKey)}</span></span>
              </button>
              <button type="button" aria-label={`${favorite ? "Remove favorite" : "Favorite"} ${t(page.labelKey)}`} onClick={() => onFavorite(page.key)} className="m-2 self-start rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-warning"><Star className={cn("size-4", favorite && "fill-current text-warning")} aria-hidden /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsSearchResults({ query, results, favoriteSections, onOpen, onFavorite }: {
  query: string;
  results: Array<{ category: MySettingsCategoryKey; page: ReturnType<typeof pageRegistration> }>;
  favoriteSections: SectionKey[];
  onOpen: (section: SectionKey, category: MySettingsCategoryKey) => void;
  onFavorite: (section: SectionKey) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <div>
      <h2 className="text-xl font-semibold">{zh ? `搜索“${query}”` : `Search “${query}”`}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{zh ? `找到 ${results.length} 项专业能力` : `${results.length} professional capabilities found`}</p>
      <div className="mt-5 space-y-2">
        {results.map(({ category, page }) => {
          const favorite = favoriteSections.includes(page.key);
          return (
            <div key={page.key} className="flex items-center rounded-lg border hover:bg-muted/30">
              <button type="button" onClick={() => onOpen(page.key, category)} className="min-w-0 flex-1 p-3 text-left"><strong className="block text-sm">{t(page.labelKey)}</strong><span className="block text-xs text-muted-foreground">{t(`settingsHome.categories.${category}.title`)} · {t(page.blurbKey)}</span></button>
              <button type="button" aria-label={`${favorite ? "Remove favorite" : "Favorite"} ${t(page.labelKey)}`} onClick={() => onFavorite(page.key)} className="m-2 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-warning"><Star className={cn("size-4", favorite && "fill-current text-warning")} aria-hidden /></button>
            </div>
          );
        })}
        {!results.length ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("settingsHome.noMatch")}</p> : null}
      </div>
    </div>
  );
}

function ProfessionalPagePanel({ section, category, favorite, onBack, onFavorite }: {
  section: SectionKey;
  category: MySettingsCategoryKey | null;
  favorite: boolean;
  onBack: () => void;
  onFavorite: () => void;
}) {
  const { t, i18n } = useAppTranslation();
  const sessionUser = useSessionUser();
  const page = pageRegistration(section);
  const View = SECTION_VIEWS[section];
  const allowed = canDiscoverProfessionalPage(section, sessionUser?.role);
  return (
    <div className="min-w-0">
      <div className="sticky -top-6 z-10 mb-4 flex items-center gap-2 border-b bg-card/95 py-3 backdrop-blur">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronLeft className="size-4" aria-hidden />{category ? t(`settingsHome.categories.${category}.title`) : t("me.settings")}</button>
        <span className="text-muted-foreground" aria-hidden>/</span>
        <strong className="min-w-0 flex-1 truncate text-sm">{t(page.labelKey)}</strong>
        <button type="button" aria-label={`${favorite ? "Remove favorite" : "Favorite"} ${t(page.labelKey)}`} onClick={onFavorite} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-warning"><Star className={cn("size-4", favorite && "fill-current text-warning")} aria-hidden /></button>
      </div>
      {allowed ? (
        <ErrorBoundary resetKey={section} onRetry={() => location.reload()}>
          <Suspense fallback={<div role="status" className="py-10 text-center text-sm text-muted-foreground">{t("tasks.loading")}</div>}>
            <View />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <div className="rounded-xl border bg-muted/20 p-6 text-center" role="status"><StatusBadge tone="warning">{i18n.language.startsWith("zh") ? "当前角色不可用" : "Unavailable for this role"}</StatusBadge></div>
      )}
    </div>
  );
}
