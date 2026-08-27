import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";
import { hostApi } from "./host-api";
import type { HostFileScope, SshHost } from "./host-types";
import { MyHostsView } from "./my-hosts-view";

vi.mock("./host-api", () => ({ MAX_HOST_UPLOAD_BYTES: 10 * 1024 * 1024, MAX_HOST_DOWNLOAD_BYTES: 25 * 1024 * 1024, hostApi: {
  list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), observeFingerprint: vi.fn(), confirmFingerprint: vi.fn(), verify: vi.fn(),
  scopes: vi.fn(), scopeSuggestions: vi.fn(), createScope: vi.fn(), updateScope: vi.fn(), entries: vi.fn(), transfers: vi.fn(), upload: vi.fn(), download: vi.fn(), diagnose: vi.fn(), planDiagnostic: vi.fn(), tlsProfiles: vi.fn(), createTlsProfile: vi.fn(),
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
  vi.mocked(hostApi.scopeSuggestions).mockResolvedValue({ suggestions: [{ rootPath: "/srv/myagenttool-sites/server001-lan-e2e", label: "server001 lan e2e", purpose: "site_publish", reason: "managed_site", recommended: true }], count: 1 });
  vi.mocked(hostApi.createScope).mockResolvedValue({ scope });
  vi.mocked(hostApi.entries).mockResolvedValue({ scope, path: "", count: 3, entries: [
    { name: "assets", path: "assets", type: "directory", accessible: true, size: null, modifiedAt: null },
    { name: "index.html", path: "index.html", type: "file", accessible: true, size: 1200, modifiedAt: null },
    { name: "current", path: "current", type: "symlink", accessible: false, size: null, modifiedAt: null },
  ] });
  vi.mocked(hostApi.transfers).mockResolvedValue({ transfers: [], count: 0 });
  vi.mocked(hostApi.tlsProfiles).mockResolvedValue({ profiles: [], count: 0 });
  vi.mocked(hostApi.diagnose).mockResolvedValue({ result: { action: "disk_usage", command: "df -h", output: "Filesystem\n/dev/sda1 20G 8G 12G 40% /" } });
  vi.mocked(hostApi.planDiagnostic).mockResolvedValue({ plan: { action: "disk_usage", command: "df -h", risk: "read_only" } });
});
afterEach(() => cleanup());

it("loads owned hosts directly in Ordinary mode while hiding professional metadata", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  renderView();
  expect(await screen.findByRole("heading", { name: "Connect and use my devices" })).toBeTruthy();
  expect((await screen.findAllByText("Production website host")).length).toBe(2);
  expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remote files" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Transfers" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  expect(screen.queryByText("deploy@host.example:22")).toBeNull();
  expect(screen.queryByText("host.example")).toBeNull();
  expect(screen.getByText("Approved folders")).toBeTruthy();
  expect(screen.getByText("Approved folders only")).toBeTruthy();
  expect(hostApi.list).toHaveBeenCalledTimes(1);
  expect(useUiStore.getState().experienceMode).toBe("ordinary");

  fireEvent.click(screen.getByRole("button", { name: "Connect device" }));
  expect(await screen.findByRole("heading", { name: "Connect my device" })).toBeTruthy();
  expect((screen.getByLabelText("Device address") as HTMLInputElement).value).toBe("");
});

it("keeps complete connection metadata and settings available in Professional mode", async () => {
  renderView();
  expect(await screen.findByText("deploy@host.example:22")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  expect(screen.getByText("File ranges")).toBeTruthy();
  expect(screen.getByText("Governed transfers")).toBeTruthy();
});

it("opens host setup from Ordinary mode without changing the experience mode", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Connect device" }))[0]);
  expect(await screen.findByRole("heading", { name: "Connect my device" })).toBeTruthy();
  expect(screen.getByLabelText("Device address")).toBeTruthy();
  expect(screen.getByText("1. Connect device")).toBeTruthy();
  expect(hostApi.list).toHaveBeenCalled();
  expect(useUiStore.getState().experienceMode).toBe("ordinary");
});

