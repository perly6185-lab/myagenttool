import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";
import { hostApi } from "../my-hosts/host-api";
import { siteApi } from "./site-api";
import { writeGoLiveHandoff } from "./site-experience-model";
import { SiteSettingsView } from "./site-settings-view";
import type { Site, SitePilotCampaign } from "./site-types";

vi.mock("./site-api", () => ({ siteApi: {
  list: vi.fn(), get: vi.fn(), update: vi.fn(), providers: vi.fn(), publications: vi.fn(), assets: vi.fn(), configureTarget: vi.fn(), verifyTarget: vi.fn(), pilotSummary: vi.fn(),
  configureDomainTls: vi.fn(), verifyDomainDns: vi.fn(), issueDomainTlsStaging: vi.fn(),
  pilotCampaigns: vi.fn(), createPilotCampaign: vi.fn(), updatePilotCampaign: vi.fn(), deletePilotCampaign: vi.fn(), createPilotInvitation: vi.fn(),
} }));
vi.mock("../my-hosts/host-api", () => ({ hostApi: { publishScopes: vi.fn() } }));
vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => vi.fn() }));

const site: Site = {
  id: "sit_1", name: "Luna", description: "", audience: "", primaryAction: "Contact", defaultLocale: "en-US",
  status: "ready", visibility: "private_preview", activePublicationId: null, settings: {}, navigation: {}, revision: 1,
  updatedAt: "2026-08-24T00:00:00.000Z", entries: [], unpublishedCount: 0, activePublication: null,
  deploymentTarget: {
    id: "sdt_1", kind: "cloudflare_pages", status: "setup", displayName: "Global cloud hosting", capabilities: {},
    lastVerifiedAt: null, revision: 2, credentialRef: "credential://cloudflare/main", remoteProjectRef: "luna-site", customDomain: "",
  },
};

function pilotCampaign(): SitePilotCampaign {
  return {
    id: "spc_1", label: "Pilot", status: "active", inviteCode: "campaign-code", quotas: { first_setup: 5, content_maintenance: 5, status_understanding: 5 }, thresholds: { setupCompletion: 0.8, independentMaintenance: 0.8, statusUnderstanding: 0.8 }, revision: 1,
    createdAt: "2026-08-24T00:00:00.000Z", activatedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z", closedAt: null,
    summary: { sampleCount: 0, activeCount: 0, completedCount: 0, abandonedCount: 0, metrics: { setupCompletion: { numerator: 0, denominator: 0, rate: null }, independentMaintenance: { numerator: 0, denominator: 0, rate: null }, statusUnderstanding: { numerator: 0, denominator: 0, rate: null } }, privacy: { contentCollected: false, credentialsCollected: false, freeTextCollected: false, participantIdentityCollected: false } },
    readiness: { setupCompletion: { sampleReady: false, thresholdMet: null }, independentMaintenance: { sampleReady: false, thresholdMet: null }, statusUnderstanding: { sampleReady: false, thresholdMet: null } }, decision: "collecting",
    invitationCounts: { first_setup: { generated: 0, available: 0, active: 0, completed: 0, abandoned: 0 }, content_maintenance: { generated: 0, available: 0, active: 0, completed: 0, abandoned: 0 }, status_understanding: { generated: 0, available: 0, active: 0, completed: 0, abandoned: 0 } },
  };
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SiteSettingsView /></QueryClientProvider>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  delete window.myagenttoolDesktop;
  await i18n.changeLanguage("en-US");
  useUiStore.setState({ experienceMode: "professional" });
  vi.mocked(siteApi.list).mockResolvedValue({ sites: [site], count: 1 });
  vi.mocked(siteApi.get).mockResolvedValue({ site });
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [{
    kind: "cloudflare_pages", ordinaryLabel: "Global cloud hosting", productionReady: true, professionalOnly: false,
    connectionKind: "credential_reference", setupFlow: ["Connect account", "Select project", "Upload", "Verify", "Domain"], capabilities: {},
  }] });
  vi.mocked(siteApi.publications).mockResolvedValue({ publications: [], count: 0 });
  vi.mocked(siteApi.assets).mockResolvedValue({ assets: [], count: 0, usage: { bytes: 0, limitBytes: 500 * 1024 * 1024 } });
  vi.mocked(siteApi.pilotSummary).mockResolvedValue({ summary: { sampleCount: 0, activeCount: 0, completedCount: 0, abandonedCount: 0, metrics: { setupCompletion: { numerator: 0, denominator: 0, rate: null }, independentMaintenance: { numerator: 0, denominator: 0, rate: null }, statusUnderstanding: { numerator: 0, denominator: 0, rate: null } }, privacy: { contentCollected: false, credentialsCollected: false, freeTextCollected: false, participantIdentityCollected: false } } });
  vi.mocked(siteApi.pilotCampaigns).mockResolvedValue({ campaigns: [], count: 0 });
  vi.mocked(hostApi.publishScopes).mockResolvedValue({ scopes: [], count: 0 });
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); });

