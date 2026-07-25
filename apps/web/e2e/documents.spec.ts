import { expect, test, type Page } from "playwright/test";
import { createHash } from "node:crypto";

const searchablePdf = createSearchablePdf();
const protectedPdf = createEncryptedPdf("secret");
const pdfRanges: string[] = [];

const state = {
  currentProjectId: "prj_1",
  projects: [{ id: "prj_1", name: "E2E Project", git: { repoPath: "/projects/e2e" } }],
  worktrees: [{ id: "wt_1", projectId: "prj_1", branchName: "documents-e2e", path: "/projects/e2e/.worktrees/documents" }],
  device: { id: "dev_1", name: "Test device", status: "online" },
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/state") return route.fulfill({ json: state });
    if (url.pathname.endsWith("/documents")) return route.fulfill({ json: { projectId: "prj_1", worktreeId: url.searchParams.get("worktree"), truncated: false, scanned: 4, documents: [
      { projectId: "prj_1", worktreeId: url.searchParams.get("worktree"), name: "report.docx", path: "docs/report.docx", type: "docx", gitStatus: "clean" },
      { projectId: "prj_1", worktreeId: url.searchParams.get("worktree"), name: "searchable.pdf", path: "docs/searchable.pdf", type: "pdf", gitStatus: "clean" },
      { projectId: "prj_1", worktreeId: url.searchParams.get("worktree"), name: "protected.pdf", path: "docs/protected.pdf", type: "pdf", gitStatus: "clean" },
      { projectId: "prj_1", worktreeId: url.searchParams.get("worktree"), name: "deterministic.dxf", path: "drawings/deterministic.dxf", type: "dxf", gitStatus: "clean" },
    ] } });
    if (url.pathname.endsWith("/cad-document/layout")) return route.fulfill({ json: { path: "drawings/deterministic.dxf", size: 384, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 50L100 50L100 0" fill="none" stroke="white"/><text x="10" y="40" fill="white">Lobby</text></svg>' } });
    if (url.pathname.endsWith("/cad-document")) return route.fulfill({ json: { path: "drawings/deterministic.dxf", size: 384, version: "AC1027", units: 6, extents: { min: [0, 0, 0], max: [100, 50, 0] }, layouts: ["Model"], layers: ["Walls", "Notes"], entityCounts: { LINE: 2, TEXT: 1 }, texts: [{ text: "Lobby", type: "TEXT", layer: "Notes" }], warnings: [], audit: { errors: 0, fixes: 0 } } });
    if (url.pathname.endsWith("/pdf-document")) {
      const pdf = url.searchParams.get("path")?.endsWith("protected.pdf") ? protectedPdf : searchablePdf;
      const range = request.headers().range;
      expect(request.headers().authorization).toBe("Bearer e2e-token");
      if (!range) return route.fulfill({ status: 200, body: pdf, headers: pdfHeaders(pdf.length) });
      pdfRanges.push(range);
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return route.fulfill({ status: 416, headers: { "Content-Range": `bytes */${pdf.length}` } });
      const start = Number(match[1]); const end = Math.min(match[2] ? Number(match[2]) : pdf.length - 1, pdf.length - 1);
      return route.fulfill({ status: 206, body: pdf.subarray(start, end + 1), headers: { ...pdfHeaders(end - start + 1), "Content-Range": `bytes ${start}-${end}/${pdf.length}` } });
    }
    if (url.pathname.endsWith("/officecli-preview")) return route.fulfill({ json: { path: "docs/report.docx", content: "<h1>Quarterly report</h1>", mime: "text/html", encoding: "utf8", bytes: 25 } });
    if (url.pathname === "/api/approvals/grants") return route.fulfill({ json: { grantId: "grant_1", token: "token_1", expiresAt: "2099-01-01" } });
    if (url.pathname.includes("/capabilities/") && url.pathname.endsWith("/invocations")) return route.fulfill({ json: { capability: "app.app_officecli.apply.create", invocationId: "inv_1", status: "queued" } });
    return route.fulfill({ json: {} });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("myagenttool.token", "e2e-token");
    window.myagenttoolDesktop = { pickLocalOfficeDocument: async () => ({ selectionId: "sel_1", absolutePath: "/projects/e2e/docs/report.docx", name: "report.docx", type: "docx", size: 100 }) };
  });
  await mockApi(page);
  await page.goto("/?section=documents");
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  pdfRanges.length = 0;
});

