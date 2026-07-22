import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PdfDocumentViewer } from "@/features/documents/pdf-document-viewer";

const mocks = vi.hoisted(() => ({
  projectPdfData: vi.fn(),
  projectPdfSource: vi.fn(),
  destroy: vi.fn(async () => undefined),
  cancel: vi.fn(),
  render: vi.fn(),
  invokeCapability: vi.fn(),
  getViewport: vi.fn(() => ({ width: 400, height: 600 })),
  passwordHandler: undefined as undefined | ((callback: (password: string) => void, reason: number) => void),
}));

vi.mock("@/data/use-console-actions", () => ({ api: { projectPdfData: mocks.projectPdfData, projectPdfSource: mocks.projectPdfSource, invokeCapability: mocks.invokeCapability } }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => ({ data: { invocations: [], applicationResults: [], applications: [] } }), useRefreshConsoleState: () => vi.fn(async () => undefined) }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/pdf.worker.mjs" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  TextLayer: class {
    container: HTMLElement;
    constructor({ container }: { container: HTMLElement }) { this.container = container; }
    async render() { const span = document.createElement("span"); span.textContent = "Needle needle"; this.container.append(span); }
    cancel() {}
  },
  getDocument: () => ({
    set onPassword(value: (callback: (password: string) => void, reason: number) => void) { mocks.passwordHandler = value; },
    destroy: mocks.destroy,
    promise: Promise.resolve({
      numPages: 3,
      getDownloadInfo: async () => ({ length: 2048 }),
      getMetadata: async () => ({ info: { Title: "Report" } }),
      getPage: async (page: number) => ({
        getViewport: mocks.getViewport,
        render: mocks.render,
        streamTextContent: () => new ReadableStream(),
        getTextContent: async () => ({ items: [{ str: page === 2 ? "Needle needle" : "Other text" }] }),
      }),
    }),
  }),
}));

beforeEach(() => { mocks.projectPdfSource.mockResolvedValue({ url: "http://localhost/report.pdf", httpHeaders: { Authorization: "Bearer test" } }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.passwordHandler = undefined; window.history.replaceState({}, "", "/"); });

it("loads an authenticated project PDF and renders its first page", async () => {
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(8));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/report.pdf" worktreeId="wt_1" />);
  expect(screen.getByText("Loading PDF…")).toBeTruthy();
  expect(await screen.findByText("/ 3")).toBeTruthy();
  expect(mocks.projectPdfSource).toHaveBeenCalledWith("prj_1", "docs/report.pdf", "wt_1");
  expect(mocks.render).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.getByLabelText("Page 1 of 3")).toBeTruthy());
});

it("supports paging, zoom, fit width, and text-search page navigation without refetching", async () => {
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(8));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/report.pdf" />);
  await screen.findByText("/ 3");
  fireEvent.click(screen.getByLabelText("Next page"));
  await waitFor(() => expect((screen.getByLabelText("Page number") as HTMLInputElement).value).toBe("2"));
  fireEvent.click(screen.getByLabelText("Zoom in"));
  expect(await screen.findByText("125%")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Fit width"));
  expect(await screen.findByText("Fit")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search PDF text"), { target: { value: "needle" } });
  fireEvent.click(screen.getByText("Find"));
  expect(await screen.findByText("1/2")).toBeTruthy();
  expect(document.querySelectorAll("mark[data-pdf-search]")).toHaveLength(2);
  expect(document.querySelectorAll("mark[data-active=true]")).toHaveLength(1);
  fireEvent.click(screen.getByText("Next"));
  expect(await screen.findByText("2/2")).toBeTruthy();
  expect(mocks.projectPdfSource).toHaveBeenCalledOnce();
});

it("validates direct page entry before navigation", async () => {
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(8));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/report.pdf" />);
  await screen.findByText("/ 3");
  const input = screen.getByLabelText("Page number");
  fireEvent.change(input, { target: { value: "9" } });
  fireEvent.submit(input.closest("form")!);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(screen.getByLabelText("Page 3 of 3")).toBeTruthy());
});

it("syncs deep-linked pages and supports keyboard and thumbnail navigation", async () => {
  window.history.replaceState({}, "", "/?section=documents&pdfPage=2");
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(8));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/report.pdf" />);
  await waitFor(() => expect(screen.getByLabelText("Page 2 of 3")).toBeTruthy());
  fireEvent.keyDown(screen.getByLabelText("PDF preview docs/report.pdf"), { key: "End" });
  await waitFor(() => expect(screen.getByLabelText("Page 3 of 3")).toBeTruthy());
  expect(window.location.search).toContain("pdfPage=3");
  fireEvent.click(screen.getByLabelText("Show thumbnails"));
  expect(await screen.findByLabelText("PDF thumbnails")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Go to page 1"));
  await waitFor(() => expect(screen.getByLabelText("Page 1 of 3")).toBeTruthy());
  expect(window.location.search).not.toContain("pdfPage");
});

it("exposes local details and invokes only the governed pdfcpu read capabilities", async () => {
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(2048));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  mocks.invokeCapability.mockResolvedValue({ invocationId: "inv_pdf", status: "queued" });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/report.pdf" worktreeId="wt_1" />);
  await screen.findByText("/ 3");
  fireEvent.click(screen.getByLabelText("Show PDF details"));
  expect(await screen.findByText("2.0 KB")).toBeTruthy();
  expect(screen.getByText("Report")).toBeTruthy();
  fireEvent.click(screen.getByText("Validate"));
  await waitFor(() => expect(mocks.invokeCapability).toHaveBeenCalledWith("app.app_pdfcpu.wrapper.validate", { projectId: "prj_1", file: "docs/report.pdf", worktreeId: "wt_1" }));
});

it("rotates the view and submits an ephemeral password without persisting it", async () => {
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(8));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/protected.pdf" />);
  await screen.findByText("/ 3");
  fireEvent.click(screen.getByLabelText("Rotate clockwise"));
  await waitFor(() => expect(mocks.getViewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 90 })));
  const updatePassword = vi.fn();
  mocks.passwordHandler?.(updatePassword, 1);
  const input = await screen.findByLabelText("PDF password");
  fireEvent.change(input, { target: { value: "secret" } });
  fireEvent.submit(input.closest("form")!);
  expect(updatePassword).toHaveBeenCalledWith("secret");
  expect(screen.queryByLabelText("PDF password")).toBeNull();
});

it("shows a contained error instead of replacing the Documents page", async () => {
  mocks.projectPdfSource.mockRejectedValue(new Error("PDF was not found"));
  render(<PdfDocumentViewer projectId="prj_1" path="missing.pdf" />);
  expect((await screen.findByRole("alert")).textContent).toContain("PDF was not found");
});
