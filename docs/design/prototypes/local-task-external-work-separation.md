# Local Tasks And External Work Separation

Date: 2026-08-07

Status: implemented; browser visual QA is the release gate

## Product contract

The ordinary **Tasks** page contains only product-owned local tasks. GitHub,
GitLab, and Gitea records are collaboration inputs or delivery outputs; they do
not appear as peer task types.

```text
External Issue -> Turn into task -> Local task -> AI execution -> Review -> PR/MR
```

- An Issue is an incoming work request. It must become a local task before AI
  execution starts.
- A pull request or merge request is a code change. It remains in External work
  for review, task linkage, and delivery.
- The internal `LocalWorkItem` model remains canonical, but ordinary UI uses
  the word **task** instead of **Local Issue**.

## Tasks

The default path is `New task -> describe work -> let AI work -> review result`.

- Header actions: Refresh and New task.
- Filters: All, Active, Waiting, Done, project, and search.
- Rows: task, project, state, optional external-source badge, and Open.
- No Issue/PR tabs, claim controls, automation creation, external execution
  funnel, or planning administration appear in the ordinary list.
- Simple details remain the default; routine-bound tasks preserve Expert mode.

## External work

External work separates two lifecycles:

| View | Meaning | Primary action |
| --- | --- | --- |
| Issue inbox | Incoming requests | Turn into task / Open linked task |
| Change requests | GitHub PR, GitLab MR, or Gitea PR | Review externally or open linked worktree |

The initial live list reuses connected GitHub repository discovery. The shared
Issue creation dialog remains the provider-neutral path for GitHub, GitLab, and
Gitea. Provider configuration stays in Settings/Integrations.

## Progressive disclosure

- External source is metadata on a task, not a task category.
- Advanced execution, synchronization, worktree, verification, cost, and audit
  controls remain in Expert details and their existing canonical pages.
- Import never starts AI automatically.
- PR/MR rows never offer "Turn into task".

## Release gates

- Tasks never fetch or render external Issue/PR lists.
- External work exposes separate Issue inbox and Change request tabs.
- Turning an Issue into a task opens the canonical task in Simple details.
- Existing linked Issues open their task instead of creating a duplicate.
- Desktop and 390 px mobile captures have no horizontal page overflow.
- Typecheck, navigation tests, page tests, build, and browser visual QA pass.