it("enables bilingual maintenance from professional settings without asking for URL rules", async () => {
  const bilingual = { ...site, revision: 2, settings: { supportedLocales: ["zh-CN", "en-US"] as Array<"zh-CN" | "en-US"> } };
  vi.mocked(siteApi.update).mockResolvedValue({ site: bilingual });
  renderView();

  expect(await screen.findByText("Content languages")).toBeTruthy();
  expect(screen.getByText(/Secondary-language pages use separate URLs/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Enable Chinese and English" }));
  await waitFor(() => expect(siteApi.update).toHaveBeenCalledWith("sit_1", {
    expectedRevision: 1,
    settings: { supportedLocales: ["zh-CN", "en-US"] },
  }));
});

it("lets a professional user test a saved hosting connection without entering a token", async () => {
  const verified = { ...site, deploymentTarget: { ...site.deploymentTarget!, status: "ready" as const, lastVerifiedAt: "2026-08-24T00:01:00.000Z" } };
  vi.mocked(siteApi.verifyTarget).mockResolvedValue({ site: verified, verification: { projectName: "luna-site" } });
  renderView();

  expect(await screen.findByDisplayValue("credential://cloudflare/main")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await waitFor(() => expect(siteApi.verifyTarget).toHaveBeenCalledWith("sit_1"));
});

it("shows real pilot rates with their ended-task denominators", async () => {
  vi.mocked(siteApi.pilotSummary).mockResolvedValue({ summary: { sampleCount: 7, activeCount: 1, completedCount: 5, abandonedCount: 1, metrics: { setupCompletion: { numerator: 3, denominator: 4, rate: 0.75 }, independentMaintenance: { numerator: 1, denominator: 2, rate: 0.5 }, statusUnderstanding: { numerator: 1, denominator: 1, rate: 1 } }, privacy: { contentCollected: false, credentialsCollected: false, freeTextCollected: false, participantIdentityCollected: false } } });
  renderView();

  expect(await screen.findByText("Real-user pilot metrics")).toBeTruthy();
  expect(screen.getByText("75%")).toBeTruthy();
  expect(screen.getByText("3/4 ended tasks")).toBeTruthy();
  expect(screen.getByText(/No participant identity, content, free text, or cloud credentials collected/)).toBeTruthy();
});

it("creates a default anonymous pilot round without participant configuration", async () => {
  vi.mocked(siteApi.createPilotCampaign).mockResolvedValue({ campaign: pilotCampaign() });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Create default pilot round" }));
  await waitFor(() => expect(siteApi.createPilotCampaign).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining("Real-user pilot") })));
});

