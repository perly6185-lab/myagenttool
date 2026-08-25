import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";
import { hostApi } from "./host-api";
import type { HostFileScope, SshHost } from "./host-types";
import { MyHostsView } from "./my-hosts-view";

vi.mock("./host-api", () => ({ MAX_HOST_UPLOAD_BYTES: 10 * 1024 * 1024, MAX_HOST_DOWNLOAD_BYTES: 25 * 1024 * 1024, hostApi: {
  list: vi.fn(), get: vi.fn(), create: vi.fn(), observeFingerprint: vi.fn(), confirmFingerprint: vi.fn(), verify: vi.fn(),
  scopes: vi.fn(), createScope: vi.fn(), updateScope: vi.fn(), entries: vi.fn(), transfers: vi.fn(), upload: vi.fn(), download: vi.fn(),
} }));

const host: SshHost = {
  id: "ssh_target_1", name: "Production website host", host: "host.example", port: 22, user: "deploy",
  authMethod: "private_key_ref", credentialRef: "credential://ssh/ssh_target_1", purposes: ["file_transfer", "site_publish"],
  networkPolicy: "public_only", knownHostFingerprint: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDE12", observedFingerprint: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDE12",
  connectionStatus: "ready", capabilities: { sftp: true, sftpVersion: 3, posixRename: true, symlink: true }, lastConnectionError: null,
  verifiedAt: "2026-08-25T00:00:00.000Z", revision: 4,
};
const scope: HostFileScope = {
  id: "hfs_1", sshTargetId: host.id, label: "Website files", purpose: "site_publish", rootPath: "/srv/www/site", resolvedRootPath: "/srv/www/site",
  permissions: ["list"], status: "ready", revision: 1, lastVerifiedAt: "2026-08-25T00:00:00.000Z",
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MyHostsView /></QueryClientProvider>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  delete window.myagenttoolDesktop;
  await i18n.changeLanguage("en-US");
  useUiStore.setState({ experienceMode: "professional" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [host], count: 1 });
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [scope], count: 1 });
  vi.mocked(hostApi.entries).mockResolvedValue({ scope, path: "", count: 3, entries: [
    { name: "assets", path: "assets", type: "directory", accessible: true, size: null, modifiedAt: null },
    { name: "index.html", path: "index.html", type: "file", accessible: true, size: 1200, modifiedAt: null },
    { name: "current", path: "current", type: "symlink", accessible: false, size: null, modifiedAt: null },
  ] });
  vi.mocked(hostApi.transfers).mockResolvedValue({ transfers: [], count: 0 });
});
afterEach(() => cleanup());

it("keeps host metadata out of Ordinary mode until Professional mode is enabled", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  renderView();
  expect(await screen.findByText("This page belongs to Professional mode")).toBeTruthy();
  expect(screen.queryByText("Production website host")).toBeNull();
  expect(hostApi.list).not.toHaveBeenCalled();
});

it("keeps a list-only range read-only and links inaccessible", async () => {
  renderView();
  expect((await screen.findAllByText("Production website host")).length).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Remote files" }));
  expect(await screen.findByText("index.html")).toBeTruthy();
  expect(screen.getByText("1.2 KB")).toBeTruthy();
  expect(screen.getByText("Restricted: cannot open")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  expect(hostApi.entries).toHaveBeenCalledWith("hfs_1", "");
});

it("requires a clear confirmation before an enabled upload starts", async () => {
  const writableScope = { ...scope, permissions: ["list", "upload", "download"] as HostFileScope["permissions"] };
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [writableScope], count: 1 });
  vi.mocked(hostApi.upload).mockResolvedValue({ task: {
    id: "hft_1", sshTargetId: host.id, scopeId: scope.id, direction: "upload", status: "completed", remotePath: "notes.txt", remoteDirectory: "", fileName: "notes.txt",
    bytesTotal: 5, bytesTransferred: 5, progress: 100, conflictPolicy: "rename", attempt: 1, maxAttempts: 3, retryOf: null, errorCode: null, createdAt: "2026-08-25T00:00:00.000Z", completedAt: "2026-08-25T00:00:01.000Z",
  } });
  const rendered = renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Remote files" }));
  fireEvent.click(await screen.findByRole("button", { name: "Upload" }));
  const input = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] } });
  expect(await screen.findByText("Confirm upload")).toBeTruthy();
  expect(hostApi.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
  await waitFor(() => expect(hostApi.upload).toHaveBeenCalledWith("hfs_1", expect.any(File), expect.objectContaining({ directory: "", conflictPolicy: "rename", overwriteConfirmed: false })));
});

it("offers a bounded retry from a failed transfer without retaining file bytes", async () => {
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [{ ...scope, permissions: ["list", "download"] }], count: 1 });
  vi.mocked(hostApi.transfers).mockResolvedValue({ count: 1, transfers: [{
    id: "hft_failed", sshTargetId: host.id, scopeId: scope.id, direction: "download", status: "failed", remotePath: "index.html", remoteDirectory: "", fileName: "index.html",
    bytesTotal: 1200, bytesTransferred: 400, progress: 33, conflictPolicy: null, attempt: 1, maxAttempts: 3, retryOf: null, errorCode: "ssh_connection_timeout", createdAt: "2026-08-25T00:00:00.000Z", completedAt: "2026-08-25T00:00:01.000Z",
  }] });
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Transfers" }));
  expect(await screen.findByText("Failed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Confirm download")).toBeTruthy();
  expect(hostApi.download).not.toHaveBeenCalled();
});

it("starts with plain connection fields and moves credentials into desktop secure storage", async () => {
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  vi.mocked(hostApi.create).mockResolvedValue({ target: { ...host, connectionStatus: "untested", knownHostFingerprint: null, observedFingerprint: null, capabilities: null, verifiedAt: null, revision: 1 } });
  const saveSshHostCredential = vi.fn().mockResolvedValue({ ok: true, reference: host.credentialRef, authMethod: "private_key_ref" });
  window.myagenttoolDesktop = { saveSshHostCredential };
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add host" }))[0]);
  fireEvent.change(screen.getByLabelText("Host address"), { target: { value: "host.example" } });
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => expect(hostApi.create).toHaveBeenCalledWith(expect.objectContaining({ host: "host.example", user: "deploy", purposes: ["file_transfer", "site_publish"] })));

  const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nplain-test-key\n-----END OPENSSH PRIVATE KEY-----";
  fireEvent.change(await screen.findByLabelText("Private key"), { target: { value: privateKey } });
  fireEvent.click(screen.getByRole("button", { name: "Save securely" }));
  await waitFor(() => expect(saveSshHostCredential).toHaveBeenCalledWith(expect.objectContaining({ hostId: host.id, privateKey })));
  expect(await screen.findByRole("button", { name: "Read fingerprint" })).toBeTruthy();
  expect(screen.queryByDisplayValue(privateKey)).toBeNull();
});