test("opens a project-local document without uploading or copying it", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") requests.push(request.url()); });
  await page.getByRole("button", { name: "Open local document" }).click();
  await expect(page).toHaveURL(/document=docs%2Freport.docx/);
  expect(requests.some((url) => url.includes("office-document-import"))).toBe(false);
});

test("discovers and previews a document through the real route", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "report.docx" }).click();
  await expect(page.locator('iframe[title="docs/report.docx"]')).toBeVisible();
  await expect(page).toHaveURL(/section=documents.*document=docs%2Freport.docx/);
  await page.screenshot({ path: testInfo.outputPath("documents-desktop.png"), fullPage: true });
});

test("creates an Excel document through the governed capability flow", async ({ page }) => {
  const capabilityRequest = page.waitForRequest((request) => request.url().includes("app.app_officecli.apply.create") && request.method() === "POST");
  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "New Office document" });
  await dialog.getByLabel("Document type").selectOption("xlsx");
  await dialog.getByLabel("Destination in worktree").fill("docs/forecast");
  await dialog.getByRole("button", { name: "Create document" }).click();
  const request = await capabilityRequest;
  expect(await request.postDataJSON()).toMatchObject({ projectId: "prj_1", worktreeId: "wt_1", file: "docs/forecast.xlsx", approvalToken: "token_1" });
  await expect(dialog).toBeHidden();
});

test("records real-user performance for the loaded workflow", async ({ page }) => {
  const fcp = await expect.poll(
    () => page.evaluate(() => window.__myagenttoolPerformance?.FCP?.value ?? null),
  ).not.toBeNull();
  void fcp;
  const snapshot = await page.evaluate(() => window.__myagenttoolPerformance);
  expect(snapshot?.FCP?.value).toBeLessThan(3_000);
  expect(snapshot?.FCP?.path).toContain("section=documents");
});

test("supports keyboard-only navigation and restores focus after the command palette", async ({ page }) => {
  const opener = page.getByRole("button", { name: "New" });
  await opener.focus();
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: /command|section|navigation/i });
  await expect(palette).toBeVisible();
  const search = palette.getByRole("combobox");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(opener).toBeFocused();

  await page.keyboard.press("Control+K");
  await search.fill("Canvas");
  await expect(palette.getByRole("option", { name: /Canvas/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=canvas/);
});

test("keeps the primary mobile workflow usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const section = page.getByLabel("Section", { exact: true });
  await expect(section).toBeVisible();
  await expect(section).toHaveValue("");
  await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Trace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }))).toEqual({ viewport: 390, content: 390 });
});

test("loads and searches a multi-page PDF through authenticated byte ranges", async ({ page }) => {
  await page.getByRole("button", { name: "searchable.pdf" }).click();
  await expect(page.getByLabel("Page 1 of 2")).toBeVisible();
  await page.getByLabel("Search PDF text").fill("searchable");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("1/2")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByLabel("Page 2 of 2")).toBeVisible();
  expect(pdfRanges.length).toBeGreaterThan(0);
});