it("generates a one-time task link instead of reusing the campaign code", async () => {
  vi.mocked(siteApi.pilotCampaigns).mockResolvedValue({ campaigns: [pilotCampaign()], count: 1 });
  vi.mocked(siteApi.createPilotInvitation).mockResolvedValue({ invitation: { id: "spi_1", campaignId: "spc_1", scenario: "first_setup", inviteCode: "one-time-code", status: "available", sessionId: null, revision: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z", startedAt: null, finishedAt: null } });
  renderView();

  expect(await screen.findByText(/isolated temporary site for 72 hours/)).toBeTruthy();
  fireEvent.click((await screen.findAllByRole("button", { name: "Generate one-time invite" }))[0]);
  await waitFor(() => expect(siteApi.createPilotInvitation).toHaveBeenCalledWith("spc_1", "first_setup"));
  const link = await screen.findByLabelText("First setup invite link") as HTMLInputElement;
  expect(link.value).toContain("sitePilot=one-time-code");
  expect(link.value).toContain("pilotTask=first_setup");
  expect(link.value).not.toContain("campaign-code");
});

it("shows Alibaba Cloud prerequisites and requires Bucket, region, and CDN domain", async () => {
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [
    {
      kind: "cloudflare_pages", ordinaryLabel: "Global cloud hosting", productionReady: true, professionalOnly: false,
      connectionKind: "credential_reference", setupFlow: ["Connect account"], capabilities: {},
    },
    {
      kind: "aliyun_oss_cdn", ordinaryLabel: "Mainland China cloud hosting", productionReady: true, professionalOnly: false,
      connectionKind: "credential_reference", setupFlow: ["Connect Alibaba Cloud", "Select Bucket"], capabilities: {},
    },
  ] });
  renderView();

  fireEvent.change(await screen.findByLabelText("Hosting method"), { target: { value: "aliyun_oss_cdn" } });

  expect(screen.getByLabelText("OSS Bucket")).toBeTruthy();
  expect(screen.getByPlaceholderText("oss-cn-hangzhou")).toBeTruthy();
  expect(screen.getByText(/enable OSS versioning and static website hosting/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save target" }).hasAttribute("disabled")).toBe(true);
});

it("selects a verified SSH publishing range without asking for another credential", async () => {
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [
    {
      kind: "cloudflare_pages", ordinaryLabel: "Global cloud hosting", productionReady: true, professionalOnly: false,
      connectionKind: "credential_reference", setupFlow: [], capabilities: {},
    },
    {
      kind: "ssh_static", ordinaryLabel: "My server", productionReady: true, professionalOnly: true,
      connectionKind: "host_file_scope_reference", setupFlow: ["Select range", "Verify", "Upload", "Switch", "Health check"], capabilities: {},
    },
  ] });
  vi.mocked(hostApi.publishScopes).mockResolvedValue({ scopes: [{
    id: "hfs_1", sshTargetId: "ssh_1", label: "Website files", purpose: "site_publish", rootPath: "/srv/www/site", resolvedRootPath: "/srv/www/site",
    permissions: ["list", "upload", "download"], status: "ready", revision: 1, lastVerifiedAt: "2026-08-24T00:00:00.000Z",
    host: { id: "ssh_1", name: "Production host", host: "host.example", connectionStatus: "ready", capabilities: { sftp: true, posixRename: true, symlink: true } },
  }], count: 1 });
  const configured = { ...site, deploymentTarget: { ...site.deploymentTarget!, kind: "ssh_static" as const, displayName: "My server", credentialRef: null, remoteProjectRef: "hfs_1", customDomain: "www.example.com" } };
  vi.mocked(siteApi.configureTarget).mockResolvedValue({ site: configured });
  renderView();

  fireEvent.change(await screen.findByLabelText("Hosting method"), { target: { value: "ssh_static" } });
  const range = await screen.findByLabelText("Site publishing range");
  await screen.findByRole("option", { name: "Production host · Website files" });
  expect(screen.queryByLabelText("Secure connection reference")).toBeNull();
  fireEvent.change(range, { target: { value: "hfs_1" } });
  fireEvent.change(screen.getByLabelText("Custom domain"), { target: { value: "www.example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Save target" }));

  await waitFor(() => expect(siteApi.configureTarget).toHaveBeenCalledWith("sit_1", expect.objectContaining({
    kind: "ssh_static", remoteProjectRef: "hfs_1", customDomain: "www.example.com", credentialRef: null,
  })));
  expect(screen.getByText(/Point the web root to current/)).toBeTruthy();
});

it("registers a private-LAN HTTPS binding separately from the SSH publishing target", async () => {
  const sshSite: Site = {
    ...site,
    deploymentTarget: {
      ...site.deploymentTarget!, kind: "ssh_static", status: "ready", displayName: "My server", credentialRef: null,
      remoteProjectRef: "hfs_1", customDomain: "lan.mytoolagent.com", revision: 3,
    },
    domainTlsBinding: null,
  };
  const withBinding: Site = {
    ...sshSite,
    domainTlsBinding: {
      id: "stb_1", hostname: "lan.mytoolagent.com", accessMode: "private_lan", status: "setup",
      lastVerifiedAt: null, renewAfter: null, notAfter: null, revision: 1, dnsProvider: "alidns",
      dnsCredentialRef: "credential://alidns/main", challenge: "dns-01",
    },
  };
  vi.mocked(siteApi.list).mockResolvedValue({ sites: [sshSite], count: 1 });
  vi.mocked(siteApi.get).mockResolvedValue({ site: sshSite });
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [{
    kind: "ssh_static", ordinaryLabel: "My server", productionReady: true, professionalOnly: true,
    connectionKind: "host_file_scope_reference", setupFlow: [], capabilities: {},
  }] });
  vi.mocked(hostApi.publishScopes).mockResolvedValue({ scopes: [{
    id: "hfs_1", sshTargetId: "ssh_1", label: "Website files", purpose: "site_publish", rootPath: "/srv/www/site", resolvedRootPath: "/srv/www/site",
    permissions: ["list", "upload", "download"], status: "ready", revision: 1, lastVerifiedAt: "2026-08-24T00:00:00.000Z",
    host: { id: "ssh_1", name: "Production host", host: "10.10.10.222", connectionStatus: "ready", capabilities: { sftp: true, posixRename: true, symlink: true } },
  }], count: 1 });
  vi.mocked(siteApi.configureDomainTls).mockResolvedValue({ site: withBinding, binding: withBinding.domainTlsBinding! });
  renderView();

  expect(await screen.findByText("Domain and HTTPS")).toBeTruthy();
  expect((screen.getByLabelText("Access scope") as HTMLSelectElement).value).toBe("public");
  fireEvent.change(screen.getByLabelText("Access scope"), { target: { value: "private_lan" } });
  fireEvent.click(screen.getByRole("button", { name: "Save domain setup" }));

  await waitFor(() => expect(siteApi.configureDomainTls).toHaveBeenCalledWith("sit_1", {
    expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "private_lan",
  }));
  expect(await screen.findByText("Certificate setup pending")).toBeTruthy();
});