it("guides an ordinary user through local permission, device identity, and the recommended folder", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  const createdHost = { ...host, host: "10.10.10.222", authMethod: "password_ref" as const, networkPolicy: "allow_private_network" as const, connectionStatus: "untested" as const, knownHostFingerprint: null, observedFingerprint: null, capabilities: null, verifiedAt: null, revision: 1 };
  const observedHost = { ...createdHost, connectionStatus: "fingerprint_pending" as const, observedFingerprint: host.observedFingerprint, revision: 2 };
  const confirmedHost = { ...observedHost, connectionStatus: "untested" as const, knownHostFingerprint: host.observedFingerprint, revision: 3 };
  const readyHost = { ...host, host: "10.10.10.222", authMethod: "password_ref" as const, networkPolicy: "allow_private_network" as const };
  vi.mocked(hostApi.create).mockResolvedValue({ target: createdHost });
  vi.mocked(hostApi.observeFingerprint).mockResolvedValue({ host: observedHost, observation: { fingerprint: host.observedFingerprint!, resolvedAddress: "10.10.10.222" } });
  vi.mocked(hostApi.confirmFingerprint).mockResolvedValue({ host: confirmedHost });
  vi.mocked(hostApi.verify).mockResolvedValue({ host: readyHost, verification: { capabilities: readyHost.capabilities } });
  window.myagenttoolDesktop = { saveSshHostCredential: vi.fn().mockResolvedValue({ ok: true, reference: host.credentialRef, authMethod: "password_ref" }) };
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Connect device" }))[0]);
  fireEvent.change(screen.getByLabelText("Device address"), { target: { value: "10.10.10.222" } });
  fireEvent.change(screen.getByLabelText("Login password"), { target: { value: "test-password" } });
  const localConsent = screen.getByLabelText(/Allow access to my local device/);
  expect((localConsent as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Connect this device" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Confirm that MyAgentTool may connect to this local-network device");
  expect(hostApi.create).not.toHaveBeenCalled();

  fireEvent.click(localConsent);
  fireEvent.click(screen.getByRole("button", { name: "Connect this device" }));
  await waitFor(() => expect(hostApi.create).toHaveBeenCalledWith(expect.objectContaining({ host: "10.10.10.222", networkPolicy: "allow_private_network" })));
  expect(await screen.findByRole("heading", { name: "Confirm this is my device" })).toBeTruthy();
  const fingerprintDetails = screen.getByText("View technical fingerprint").closest("details");
  expect(fingerprintDetails?.open).toBe(false);
  const identityConfirmation = screen.getByLabelText("I confirm this is the device I intend to connect to.");
  const confirmButton = screen.getByRole("button", { name: "Confirm device and continue" }) as HTMLButtonElement;
  expect(confirmButton.disabled).toBe(true);
  fireEvent.click(identityConfirmation);
  fireEvent.click(confirmButton);

  expect(await screen.findByRole("heading", { name: "Choose a folder MyAgentTool may use" })).toBeTruthy();
  const recommended = await screen.findByRole("radio", { name: /server001 lan e2e/ });
  expect((recommended as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("Folder permissions").closest("details")?.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Use this folder and finish" }));
  await waitFor(() => expect(hostApi.createScope).toHaveBeenCalledWith(host.id, expect.objectContaining({ rootPath: "/srv/myagenttool-sites/server001-lan-e2e" })));
});

it("keeps a list-only range read-only and links inaccessible", async () => {
  renderView();
  expect((await screen.findAllByText("Production website host")).length).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Remote files" }));
  expect(await screen.findByText("index.html")).toBeTruthy();
  expect(screen.getByText("1.2 KB")).toBeTruthy();
  expect(screen.getByTestId("directory-summary").textContent).toContain("1.2 KB");
  expect(screen.getByText("Shortcut: open the matching real folder")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  expect(hostApi.entries).toHaveBeenCalledWith("hfs_1", "");
});

it("keeps manual folder entry open while an ordinary user types an alternative", async () => {
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Remote files" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add range" }));
  expect(await screen.findByDisplayValue("/srv/myagenttool-sites/server001-lan-e2e")).toBeTruthy();
  fireEvent.click(screen.getByText("Use another folder"));
  const input = await screen.findByLabelText("Remote directory");
  fireEvent.change(input, { target: { value: "/srv/www/another-site" } });
  expect(screen.getByDisplayValue("/srv/www/another-site")).toBeTruthy();
});