test("browses a deterministic DXF with layers, search, and zoom", async ({ page }, testInfo) => {
  const layoutRequests: URL[] = [];
  page.on("request", (request) => { if (request.url().includes("/cad-document/layout")) layoutRequests.push(new URL(request.url())); });
  await page.getByRole("button", { name: "deterministic.dxf" }).click();
  await expect(page.getByText("Version: AC1027")).toBeVisible();
  await expect(page.locator('iframe[title="CAD layout Model"]')).toBeVisible();
  await page.getByLabel("Search CAD text").fill("lobby");
  await expect(page.getByText("Lobby")).toBeVisible();
  await page.getByText("Walls", { exact: true }).click();
  await expect.poll(() => layoutRequests.at(-1)?.searchParams.getAll("layers")).toEqual(["Notes"]);
  expect(layoutRequests.at(-1)?.searchParams.get("layersMode")).toBe("selected");
  await page.getByLabel("Zoom in").click();
  await expect(page.getByText("125%")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cad-preview-desktop.png"), fullPage: true });
});

test("retries an incorrect password and unlocks a genuinely encrypted PDF", async ({ page }) => {
  await page.getByRole("button", { name: "protected.pdf" }).click();
  const password = page.getByLabel("PDF password");
  await expect(password).toBeVisible();
  await password.fill("wrong");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Incorrect password. Try again.")).toBeVisible();
  await page.getByLabel("PDF password").fill("secret");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByLabel("Page 1 of 1")).toBeVisible();
});

function pdfHeaders(length: number) {
  return { "Content-Type": "application/pdf", "Content-Length": String(length), "Accept-Ranges": "bytes", "Access-Control-Expose-Headers": "Accept-Ranges,Content-Length,Content-Range", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
}

function createSearchablePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    stream("BT /F1 18 Tf 72 720 Td (Searchable first page) Tj ET"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    stream("BT /F1 18 Tf 72 720 Td (Searchable second page) Tj ET"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const parts = [Buffer.from("%PDF-1.4\n% deterministic fixture\n", "ascii")];
  const offsets = [0]; let size = parts[0].length;
  objects.forEach((object, index) => { offsets.push(size); const bytes = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "ascii"); parts.push(bytes); size += bytes.length; });
  const padding = Buffer.from(`%${"fixture-padding".repeat(15_000)}\n`, "ascii"); parts.push(padding); size += padding.length;
  const xref = size;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "ascii"));
  return Buffer.concat(parts);
}

function stream(text: string) { return `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`; }

function createEncryptedPdf(password: string) {
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const pad = (value: string) => Buffer.concat([Buffer.from(value, "binary"), padding]).subarray(0, 32);
  const fileId = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const ownerKey = createHash("md5").update(pad("owner")).digest().subarray(0, 5);
  const owner = rc4(ownerKey, pad(password));
  const permissions = Buffer.from([0xfc, 0xff, 0xff, 0xff]);
  const fileKey = createHash("md5").update(Buffer.concat([pad(password), owner, permissions, fileId])).digest().subarray(0, 5);
  const user = rc4(fileKey, padding);
  const encryptObject = (number: number, data: Buffer) => {
    const suffix = Buffer.from([number & 0xff, (number >> 8) & 0xff, (number >> 16) & 0xff, 0, 0]);
    return rc4(createHash("md5").update(Buffer.concat([fileKey, suffix])).digest().subarray(0, 10), data);
  };
  const content = encryptObject(4, Buffer.from("BT /F1 18 Tf 72 720 Td (Protected fixture unlocked) Tj ET", "ascii"));
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`),
  ];
  const parts = [Buffer.from("%PDF-1.4\n% deterministic encrypted fixture\n", "ascii")]; const offsets = [0]; let size = parts[0].length;
  objects.forEach((object, index) => { offsets.push(size); const bytes = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]); parts.push(bytes); size += bytes.length; });
  const xref = size;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${fileId.toString("hex")}><${fileId.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF\n`, "ascii"));
  return Buffer.concat(parts);
}

function rc4(key: Buffer, input: Buffer) {
  const state = Array.from({ length: 256 }, (_, index) => index); let j = 0;
  for (let i = 0; i < 256; i += 1) { j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]]; }
  const output = Buffer.alloc(input.length); let i = 0; j = 0;
  for (let offset = 0; offset < input.length; offset += 1) { i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]]; output[offset] = input[offset] ^ state[(state[i] + state[j]) & 255]; }
  return output;
}