it("verifies AliDNS before requesting an explicitly labeled staging certificate", async () => {
  const setupSite: Site = {
    ...site,
    deploymentTarget: {
      ...site.deploymentTarget!, kind: "ssh_static", status: "ready", displayName: "My server", credentialRef: null,
      remoteProjectRef: "hfs_1", customDomain: "lan.mytoolagent.com", revision: 3,
    },
    domainTlsBinding: {
      id: "stb_1", hostname: "lan.mytoolagent.com", accessMode: "private_lan", status: "setup",
      lastVerifiedAt: null, renewAfter: null, notAfter: null, revision: 1, dnsProvider: "alidns",
      dnsCredentialRef: "credential://alidns/main", challenge: "dns-01",
    },
  };
  const verifiedSite: Site = {
    ...setupSite,
    domainTlsBinding: { ...setupSite.domainTlsBinding!, status: "dns_ready", dnsZone: "mytoolagent.com", revision: 2, lastVerifiedAt: "2026-08-26T00:00:00.000Z" },
  };
  const issuedSite: Site = {
    ...verifiedSite,
    domainTlsBinding: {
      ...verifiedSite.domainTlsBinding!, status: "staging_ready", certificateEnvironment: "staging", revision: 4,
      certificateFingerprint: "a".repeat(64), certificateIssuer: "Fake LE Intermediate X1",
      certificateSans: ["lan.mytoolagent.com"], stagingIssuedAt: "2026-08-26T00:01:00.000Z", notAfter: "2026-11-24T00:00:00.000Z",
    },
  };
  vi.mocked(siteApi.list).mockResolvedValue({ sites: [setupSite], count: 1 });
  vi.mocked(siteApi.get).mockResolvedValue({ site: setupSite });
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [{
    kind: "ssh_static", ordinaryLabel: "My server", productionReady: true, professionalOnly: true,
    connectionKind: "host_file_scope_reference", setupFlow: [], capabilities: {},
  }] });
  vi.mocked(siteApi.verifyDomainDns).mockResolvedValue({ site: verifiedSite, binding: verifiedSite.domainTlsBinding! });
  vi.mocked(siteApi.issueDomainTlsStaging).mockResolvedValue({ site: issuedSite, binding: issuedSite.domainTlsBinding! });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Verify AliDNS access" }));
  await waitFor(() => expect(siteApi.verifyDomainDns).toHaveBeenCalledWith("sit_1", 1));
  expect(await screen.findByText("AliDNS verified")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Request test certificate" }));
  await waitFor(() => expect(siteApi.issueDomainTlsStaging).toHaveBeenCalledWith("sit_1", 2));
  expect(await screen.findByText("Test certificate issued; not deployed")).toBeTruthy();
  expect(screen.getByText(/Browsers do not trust it as a production certificate/)).toBeTruthy();
});

