import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { ApiError } from "@/lib/api/request";
import { useUiStore } from "@/store/ui-store";
import { MySiteView } from "./my-site-view";
import { siteApi } from "./site-api";
import type { Site } from "./site-types";

vi.mock("./site-api", () => ({
  siteApi: {
    list: vi.fn(), create: vi.fn(), getEntry: vi.fn(), updateEntry: vi.fn(), createEntry: vi.fn(),
    update: vi.fn(), preview: vi.fn(), createPublicationPlan: vi.fn(), publicationPlan: vi.fn(), confirmPublication: vi.fn(),
    publications: vi.fn(), createRollbackPlan: vi.fn(), confirmRollback: vi.fn(), assets: vi.fn(), updateAsset: vi.fn(),
    uploadAsset: vi.fn(), assetContentUrl: vi.fn((siteId: string, assetId: string) => `/assets/${siteId}/${assetId}`),
    activePilotSession: vi.fn(), startPilotSession: vi.fn(), updatePilotSession: vi.fn(), deletePilotSession: vi.fn(),
  },
}));
vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => vi.fn() }));

const starterSite: Site = {
  id: "sit_1", name: "Luna Studio", description: "Clear product stories", audience: "Teams", primaryAction: "Contact us",
  defaultLocale: "en-US", status: "setup", visibility: "private_preview", activePublicationId: null,
  settings: { theme: "ocean", brandColor: "#155eef", footerText: "© Luna" }, navigation: {}, revision: 1,
  updatedAt: "2026-08-24T00:00:00.000Z", unpublishedCount: 1, activePublication: null,
  deploymentTarget: { id: "sdt_1", kind: "local_directory", status: "ready", displayName: "Local", capabilities: {}, lastVerifiedAt: null },
  entries: [{ id: "sen_1", siteId: "sit_1", type: "page", slug: "home", title: "Home", summary: "", status: "draft", draftRevisionId: "srv_1", publishedRevisionId: null, revision: 1, hasUnpublishedChanges: true, updatedAt: "2026-08-24T00:00:00.000Z" }],
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MySiteView /></QueryClientProvider>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  await i18n.changeLanguage("en-US");
  useUiStore.setState({ experienceMode: "ordinary", workItemDetailPreference: "summary" });
  vi.mocked(siteApi.publications).mockResolvedValue({ publications: [], count: 0 });
  vi.mocked(siteApi.publicationPlan).mockResolvedValue({ plan: { id: "spp_1", kind: "publish", status: "deploying", changes: {}, progress: { stage: "preparing", completed: 0, total: 4, updatedAt: "2026-08-24T00:00:00.000Z" }, expiresAt: "2026-08-24T00:30:00.000Z" } });
  vi.mocked(siteApi.assets).mockResolvedValue({ assets: [], count: 0, usage: { bytes: 0, limitBytes: 500 * 1024 * 1024 } });
  vi.mocked(siteApi.activePilotSession).mockResolvedValue({ session: null, invitationStatus: null, assignedScenario: null });
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("MySiteView", () => {
  it("runs an opt-in pilot without collecting free text and records setup completion", async () => {
    window.history.replaceState({}, "", "/?sitePilot=campaign-code&pilotTask=first_setup");
    vi.mocked(siteApi.activePilotSession).mockResolvedValue({ session: null, invitationStatus: "available", assignedScenario: "first_setup", workspace: { isolated: true, status: "ready", expiresAt: "2026-08-27T00:00:00.000Z" } });
    const active = { id: "sps_1", scenario: "first_setup" as const, status: "active" as const, milestones: [], outcome: null, revision: 1, startedAt: "2026-08-24T00:00:00.000Z", completedAt: null, abandonedAt: null };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [], count: 0 });
    vi.mocked(siteApi.startPilotSession).mockResolvedValue({ session: active });
    vi.mocked(siteApi.create).mockResolvedValue({ site: starterSite });
    vi.mocked(siteApi.updatePilotSession).mockImplementation(async (_id, input) => ({ session: input.action === "complete"
      ? { ...active, status: "completed", revision: 3, completedAt: "2026-08-24T00:02:00.000Z", outcome: { taskCompleted: true, independent: null, statusAnswer: null, statusCorrect: null, easeRating: 4 } }
      : { ...active, revision: 2, milestones: [{ key: "site_created", at: "2026-08-24T00:01:00.000Z" }] } }));
    renderView();

    expect(await screen.findByText("Real-user pilot")).toBeTruthy();
    expect(screen.getByText(/isolated temporary site/)).toBeTruthy();
    expect(screen.getByText(/Page content, free text, accounts, and cloud credentials are never collected/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("I understand and consent to recording task milestones"));
    fireEvent.click(screen.getByRole("button", { name: "Start pilot task" }));
    await waitFor(() => expect(siteApi.startPilotSession).toHaveBeenCalledWith("first_setup", "campaign-code"));
    expect(await screen.findByText(/Pilot in progress/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Site name"), { target: { value: "Luna Studio" } });
    fireEvent.change(screen.getByLabelText("One-line introduction"), { target: { value: "Clear product stories" } });
    fireEvent.click(screen.getByRole("button", { name: "Create site" }));
    await waitFor(() => expect(siteApi.updatePilotSession).toHaveBeenCalledWith("sps_1", { expectedRevision: 1, milestone: "site_created" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete and submit" }));
    await waitFor(() => expect(siteApi.updatePilotSession).toHaveBeenCalledWith("sps_1", expect.objectContaining({ expectedRevision: 2, action: "complete", outcome: expect.objectContaining({ taskCompleted: true, easeRating: 4 }) })));
  });

  it("guides an ordinary user through private initial setup", async () => {
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [], count: 0 });
    vi.mocked(siteApi.create).mockResolvedValue({ site: starterSite });
    renderView();

    expect(await screen.findByText("Create your website in two minutes")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Site name"), { target: { value: "Luna Studio" } });
    fireEvent.change(screen.getByLabelText("One-line introduction"), { target: { value: "Clear product stories" } });
    fireEvent.click(screen.getByRole("button", { name: "Create site" }));

    await waitFor(() => expect(siteApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Luna Studio" })));
    expect(await screen.findByText("Content management")).toBeTruthy();
    expect(screen.getByText("Website publishing progress")).toBeTruthy();
    expect(screen.getByText("Content ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview website" })).toBeTruthy();
  });

  it("keeps professional deployment settings out of ordinary view", async () => {
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    renderView();

    expect(await screen.findByText("Luna Studio")).toBeTruthy();
    expect(screen.getByText("First publication pending · Ready content: 1")).toBeTruthy();
    expect(screen.getByText("Page")).toBeTruthy();
    expect(screen.queryByText("/ · Page")).toBeNull();
    expect(screen.queryByRole("button", { name: "Professional settings" })).toBeNull();
    useUiStore.getState().setExperienceMode("professional");
    expect(await screen.findByRole("button", { name: "Professional settings" })).toBeTruthy();
    expect(screen.getByText("/ · Page")).toBeTruthy();
  });

  it("tells an ordinary user when a saved LAN domain still needs HTTPS setup", async () => {
    const lanSite: Site = {
      ...starterSite,
      deploymentTarget: { ...starterSite.deploymentTarget!, kind: "ssh_static", displayName: "My server" },
      domainTlsBinding: {
        hostname: "lan.mytoolagent.com", accessMode: "private_lan", status: "setup",
        lastVerifiedAt: null, renewAfter: null, notAfter: null,
      },
    };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [lanSite], count: 1 });
    renderView();

    expect(await screen.findByText("Website domain saved; HTTPS is not finished yet")).toBeTruthy();
    expect(screen.getByText("Private LAN")).toBeTruthy();
    expect(screen.getByText(/Visitors can use HTTPS after certificate issuance/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
    expect(useUiStore.getState().experienceMode).toBe("professional");
  });

  it("does not present a staging certificate as trusted website HTTPS", async () => {
    const stagingSite: Site = {
      ...starterSite,
      deploymentTarget: { ...starterSite.deploymentTarget!, kind: "ssh_static", displayName: "My server" },
      domainTlsBinding: {
        hostname: "lan.mytoolagent.com", accessMode: "private_lan", status: "staging_ready",
        lastVerifiedAt: "2026-08-26T00:00:00.000Z", renewAfter: "2026-10-25T00:00:00.000Z", notAfter: "2026-11-24T00:00:00.000Z",
      },
    };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [stagingSite], count: 1 });
    renderView();

    expect(await screen.findByText("Test certificate issued; website HTTPS is not active")).toBeTruthy();
    expect(screen.getByText(/Browsers do not trust it/)).toBeTruthy();
    expect(screen.queryByText("Secure website connection is active")).toBeNull();
  });

  it("explains that a server-verified staging certificate is still not production HTTPS", async () => {
    const stagingSite: Site = {
      ...starterSite,
      deploymentTarget: { ...starterSite.deploymentTarget!, kind: "ssh_static", displayName: "My server" },
      domainTlsBinding: {
        hostname: "lan.mytoolagent.com", accessMode: "private_lan", status: "staging_deployed",
        lastVerifiedAt: "2026-08-26T00:02:00.000Z", renewAfter: "2026-10-25T00:00:00.000Z", notAfter: "2026-11-24T00:00:00.000Z",
      },
    };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [stagingSite], count: 1 });
    renderView();

    expect(await screen.findByText("Test certificate passed server verification")).toBeTruthy();
    expect(screen.getByText(/still untrusted by browsers/)).toBeTruthy();
    expect(screen.queryByText("Secure website connection is active")).toBeNull();
  });

  it("lets an ordinary user create a safe second-language draft from the content list", async () => {
    const source = {
      ...starterSite.entries[0], locale: "en-US" as const, translationOf: null,
      blocks: [
        { id: "hero", type: "hero" as const, data: { eyebrow: "Studio", title: "Welcome", subtitle: "Clear stories", assetId: "sat_1", imageAlt: "Team at work" } },
        { id: "cta", type: "cta" as const, data: { title: "Start a project", description: "Tell us about it", label: "Contact us", url: "/contact/" } },
      ],
    };
    const bilingualSite: Site = {
      ...starterSite,
      settings: { ...starterSite.settings, supportedLocales: ["en-US", "zh-CN"] },
      entries: [{ ...starterSite.entries[0], locale: "en-US", translationOf: null }],
    };
    const translated = {
      ...source, id: "sen_zh", locale: "zh-CN" as const, translationOf: "sen_1", title: "首页", summary: "清晰讲好产品故事",
    };
    const withTranslation: Site = { ...bilingualSite, revision: 2, entries: [...bilingualSite.entries, translated] };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [bilingualSite], count: 1 });
    vi.mocked(siteApi.getEntry).mockImplementation(async (_siteId, entryId) => ({ entry: entryId === source.id ? source : translated }));
    vi.mocked(siteApi.createEntry).mockResolvedValue({ entry: translated, site: withTranslation });
    renderView();

    fireEvent.change(await screen.findByLabelText("Content language"), { target: { value: "zh-CN" } });
    expect(screen.getByText("Not translated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create Chinese version: Home" }));
    expect(await screen.findByRole("dialog", { name: "Create Chinese translation draft" })).toBeTruthy();
    expect(screen.getByText(/Images and safe links are retained/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Chinese title"), { target: { value: "首页" } });
    fireEvent.change(screen.getByLabelText("Chinese summary"), { target: { value: "清晰讲好产品故事" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and continue" }));

    await waitFor(() => expect(siteApi.createEntry).toHaveBeenCalledWith("sit_1", expect.objectContaining({
      type: "page",
      slug: "home",
      locale: "zh-CN",
      translationOf: "sen_1",
      title: "首页",
      summary: "清晰讲好产品故事",
      blocks: [
        expect.objectContaining({ type: "hero", data: expect.objectContaining({ title: "首页", subtitle: "清晰讲好产品故事", assetId: "sat_1", imageAlt: "" }) }),
        expect.objectContaining({ type: "cta", data: expect.objectContaining({ title: "", description: "", label: "", url: "/contact/" }) }),
      ],
    })));
    expect(await screen.findByText(/Translation draft created/)).toBeTruthy();
  });

  it("gives an ordinary user a clear go-live handoff without pretending a local release is public", async () => {
    const localRelease = {
      ...starterSite,
      activePublicationId: "spb_1",
      activePublication: { id: "spb_1", version: 1, status: "active" as const, bundleHash: "abc", createdAt: "2026-08-24T00:00:00.000Z", activatedAt: "2026-08-24T00:00:00.000Z", previousPublicationId: null, verification: { status: "healthy", checkedAt: "2026-08-24T00:00:00.000Z" } },
      unpublishedCount: 0,
    };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [localRelease], count: 1 });
    renderView();

    expect(await screen.findByText("Local version v1")).toBeTruthy();
    expect(screen.queryByText("Live version v1")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish website" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Complete go-live setup" }));
    expect(await screen.findByRole("dialog", { name: "Make your website available to visitors" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Primarily visitors in mainland China" }));
    expect(screen.getByText(/ICP filing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Use my own domain" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask a technical person to configure it" }));
    expect(screen.getByText(/No real account, Bucket, or domain details/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open setup page" }));
    expect(useUiStore.getState().experienceMode).toBe("professional");
    expect(window.sessionStorage.getItem("myagenttool-site-go-live-handoff")).toContain('"audience":"mainland"');
  });

  it("requires a reviewed publication plan before changing the live version", async () => {
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.createPublicationPlan).mockResolvedValue({ plan: { id: "spp_1", kind: "publish", status: "planned", changes: { added: ["sen_1"], changed: [], removed: [] }, checks: { errors: [], warnings: [], fileCount: 8, bytes: 1200 }, expiresAt: "2026-08-24T00:30:00.000Z" } });
    vi.mocked(siteApi.confirmPublication).mockResolvedValue({ publication: { id: "spb_1", version: 1, status: "active", bundleHash: "abc", createdAt: "2026-08-24T00:00:00.000Z", activatedAt: "2026-08-24T00:00:00.000Z", previousPublicationId: null, verification: { status: "healthy", checkedAt: "2026-08-24T00:00:00.000Z" } }, site: { ...starterSite, activePublicationId: "spb_1", activePublication: { id: "spb_1", version: 1, status: "active", bundleHash: "abc", createdAt: "2026-08-24T00:00:00.000Z", activatedAt: "2026-08-24T00:00:00.000Z", previousPublicationId: null, verification: { status: "healthy", checkedAt: "2026-08-24T00:00:00.000Z" } }, unpublishedCount: 0 } });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Publish website" }));
    expect(await screen.findByRole("dialog", { name: "Publish this website?" })).toBeTruthy();
    expect(siteApi.confirmPublication).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm publish" }));
    await waitFor(() => expect(siteApi.confirmPublication).toHaveBeenCalledWith("sit_1", "spp_1"));
    expect(await screen.findByText("A release was generated. Connect a cloud platform or host before it is reachable on the public internet.")).toBeTruthy();
  });

  it("lets an ordinary user upload and select a managed hero image", async () => {
    const asset = { id: "sat_1", siteId: "sit_1", name: "hero.png", mimeType: "image/png" as const, extension: "png" as const, size: 11, width: 1600, height: 900, focalPoint: { x: 50, y: 50 }, derivativeStatus: "ready" as const, derivatives: [{ key: "w480", width: 480, height: 270, mimeType: "image/webp" as const, extension: "webp" as const, size: 5 }], altText: "", caption: "", status: "ready" as const, revision: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.assets).mockResolvedValue({ assets: [asset], count: 1, usage: { bytes: 11, limitBytes: 500 * 1024 * 1024 } });
    vi.mocked(siteApi.getEntry).mockResolvedValue({ entry: { ...starterSite.entries[0], blocks: [{ id: "hero", type: "hero", data: { title: "Welcome" } }] } });
    vi.mocked(siteApi.uploadAsset).mockResolvedValue({ asset, deduplicated: false });
    vi.mocked(siteApi.updateAsset).mockResolvedValue({ asset: { ...asset, focalPoint: { x: 25, y: 75 }, revision: 2 } });
    vi.mocked(siteApi.updateEntry).mockResolvedValue({ entry: starterSite.entries[0], site: starterSite });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Edit: Home" }));
    const file = new File([new Uint8Array([1, 2, 3])], "hero.png", { type: "image/png" });
    fireEvent.change(await screen.findByLabelText("Upload image"), { target: { files: [file] } });
    await waitFor(() => expect(siteApi.uploadAsset).toHaveBeenCalledWith("sit_1", file));
    fireEvent.change(await screen.findByLabelText("Horizontal focus position"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Vertical focus position"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save image position" }));
    await waitFor(() => expect(siteApi.updateAsset).toHaveBeenCalledWith("sit_1", "sat_1", { expectedRevision: 1, focalPoint: { x: 25, y: 75 } }));
    fireEvent.change(screen.getByLabelText("Hero image"), { target: { value: "sat_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(siteApi.updateEntry).toHaveBeenCalledWith("sit_1", "sen_1", expect.objectContaining({ blocks: [expect.objectContaining({ data: expect.objectContaining({ assetId: "sat_1" }) })] })));
  });

  it("guides an ordinary user from case facts to a saved preview without asking for a URL", async () => {
    const caseEntry = { id: "sen_case", siteId: "sit_1", type: "case" as const, slug: "case-auto", title: "Northwind conversion project", summary: "More visitors completed an inquiry.", status: "draft" as const, draftRevisionId: "srv_case", publishedRevisionId: null, revision: 1, hasUnpublishedChanges: true, updatedAt: "2026-08-24T00:00:00.000Z" };
    const withCase = { ...starterSite, revision: 2, unpublishedCount: 3, entries: [...starterSite.entries, caseEntry] };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.createEntry).mockResolvedValue({ entry: caseEntry, site: withCase, caseShowcaseAdded: true });
    vi.mocked(siteApi.preview).mockResolvedValue({ preview: { path: "case-auto/index.html", html: "<html><body>Northwind conversion project</body></html>", styles: "", assetPaths: {}, bundleHash: "case", files: [] } });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Add case" }));
    expect(screen.queryByLabelText("URL name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Case title"), { target: { value: "Northwind conversion project" } });
    fireEvent.change(screen.getByLabelText("One-line outcome"), { target: { value: "More visitors completed an inquiry." } });
    fireEvent.change(screen.getByLabelText("Client or project name (optional)"), { target: { value: "Northwind" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("What problem did they face?"), { target: { value: "The service was difficult to understand." } });
    fireEvent.change(screen.getByLabelText("How did you solve it?"), { target: { value: "We reorganized the story and inquiry path." } });
    fireEvent.change(screen.getByLabelText("What was the outcome?"), { target: { value: "Visitors found the right service faster.\nMore inquiries were completed." } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/first case also adds a Featured cases section/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and preview" }));

    await waitFor(() => expect(siteApi.createEntry).toHaveBeenCalledWith("sit_1", expect.objectContaining({
      type: "case",
      slug: expect.stringMatching(/^case-/),
      title: "Northwind conversion project",
      summary: "More visitors completed an inquiry.",
      blocks: expect.arrayContaining([
        expect.objectContaining({ type: "hero", data: expect.objectContaining({ eyebrow: "Northwind" }) }),
        expect.objectContaining({ type: "rich_text", data: expect.objectContaining({ title: "Background and goal" }) }),
        expect.objectContaining({ type: "rich_text", data: expect.objectContaining({ title: "Outcome", paragraphs: ["Visitors found the right service faster.", "More inquiries were completed."] }) }),
      ]),
    })));
    expect(await screen.findByRole("dialog", { name: "Website preview" })).toBeTruthy();
    expect(screen.getByText(/saved and added to this language's home page showcase/)).toBeTruthy();
  });

  it("warns before discarding unsaved page edits and hides the URL field", async () => {
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.getEntry).mockResolvedValue({ entry: { ...starterSite.entries[0], blocks: [{ id: "hero", type: "hero", data: { title: "Welcome" } }] } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Edit: Home" }));
    expect(screen.queryByLabelText("URL name")).toBeNull();
    fireEvent.change(await screen.findByLabelText("Page title"), { target: { value: "Changed home" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("supports a 390px mobile website preview", async () => {
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.preview).mockResolvedValue({ preview: { path: "index.html", html: "<html><body>Preview</body></html>", styles: "", assetPaths: {}, bundleHash: "abc", files: [] } });
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    const frame = await screen.findByTitle("Website draft preview");
    fireEvent.click(screen.getByRole("button", { name: "Mobile preview" }));
    expect(frame.className).toContain("w-[390px]");
    expect(frame.className).not.toContain("flex-1");
  });

  it("uploads and applies a new logo directly from site style", async () => {
    const asset = { id: "sat_logo", siteId: "sit_1", name: "logo.png", mimeType: "image/png" as const, extension: "png" as const, size: 11, altText: "", caption: "", status: "ready" as const, revision: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" };
    const withLogo = { ...starterSite, revision: 3, settings: { ...starterSite.settings, logoAssetId: asset.id } };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.uploadAsset).mockResolvedValue({ asset, deduplicated: false });
    vi.mocked(siteApi.update).mockResolvedValue({ site: withLogo });
    renderView();

    fireEvent.click(await screen.findByRole("tab", { name: "Site style" }));
    expect(screen.getByLabelText("Selected site logo")).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    fireEvent.change(await screen.findByLabelText("Upload new logo"), { target: { files: [file] } });
    await waitFor(() => expect(siteApi.update).toHaveBeenCalledWith("sit_1", expect.objectContaining({ settings: expect.objectContaining({ logoAssetId: "sat_logo" }) })));
  });

  it("explains a failed publication, protects the current state, and retries from a fresh review", async () => {
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.createPublicationPlan).mockRejectedValueOnce(new ApiError("site_publication_plan_stale", "stale", 409));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Publish website" }));
    expect(await screen.findByText("This publication did not complete")).toBeTruthy();
    expect(screen.getByText(/failed release was not made public/)).toBeTruthy();

    vi.mocked(siteApi.createPublicationPlan).mockResolvedValue({ plan: { id: "spp_retry", kind: "publish", status: "planned", changes: { changed: ["sen_1"] }, checks: { errors: [], warnings: [], fileCount: 8, bytes: 1200 }, expiresAt: "2026-08-24T00:30:00.000Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and retry" }));
    expect(await screen.findByRole("dialog", { name: "Publish this website?" })).toBeTruthy();
    expect(siteApi.createPublicationPlan).toHaveBeenCalledTimes(2);
  });

  it("sends a broken cloud connection to professional setup without exposing technical fields", async () => {
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [starterSite], count: 1 });
    vi.mocked(siteApi.createPublicationPlan).mockRejectedValue(new ApiError("site_deployment_credential_unavailable", "expired", 409));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Publish website" }));
    expect(await screen.findByText(/cloud connection has expired/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check go-live settings" })).toBeTruthy();
    expect(screen.queryByText("site_deployment_credential_unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check go-live settings" }));
    expect(useUiStore.getState().experienceMode).toBe("professional");
  });

  it("shows ordinary four-step progress while a cloud publication is running", async () => {
    const cloudSite = { ...starterSite, deploymentTarget: { ...starterSite.deploymentTarget!, kind: "aliyun_oss_cdn" as const, displayName: "Mainland China cloud hosting" } };
    vi.mocked(siteApi.list).mockResolvedValue({ sites: [cloudSite], count: 1 });
    vi.mocked(siteApi.createPublicationPlan).mockResolvedValue({ plan: { id: "spp_1", kind: "publish", status: "planned", changes: { changed: ["sen_1"] }, checks: { errors: [], warnings: [], fileCount: 8, bytes: 1200 }, progress: { stage: "planned", completed: 0, total: 4, updatedAt: "2026-08-24T00:00:00.000Z" }, expiresAt: "2026-08-24T00:30:00.000Z" } });
    vi.mocked(siteApi.publicationPlan).mockResolvedValue({ plan: { id: "spp_1", kind: "publish", status: "deploying", changes: { changed: ["sen_1"] }, progress: { stage: "refreshing_cdn", completed: 3, total: 4, updatedAt: "2026-08-24T00:01:00.000Z" }, expiresAt: "2026-08-24T00:30:00.000Z" } });
    vi.mocked(siteApi.confirmPublication).mockImplementation(() => new Promise(() => {}));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Publish website" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm publish" }));

    expect(await screen.findByText("Update live site")).toBeTruthy();
    expect(await screen.findByText(/refreshing its cache/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Publishing…" })).toBeTruthy();
  });
});
