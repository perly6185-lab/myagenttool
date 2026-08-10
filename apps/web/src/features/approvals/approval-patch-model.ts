import type { InvocationSnapshot } from "@/lib/console-state";

export interface PatchProposal {
  invocationId: string;
  projectId?: string;
  worktreeId?: string | null;
  summary: string | null;
  patch: string;
  files: { path: string; action?: string }[];
  createdAt?: string;
}

export function proposalFromInvocation(invocation: InvocationSnapshot): PatchProposal | null {
  const metadata = invocation.options?.metadata as { tool?: string; worktreeId?: string; projectId?: string } | undefined;
  if (metadata?.tool !== "claude.propose.patch" || invocation.status !== "succeeded") return null;

  const output = invocation.result?.output as { patch?: unknown; summary?: unknown; files?: unknown } | undefined;
  if (!output || typeof output.patch !== "string" || !output.patch.trim()) return null;

  const files = Array.isArray(output.files)
    ? (output.files as { path?: unknown; action?: unknown }[])
        .map((file) => ({
          path: String(file?.path ?? ""),
          action: typeof file?.action === "string" ? file.action : undefined,
        }))
        .filter((file) => file.path)
    : [];

  return {
    invocationId: invocation.id,
    projectId: invocation.projectId ?? metadata.projectId,
    worktreeId: invocation.worktreeId ?? metadata.worktreeId ?? null,
    summary: typeof output.summary === "string" ? output.summary : null,
    patch: output.patch,
    files,
    createdAt: invocation.createdAt,
  };
}