it("turns a plain-language host request into a reviewed read-only diagnostic", async () => {
  renderView();
  const assistant = await screen.findByTestId("host-assistant");
  fireEvent.change(screen.getByPlaceholderText("For example: show remaining disk space"), { target: { value: "show disk space" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
  expect(await screen.findByText("df -h")).toBeTruthy();
  expect(hostApi.planDiagnostic).toHaveBeenCalledWith(host.id, "show disk space");
  expect(hostApi.diagnose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));
  await waitFor(() => expect(hostApi.diagnose).toHaveBeenCalledWith(host.id, "disk_usage"));
  expect(await screen.findByText(/Filesystem/)).toBeTruthy();
  expect(await screen.findByTestId("diagnostic-insights")).toBeTruthy();
  expect(assistant).toBeTruthy();
});

it("previews approved text files without executing their contents", async () => {
  const readableScope = { ...scope, permissions: ["list", "download"] as HostFileScope["permissions"] };
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [readableScope], count: 1 });
  vi.mocked(hostApi.download).mockResolvedValue({ blob: new Blob(["<h1>safe preview</h1>"], { type: "text/html" }), fileName: "index.html", transferId: "hft_preview" });
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Remote files" }));
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Preview: index.html")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("safe preview"));
  expect(hostApi.download).toHaveBeenCalledWith("hfs_1", { path: "index.html" });
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

it("explains missing connection fields instead of silently disabling connection", async () => {
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add host" }))[0]);
  const save = screen.getByRole("button", { name: "Connect and verify" }) as HTMLButtonElement;
  expect(save.disabled).toBe(false);

  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Enter a host address");
  expect(hostApi.create).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Host address"), { target: { value: "10.10.10.222" } });
  fireEvent.change(screen.getByLabelText("Login user"), { target: { value: "" } });
  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Enter the login user");

  fireEvent.change(screen.getByLabelText("Login user"), { target: { value: "deploy" } });
  fireEvent.change(screen.getByLabelText("Port"), { target: { value: "0" } });
  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Port must be an integer from 1 to 65535");
  expect(hostApi.create).not.toHaveBeenCalled();
});

it("connects from one ordinary form and moves the password into desktop secure storage", async () => {
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  const createdHost = { ...host, authMethod: "password_ref" as const, connectionStatus: "untested" as const, knownHostFingerprint: null, observedFingerprint: null, capabilities: null, verifiedAt: null, revision: 1 };
  const observedHost = { ...createdHost, connectionStatus: "fingerprint_pending" as const, observedFingerprint: host.observedFingerprint, revision: 2 };
  const confirmedHost = { ...observedHost, connectionStatus: "untested" as const, knownHostFingerprint: host.observedFingerprint, revision: 3 };
  const readyHost = { ...host, authMethod: "password_ref" as const };
  vi.mocked(hostApi.create).mockResolvedValue({ target: createdHost });
  vi.mocked(hostApi.observeFingerprint).mockResolvedValue({ host: observedHost, observation: { fingerprint: host.observedFingerprint!, resolvedAddress: "203.0.113.10" } });
  vi.mocked(hostApi.confirmFingerprint).mockResolvedValue({ host: confirmedHost });
  vi.mocked(hostApi.verify).mockResolvedValue({ host: readyHost, verification: { capabilities: readyHost.capabilities } });
  const saveSshHostCredential = vi.fn().mockResolvedValue({ ok: true, reference: host.credentialRef, authMethod: "password_ref" });
  window.myagenttoolDesktop = { saveSshHostCredential };
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add host" }))[0]);
  fireEvent.change(screen.getByLabelText("Host address"), { target: { value: "host.example" } });
  fireEvent.change(screen.getByLabelText("Login password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect and verify" }));
  await waitFor(() => expect(hostApi.create).toHaveBeenCalledWith(expect.objectContaining({ host: "host.example", user: "deploy", authMethod: "password_ref", purposes: ["file_transfer"] })));
  expect(saveSshHostCredential).toHaveBeenCalledWith(expect.objectContaining({ hostId: host.id, password: "test-password" }));
  expect(hostApi.observeFingerprint).toHaveBeenCalledWith(host.id);
  expect(await screen.findByRole("button", { name: "Confirm and connect" })).toBeTruthy();
  expect(screen.getByText(host.observedFingerprint!)).toBeTruthy();
  expect(screen.queryByDisplayValue("test-password")).toBeNull();
  fireEvent.click(screen.getByLabelText("I compared the fingerprint and confirmed this is the device I intend to connect to."));
  fireEvent.click(screen.getByRole("button", { name: "Confirm and connect" }));
  await waitFor(() => expect(hostApi.confirmFingerprint).toHaveBeenCalledWith(host.id, host.observedFingerprint, observedHost.revision));
  expect(hostApi.verify).toHaveBeenCalledWith(host.id);
  expect(await screen.findByRole("heading", { name: "Add a file range" })).toBeTruthy();
  expect(await screen.findByDisplayValue("/srv/myagenttool-sites/server001-lan-e2e")).toBeTruthy();
  expect(screen.getByText("3. Choose folder")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verify range and finish" }));
  await waitFor(() => expect(hostApi.createScope).toHaveBeenCalledWith(host.id, expect.objectContaining({ rootPath: "/srv/myagenttool-sites/server001-lan-e2e" })));
});

it("requires plain-language consent before connecting to a local-network address", async () => {
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add host" }))[0]);
  fireEvent.change(screen.getByLabelText("Host address"), { target: { value: "10.10.10.222" } });
  fireEvent.change(screen.getByLabelText("Login password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect and verify" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Confirm that MyAgentTool may connect to this local-network device");
  expect(hostApi.create).not.toHaveBeenCalled();
});

it("repairs an existing private-network host in place and reuses its saved credential", async () => {
  const blockedHost: SshHost = {
    ...host,
    host: "10.10.10.222",
    authMethod: "password_ref",
    networkPolicy: "public_only",
    connectionStatus: "error",
    knownHostFingerprint: null,
    observedFingerprint: null,
    capabilities: null,
    lastConnectionError: { code: "ssh_host_private_network_blocked", at: "2026-08-26T00:00:00.000Z" },
    verifiedAt: null,
  };
  const updatedHost = { ...blockedHost, networkPolicy: "allow_private_network" as const, connectionStatus: "untested" as const, lastConnectionError: null, revision: 5 };
  const observedHost = { ...updatedHost, connectionStatus: "fingerprint_pending" as const, observedFingerprint: host.observedFingerprint, revision: 6 };
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [blockedHost], count: 1 });
  vi.mocked(hostApi.update).mockResolvedValue({ host: updatedHost });
  vi.mocked(hostApi.observeFingerprint).mockResolvedValue({ host: observedHost, observation: { fingerprint: host.observedFingerprint!, resolvedAddress: "10.10.10.222" } });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Allow local network and retry" }));
  const privateConsent = await screen.findByLabelText(/Local-network permission/);
  expect((privateConsent as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Connect and verify" }));

  await waitFor(() => expect(hostApi.update).toHaveBeenCalledWith(blockedHost.id, expect.objectContaining({ expectedRevision: blockedHost.revision, networkPolicy: "allow_private_network" })));
  expect(hostApi.create).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "Confirm and connect" })).toBeTruthy();
});