it("stores and removes an AliDNS AccessKey independently for SSH domain HTTPS", async () => {
  const saveAliDnsCredential = vi.fn().mockResolvedValue({ ok: true, reference: "credential://alidns/main" });
  const removeAliDnsCredential = vi.fn().mockResolvedValue({ ok: true, disconnected: true });
  window.myagenttoolDesktop = {
    getAliDnsCredentialStatus: vi.fn().mockResolvedValue({ desktop: true, secureStorage: true, stored: false, ready: false, reference: null }),
    saveAliDnsCredential,
    removeAliDnsCredential,
  };
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [
    {
      kind: "cloudflare_pages", ordinaryLabel: "Global cloud hosting", productionReady: true, professionalOnly: false,
      connectionKind: "credential_reference", setupFlow: [], capabilities: {},
    },
    {
      kind: "ssh_static", ordinaryLabel: "My server", productionReady: true, professionalOnly: true,
      connectionKind: "host_file_scope_reference", setupFlow: [], capabilities: {},
    },
  ] });
  renderView();

  fireEvent.change(await screen.findByLabelText("Hosting method"), { target: { value: "ssh_static" } });
  fireEvent.change(await screen.findByLabelText("AliDNS AccessKey ID"), { target: { value: "LTAI5dnsExampleKey" } });
  fireEvent.change(screen.getByLabelText("AliDNS AccessKey Secret"), { target: { value: "plain-dns-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Save AliDNS connection" }));

  await waitFor(() => expect(saveAliDnsCredential).toHaveBeenCalledWith({ accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "plain-dns-secret" }));
  expect(await screen.findByText("AliDNS AccessKey secured on this device")).toBeTruthy();
  expect(screen.queryByDisplayValue("plain-dns-secret")).toBeNull();
  expect(screen.getByText("credential://alidns/main")).toBeTruthy();
  expect(siteApi.configureTarget).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Remove AliDNS connection" }));
  await waitFor(() => expect(removeAliDnsCredential).toHaveBeenCalledTimes(1));
  expect(await screen.findByLabelText("AliDNS AccessKey Secret")).toBeTruthy();
});

it("stores an Alibaba Cloud AccessKey through the desktop bridge and keeps only its reference in the form", async () => {
  const saveAliyunOssCredential = vi.fn().mockResolvedValue({ ok: true, reference: "credential://aliyun/main" });
  window.myagenttoolDesktop = {
    getAliyunOssCredentialStatus: vi.fn().mockResolvedValue({ desktop: true, secureStorage: true, stored: false, ready: false, reference: null }),
    saveAliyunOssCredential,
  };
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [
    { kind: "cloudflare_pages", ordinaryLabel: "Global cloud hosting", productionReady: true, professionalOnly: false, connectionKind: "credential_reference", setupFlow: [], capabilities: {} },
    { kind: "aliyun_oss_cdn", ordinaryLabel: "Mainland China cloud hosting", productionReady: true, professionalOnly: false, connectionKind: "credential_reference", setupFlow: [], capabilities: {} },
  ] });
  renderView();
  fireEvent.change(await screen.findByLabelText("Hosting method"), { target: { value: "aliyun_oss_cdn" } });
  fireEvent.change(await screen.findByLabelText("AccessKey ID"), { target: { value: "LTAI5exampleKey" } });
  fireEvent.change(screen.getByLabelText("AccessKey Secret"), { target: { value: "plain-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Save secure connection" }));

  await waitFor(() => expect(saveAliyunOssCredential).toHaveBeenCalledWith({ accessKeyId: "LTAI5exampleKey", accessKeySecret: "plain-secret" }));
  expect(await screen.findByText("AccessKey secured on this device")).toBeTruthy();
  expect(screen.queryByDisplayValue("plain-secret")).toBeNull();
  expect(screen.getByText("credential://aliyun/main")).toBeTruthy();
});

