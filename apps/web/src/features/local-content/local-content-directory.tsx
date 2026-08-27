import { CalendarDays, Database, FileStack, Folder, FolderTree, Inbox, Mail } from "lucide-react";
import { cn } from "@/lib/cn";
import type { LocalContentCatalogStats, LocalContentKind } from "./local-content-types";
import { localContentSourceLabels } from "./local-content-source-labels";
import type { LocalLibraryCopy } from "./local-library-copy";

type DirectoryItem = { value: string; label: string; count: number };

function originalMailFolderLabel(folderId: string, path: string, copy: LocalLibraryCopy) {
  const normalized = `${folderId} ${path}`.toLocaleLowerCase();
  if (folderId === "unknown") return copy.mailFolderUnknown;
  if (/\binbox\b|收件箱/.test(normalized)) return copy.mailInbox;
  if (/\bsent\b|已发送|已发邮件/.test(normalized)) return copy.mailSent;
  if (/\bdrafts?\b|草稿/.test(normalized)) return copy.mailDrafts;
  if (/\btrash\b|deleted|已删除|废纸篓/.test(normalized)) return copy.mailTrash;
  if (/\bspam\b|junk|垃圾/.test(normalized)) return copy.mailSpam;
  if (/\barchive\b|归档/.test(normalized)) return copy.mailArchive;
  return path || folderId;
}

function OriginalMailDirectory({
  copy,
  accounts,
  folders,
  selectedAccountId,
  selectedFolderId,
  onAccount,
  onFolder,
}: {
  copy: LocalLibraryCopy;
  accounts: NonNullable<LocalContentCatalogStats["facets"]>["mailAccounts"];
  folders: NonNullable<LocalContentCatalogStats["facets"]>["mailFolders"];
  selectedAccountId: string;
  selectedFolderId: string;
  onAccount: (accountId: string) => void;
  onFolder: (accountId: string, folderId: string) => void;
}) {
  if (!accounts?.length) return null;
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
        <Mail className="size-3.5" aria-hidden />
        {copy.directoryMailFolders}
      </h3>
      <div className="space-y-1">
        {accounts.map((account) => {
          const accountFolders = (folders ?? []).filter((folder) => folder.accountId === account.value);
          const accountSelected = selectedAccountId === account.value && selectedFolderId === "all";
          return (
            <div key={account.value}>
              <button
                type="button"
                aria-pressed={accountSelected}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  accountSelected && "bg-primary/10 font-medium text-primary",
                )}
                onClick={() => onAccount(account.value)}
              >
                <Mail className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={account.label}>{account.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{account.count}</span>
              </button>
              {accountFolders.length ? <div className="ml-3.5 mt-0.5 space-y-0.5 border-l border-border pl-2">
                {accountFolders.map((folder) => {
                  const label = originalMailFolderLabel(folder.value, folder.path, copy);
                  const selected = selectedAccountId === account.value && selectedFolderId === folder.value;
                  return <button
                    key={`${folder.accountId}:${folder.value}`}
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                      selected && "bg-primary/10 font-medium text-primary",
                    )}
                    onClick={() => onFolder(account.value, folder.value)}
                  >
                    <Inbox className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={folder.path || label}>{label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{folder.count}</span>
                  </button>;
                })}
              </div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DirectorySection({
  title,
  icon: Icon,
  items,
  selected,
  onSelect,
}: {
  title: string;
  icon: typeof Folder;
  items: DirectoryItem[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </h3>
      <div className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={selected === item.value}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
              selected === item.value && "bg-primary/10 font-medium text-primary",
            )}
            onClick={() => onSelect(item.value)}
          >
            <Folder className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.count}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function LocalContentDirectory({
  copy,
  catalog,
  projects,
  language,
  kind,
  projectId,
  sourceType,
  yearMonth,
  mailAccountId,
  mailFolderId,
  onAll,
  onKind,
  onProject,
  onSource,
  onMonth,
  onMailAccount,
  onMailFolder,
}: {
  copy: LocalLibraryCopy;
  catalog: LocalContentCatalogStats;
  projects: Array<{ id: string; name: string }>;
  language: "zh" | "en";
  kind: "all" | LocalContentKind;
  projectId: string;
  sourceType: string;
  yearMonth: string;
  mailAccountId: string;
  mailFolderId: string;
  onAll: () => void;
  onKind: (value: "all" | LocalContentKind) => void;
  onProject: (value: string) => void;
  onSource: (value: string) => void;
  onMonth: (value: string) => void;
  onMailAccount: (accountId: string) => void;
  onMailFolder: (accountId: string, folderId: string) => void;
}) {
  const sourceLabels = localContentSourceLabels(language);
  const directoryAll = kind === "all" && projectId === "all" && sourceType === "all" && yearMonth === "all" && mailAccountId === "all" && mailFolderId === "all";
  const kinds = (Object.entries(catalog.byKind) as Array<[LocalContentKind, { count: number; available: number } | undefined]>)
    .filter((entry): entry is [LocalContentKind, { count: number; available: number }] => Boolean(entry[1]?.count))
    .map(([value, counts]) => ({ value, label: copy.kinds[value], count: counts.count }));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const projectItems = (catalog.facets?.projects ?? []).map((item) => ({
    ...item,
    label: projectNames.get(item.value) ?? item.value,
  }));
  const sourceItems = (catalog.facets?.sources ?? []).map((item) => ({
    ...item,
    label: sourceLabels[item.value] ?? item.value.replaceAll("_", " "),
  }));
  const monthItems = (catalog.facets?.months ?? []).map((item) => ({ ...item, label: item.value }));

  return (
    <aside className="self-start rounded-xl border border-border bg-card p-3 xl:sticky xl:top-4" aria-label={copy.directoryTitle}>
      <div className="mb-3 flex items-start gap-2 px-1">
        <FolderTree className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold">{copy.directoryTitle}</h2>
          <p className="text-xs text-muted-foreground">{copy.directoryHint}</p>
        </div>
      </div>
      <button
        type="button"
        aria-pressed={directoryAll}
        className={cn(
          "mb-3 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent",
          directoryAll && "bg-primary/10 font-medium text-primary",
        )}
        onClick={onAll}
      >
        <FileStack className="size-4" aria-hidden />
        <span className="flex-1">{copy.directoryAll}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{catalog.total}</span>
      </button>
      <div className="space-y-4">
        <DirectorySection title={copy.directoryByKind} icon={FileStack} items={kinds} selected={kind} onSelect={(value) => onKind(value as LocalContentKind)} />
        <OriginalMailDirectory
          copy={copy}
          accounts={catalog.facets?.mailAccounts}
          folders={catalog.facets?.mailFolders}
          selectedAccountId={mailAccountId}
          selectedFolderId={mailFolderId}
          onAccount={onMailAccount}
          onFolder={onMailFolder}
        />
        <DirectorySection title={copy.directoryByProject} icon={FolderTree} items={projectItems} selected={projectId} onSelect={onProject} />
        <DirectorySection title={copy.directoryBySource} icon={Database} items={sourceItems} selected={sourceType} onSelect={onSource} />
        <DirectorySection title={copy.directoryByMonth} icon={CalendarDays} items={monthItems} selected={yearMonth} onSelect={onMonth} />
      </div>
    </aside>
  );
}
