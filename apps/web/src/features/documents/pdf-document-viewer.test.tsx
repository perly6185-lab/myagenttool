import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PdfDocumentViewer } from "@/features/documents/pdf-document-viewer";

const mocks = vi.hoisted(() => ({
  projectPdfData: vi.fn(),
  destroy: vi.fn(async () => undefined),
  cancel: vi.fn(),
  render: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({ api: { projectPdfData: mocks.projectPdfData } }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/pdf.worker.mjs" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    destroy: mocks.destroy,
    promise: Promise.resolve({
      numPages: 3,
      getPage: async (page: number) => ({
        getViewport: () => ({ width: 400, height: 600 }),
        render: mocks.render,
        getTextContent: async () => ({ items: [{ str: page === 2 ? "Needle needle" : "Other text" }] }),
      }),
    }),
  }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("loads an authenticated project PDF and renders its first page", async () => {
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(8));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/report.pdf" worktreeId="wt_1" />);
  expect(screen.getByText("Loading PDF…")).toBeTruthy();
  expect(await screen.findByText("1 / 3")).toBeTruthy();
  expect(mocks.projectPdfData).toHaveBeenCalledWith("prj_1", "docs/report.pdf", "wt_1");
  expect(mocks.render).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.getByLabelText("Page 1 of 3")).toBeTruthy());
});

it("supports paging, zoom, fit width, and text-search page navigation without refetching", async () => {
  mocks.projectPdfData.mockResolvedValue(new ArrayBuffer(8));
  mocks.render.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  render(<PdfDocumentViewer projectId="prj_1" path="docs/report.pdf" />);
  await screen.findByText("1 / 3");
  fireEvent.click(screen.getByLabelText("Next page"));
  expect(await screen.findByText("2 / 3")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Zoom in"));
  expect(await screen.findByText("125%")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Fit width"));
  expect(await screen.findByText("Fit")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search PDF text"), { target: { value: "needle" } });
  fireEvent.click(screen.getByText("Find"));
  expect(await screen.findByText("1/2")).toBeTruthy();
  fireEvent.click(screen.getByText("Next"));
  expect(await screen.findByText("2/2")).toBeTruthy();
  expect(mocks.projectPdfData).toHaveBeenCalledOnce();
});

it("shows a contained error instead of replacing the Documents page", async () => {
  mocks.projectPdfData.mockRejectedValue(new Error("PDF was not found"));
  render(<PdfDocumentViewer projectId="prj_1" path="missing.pdf" />);
  expect((await screen.findByRole("alert")).textContent).toContain("PDF was not found");
});