it("clears an unavailable stored OSS credential reference", async () => {
  window.myagenttoolDesktop = {
    getAliyunOssCredentialStatus: vi.fn().mockResolvedValue({ desktop: true, secureStorage: true, stored: true, ready: false, reference: null }),
  };
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [
    { kind: "cloudflare_pages", ordinaryLabel: "Global cloud hosting", productionReady: true, professionalOnly: false, connectionKind: "credential_reference", setupFlow: [], capabilities: {} },
    { kind: "aliyun_oss_cdn", ordinaryLabel: "Mainland China cloud hosting", productionReady: true, professionalOnly: false, connectionKind: "credential_reference", setupFlow: [], capabilities: {} },
  ] });
  renderView();

  fireEvent.change(await screen.findByLabelText("Hosting method"), { target: { value: "aliyun_oss_cdn" } });

  expect(await screen.findByText("The saved OSS connection is unavailable. Enter it again to reconnect.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save target" }).hasAttribute("disabled")).toBe(true);
});

it("stores and removes a Cloudflare API Token through the desktop bridge without exposing it", async () => {
  const cloudflareSite = { ...site, deploymentTarget: { ...site.deploymentTarget!, credentialRef: null } };
  vi.mocked(siteApi.list).mockResolvedValue({ sites: [cloudflareSite], count: 1 });
  vi.mocked(siteApi.get).mockResolvedValue({ site: cloudflareSite });
  const saveCloudflareSiteCredential = vi.fn().mockResolvedValue({ ok: true, reference: "credential://cloudflare/main" });
  const removeCloudflareSiteCredential = vi.fn().mockResolvedValue({ ok: true, disconnected: true });
  window.myagenttoolDesktop = {
    getCloudflareSiteCredentialStatus: vi.fn().mockResolvedValue({ desktop: true, secureStorage: true, stored: false, ready: false, reference: null }),
    saveCloudflareSiteCredential,
    removeCloudflareSiteCredential,
  };
  renderView();

  fireEvent.change(await screen.findByLabelText("Cloudflare Account ID"), { target: { value: "0123456789abcdef0123456789abcdef" } });
  fireEvent.change(screen.getByLabelText("Cloudflare API Token"), { target: { value: "plain-cloudflare-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Save secure connection" }));

  await waitFor(() => expect(saveCloudflareSiteCredential).toHaveBeenCalledWith({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "plain-cloudflare-token" }));
  expect(await screen.findByText("Cloudflare API Token secured on this device")).toBeTruthy();
  expect(screen.queryByDisplayValue("plain-cloudflare-token")).toBeNull();
  expect(screen.getByText("credential://cloudflare/main")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
  await waitFor(() => expect(removeCloudflareSiteCredential).toHaveBeenCalledTimes(1));
  expect(await screen.findByLabelText("Cloudflare API Token")).toBeTruthy();
});

it("receives ordinary go-live choices but leaves every real cloud value empty", async () => {
  const localSite = { ...site, deploymentTarget: { ...site.deploymentTarget!, kind: "local_directory" as const, status: "ready" as const, displayName: "Local publishing", credentialRef: null, remoteProjectRef: null, region: null, customDomain: "" } };
  vi.mocked(siteApi.list).mockResolvedValue({ sites: [localSite], count: 1 });
  vi.mocked(siteApi.get).mockResolvedValue({ site: localSite });
  vi.mocked(siteApi.providers).mockResolvedValue({ providers: [
    { kind: "cloudflare_pages", ordinaryLabel: "Global cloud hosting", productionReady: true, professionalOnly: false, connectionKind: "credential_reference", setupFlow: [], capabilities: {} },
    { kind: "aliyun_oss_cdn", ordinaryLabel: "Mainland China cloud hosting", productionReady: true, professionalOnly: false, connectionKind: "credential_reference", setupFlow: [], capabilities: {} },
  ] });
  writeGoLiveHandoff({ siteId: "sit_1", audience: "mainland", address: "custom", assistance: "technical" });
  renderView();

  expect(await screen.findByText("Choices carried over from the go-live guide")).toBeTruthy();
  expect((screen.getByLabelText("Hosting method") as HTMLSelectElement).value).toBe("aliyun_oss_cdn");
  expect((await screen.findByLabelText("OSS Bucket") as HTMLInputElement).value).toBe("");
  expect((await screen.findByPlaceholderText("oss-cn-hangzhou") as HTMLInputElement).value).toBe("");
  expect((await screen.findByLabelText("Custom domain") as HTMLInputElement).value).toBe("");
});
