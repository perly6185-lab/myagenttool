import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyTemplateSetupWizard } from "@/features/workflow-memory/my-template-setup-wizard";

const mocks = vi.hoisted(() => ({
  listSources: vi.fn(),
  listArtifacts: vi.fn(),
  listClassifications: vi.fn(),
  listCases: vi.fn(),
  listCandidates: vi.fn(),
  listDefinitions: vi.fn(),
  scanSource: vi.fn(),
  analyzeDocuments: vi.fn(),
  confirmClassification: vi.fn(),
  discoverCases: vi.fn(),
  reviewCase: vi.fn(),
  discoverRoutine: vi.fn(),
  createDraft: vi.fn(),
  updateDefinition: vi.fn(),
  publishDefinition: vi.fn(),
  openProjectAsset: vi.fn(),
  revealProjectAsset: vi.fn(),
  projectAssetPreview: vi.fn(),
  projectAssetPreviewBytes: vi.fn(),
  officecliPreview: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    openProjectAsset: mocks.openProjectAsset,
    revealProjectAsset: mocks.revealProjectAsset,
    projectAssetPreview: mocks.projectAssetPreview,
    projectAssetPreviewBytes: mocks.projectAssetPreviewBytes,
    officecliPreview: mocks.officecliPreview,
  },
}));

vi.mock("@/features/workflow-memory/workflow-memory-api", () => ({
  workflowMemoryApi: {
    listWorkflowSources: mocks.listSources,
    listWorkflowArtifacts: mocks.listArtifacts,
    listBusinessDocumentClassifications: mocks.listClassifications,
    listBusinessCaseCandidates: mocks.listCases,
    listBusinessRoutineCandidates: mocks.listCandidates,
    listBusinessRoutineDefinitions: mocks.listDefinitions,
    scanWorkflowSource: mocks.scanSource,
    analyzeBusinessDocuments: mocks.analyzeDocuments,
    confirmBusinessDocumentClassification: mocks.confirmClassification,
    discoverBusinessCases: mocks.discoverCases,
    reviewBusinessCaseCandidate: mocks.reviewCase,
    discoverBusinessRoutine: mocks.discoverRoutine,
    createBusinessRoutineDraft: mocks.createDraft,
    updateBusinessRoutineDefinition: mocks.updateDefinition,
    publishBusinessRoutineDefinition: mocks.publishDefinition,
  },
}));

const source = {
  id: "source-1", projectId: "project-1", name: "客户询价历史", relativePath: "history",
  readMode: "supported_text", state: "active", scanState: "ready", scanRevision: 1, revision: 1,
  fileCount: 6, skippedCount: 0, truncated: false, lastScanAt: null, lastError: null,
};

const artifacts = [1, 2, 3].flatMap((number) => ([
  { id: `input-${number}`, name: `询价单-${number}.xlsx`, role: "requirement" },
  { id: `output-${number}`, name: `报价单-${number}.xlsx`, role: "delivery" },
])).map((artifact) => ({
  ...artifact,
  sourceId: source.id,
  projectId: source.projectId,
  relativePath: artifact.name,
  family: "spreadsheet",
  extension: ".xlsx",
  confirmationState: "confirmed",
  revision: 1,
}));

function renderWizard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MyTemplateSetupWizard sourceId={source.id} onBack={() => {}} onOpenAdvanced={() => {}} />
    </QueryClientProvider>,
  );
}

describe("MyTemplateSetupWizard", () => {
  let classifications: Array<Record<string, unknown>>;
  let cases: Array<Record<string, unknown>>;
  let candidates: Array<Record<string, unknown>>;
  let definitions: Array<Record<string, unknown>>;

  beforeEach(() => {
    classifications = [
      { id: "classification-1", sourceId: source.id, artifactId: "input-1", documentType: "inquiry", confidence: 0.94, confirmationState: "proposed", revision: 1 },
      { id: "classification-2", sourceId: source.id, artifactId: "output-1", documentType: "quotation", confidence: 0.91, confirmationState: "proposed", revision: 1 },
    ];
    cases = [];
    candidates = [];
    definitions = [];
    mocks.listSources.mockImplementation(async () => ({ sources: [source] }));
    mocks.listArtifacts.mockImplementation(async () => ({ artifacts }));
    mocks.listClassifications.mockImplementation(async () => ({ classifications, count: classifications.length }));
    mocks.listCases.mockImplementation(async () => ({ candidates: cases, count: cases.length }));
    mocks.listCandidates.mockImplementation(async () => ({ candidates, count: candidates.length }));
    mocks.listDefinitions.mockImplementation(async () => ({ routineDefinitions: definitions, count: definitions.length }));
    mocks.confirmClassification.mockImplementation(async (id: string) => {
      classifications = classifications.map((row) => row.id === id
        ? { ...row, confirmationState: "confirmed", revision: 2 }
        : row);
      return { classification: classifications.find((row) => row.id === id) };
    });
    mocks.discoverCases.mockImplementation(async () => {
      cases = [1, 2, 3].map((number) => ({
        id: `case-${number}`,
        sourceId: source.id,
        state: "proposed",
        revision: 1,
        artifactBindings: [
          { artifactId: `input-${number}`, documentType: "inquiry", roles: ["trigger", "input"] },
          { artifactId: `output-${number}`, documentType: "quotation", roles: ["output"] },
        ],
      }));
      return { candidates: cases, count: cases.length };
    });
    mocks.reviewCase.mockImplementation(async (id: string) => {
      cases = cases.map((row) => row.id === id ? { ...row, state: "confirmed", revision: 2 } : row);
      return { candidate: cases.find((row) => row.id === id) };
    });
    mocks.discoverRoutine.mockImplementation(async () => {
      const candidate = {
        id: "candidate-1", familyId: "family-1", sourceId: source.id, projectId: source.projectId,
        name: "客户询价报价", state: "candidate", version: 1, triggerDocumentTypes: ["inquiry"],
        confirmedCaseIds: ["case-1", "case-2", "case-3"], minimumCaseCount: 3, mandatoryCoverageThreshold: 0.8,
        confidence: 0.92, evidenceHealth: { state: "valid", issues: [], healthyCaseCount: 3 }, revision: 1,
        steps: [{ key: "generate", kind: "generate", label: "生成报价单", required: true, requirement: "mandatory", coverage: 1, supportCaseIds: ["case-1", "case-2", "case-3"], exceptionCaseIds: [], explanation: "", dependsOn: [], evidenceRefs: [], configuration: { output: "报价单 Excel" } }],
      };
      candidates = [candidate];
      return { candidate, replayed: false };
    });
    mocks.createDraft.mockImplementation(async () => {
      const definition = {
        id: "definition-1", familyId: "family-1", sourceId: source.id, projectId: source.projectId,
        name: "客户询价报价", description: "根据询价生成报价单", version: 1, state: "draft",
        discoveryCandidateId: "candidate-1", historicalCaseIds: ["case-1", "case-2", "case-3"],
        triggerDocumentTypes: ["inquiry"], confidence: 0.92, supersedesId: null, supersededById: null,
        evidenceHealth: { state: "valid", issues: [], recovery: null }, revision: 1,
        steps: [{ key: "generate", kind: "generate", label: "生成报价单", required: true, dependsOn: [], evidenceRefs: [], configuration: { output: "报价单 Excel" } }],
      };
      definitions = [definition];
      return { routineDefinition: definition, replayed: false };
    });
    mocks.updateDefinition.mockImplementation(async (_id: string, changes: Record<string, unknown>) => {
      definitions = definitions.map((row) => row.id === "definition-1"
        ? { ...row, ...changes, revision: 2 }
        : row);
      return { routineDefinition: definitions[0] };
    });
    mocks.publishDefinition.mockImplementation(async () => {
      definitions = definitions.map((row) => ({ ...row, state: "published", revision: 3 }));
      return { routineDefinition: definitions[0] };
    });
    mocks.openProjectAsset.mockResolvedValue({ opened: true, path: "cases/case-1/raw/inputs/询价单-1.xlsx" });
    mocks.revealProjectAsset.mockResolvedValue({ revealed: true, path: "cases/case-1/raw/inputs/询价单-1.xlsx" });
    mocks.projectAssetPreview.mockResolvedValue({ path: "quotation.md", family: "markdown", text: "# 客户报价单", size: 20, truncated: false });
    mocks.projectAssetPreviewBytes.mockResolvedValue(new ArrayBuffer(8));
    mocks.officecliPreview.mockResolvedValue({ path: "询价单-1.xlsx", content: "<p>询价内容</p>", mime: "text/html", encoding: "utf8", bytes: 20 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("guides an ordinary user from file review to an enabled template", async () => {
    renderWizard();
    expect(await screen.findByRole("heading", { name: "创建我的模板" })).toBeTruthy();
    expect(screen.getByText("本次学习的文件")).toBeTruthy();
    const learnedFiles = screen.getByLabelText("本次学习的文件");
    expect(within(learnedFiles).getByText("询价单-1.xlsx")).toBeTruthy();
    expect(within(learnedFiles).getByText("报价单-1.xlsx")).toBeTruthy();
    expect(screen.getByText("已复制 6 个文件")).toBeTruthy();
    expect(screen.getByText("输入 3")).toBeTruthy();
    expect(screen.getByText("输出 3")).toBeTruthy();
    expect(within(learnedFiles).getAllByText("输入文件")).toHaveLength(3);
    expect(within(learnedFiles).getAllByText("输出文件")).toHaveLength(3);
    expect(screen.getByText(/本机不可用时可自动切换到 Codex AI/)).toBeTruthy();
    fireEvent.click(within(learnedFiles).getByRole("button", { name: "预览文件：询价单-1.xlsx" }));
    await waitFor(() => expect(mocks.officecliPreview).toHaveBeenCalledWith("project-1", "询价单-1.xlsx"));
    expect(await screen.findByRole("dialog", { name: "询价单-1.xlsx" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "使用系统应用打开" }));
    await waitFor(() => expect(mocks.openProjectAsset).toHaveBeenCalledWith("project-1", "询价单-1.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(learnedFiles).getByRole("button", { name: "打开所在目录：询价单-1.xlsx" }));
    await waitFor(() => expect(mocks.revealProjectAsset).toHaveBeenCalledWith("project-1", "询价单-1.xlsx"));

    fireEvent.click(await screen.findByRole("button", { name: "确认这些文件用途" }));
    await waitFor(() => expect(mocks.confirmClassification).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByRole("button", { name: "整理成历史工作案例" }));
    await waitFor(() => expect(mocks.discoverCases).toHaveBeenCalledWith(source.id));

    const caseButtons = await screen.findAllByRole("button", { name: "这是一组工作" });
    for (const button of caseButtons) {
      fireEvent.click(button);
      await waitFor(() => expect(mocks.reviewCase).toHaveBeenCalledTimes(caseButtons.indexOf(button) + 1));
    }

    fireEvent.click(await screen.findByRole("button", { name: "总结我的处理方法" }));
    expect(await screen.findByDisplayValue("报价单 Excel")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("最后得到"), { target: { value: "正式报价单 Excel" } });
    fireEvent.change(screen.getByLabelText("第 1 步"), { target: { value: "核价并生成正式报价" } });

    fireEvent.click(screen.getByRole("button", { name: "保存并启用这个模板" }));

    expect(await screen.findByRole("heading", { name: "这个模板已经可以使用" })).toBeTruthy();
    expect(screen.getByText(/创建任务时，只要写清楚最终想得到什么/)).toBeTruthy();
    expect(screen.getByText("以后收到什么类型")).toBeTruthy();
    expect(screen.getByText("要生成什么结果")).toBeTruthy();
    expect(screen.getByText("学习依据 · 3 个输入文件")).toBeTruthy();
    expect(screen.getByText("学习依据 · 3 个输出文件")).toBeTruthy();
    expect(within(screen.getByLabelText("对应的输入文件")).getByRole("button", { name: /询价单-1.xlsx/ })).toBeTruthy();
    expect(within(screen.getByLabelText("对应的输出文件")).getByRole("button", { name: /报价单-1.xlsx/ })).toBeTruthy();
    expect(screen.getByText(/同一组安全副本，只展示关联关系，不会重复保存文件/)).toBeTruthy();
    expect(screen.getByText("模板已经保存并启用，无需继续训练。")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "返回我的模板" })).toHaveLength(2);
    expect(mocks.updateDefinition).toHaveBeenCalledWith("definition-1", expect.objectContaining({
      expectedRevision: 1,
      name: "客户询价报价",
      description: "收到：客户询价/需求\n得到：正式报价单 Excel",
    }));
    expect(mocks.publishDefinition).toHaveBeenCalledWith("definition-1", 2, true);
  });

  it("shows the learned input-output contract, source files, columns, and uncertain fields", async () => {
    definitions = [{
      id: "definition-contract", familyId: "family-contract", sourceId: source.id, projectId: source.projectId,
      name: "设备技术协议生成采购清单", description: "收到：设备技术协议 PDF\n得到：采购清单 Excel",
      version: 1, state: "draft", discoveryCandidateId: "candidate-contract", historicalCaseIds: ["case-1"],
      triggerDocumentTypes: ["other_reference"], confidence: 0.9, supersedesId: null, supersededById: null,
      evidenceHealth: { state: "valid", issues: [], recovery: null }, revision: 1,
      templateContract: {
        version: 1,
        inputSummary: "设备技术协议 PDF",
        inputFormats: ["pdf"],
        inputArtifactIds: ["input-1"],
        outputSummary: "采购清单 Excel",
        outputFormat: "xlsx",
        outputFileName: "采购清单.xlsx",
        outputArtifactIds: ["output-1"],
        outputColumns: ["序号", "品牌/厂家", "型号", "报价单价"],
        fieldMappings: [],
        uncertainFields: ["报价单价"],
      },
      steps: [
        { key: "read_inputs", kind: "extract", label: "读取并理解设备技术协议 PDF", required: true, dependsOn: [], evidenceRefs: [], configuration: { inputSummary: "设备技术协议 PDF" } },
        { key: "generate_output", kind: "generate", label: "生成采购清单 Excel", required: true, dependsOn: ["read_inputs"], evidenceRefs: [], configuration: { expectedOutput: "采购清单 Excel" } },
      ],
    }];

    renderWizard();

    expect(await screen.findByDisplayValue("设备技术协议生成采购清单")).toBeTruthy();
    expect(screen.getByDisplayValue("设备技术协议 PDF")).toBeTruthy();
    expect(screen.getByDisplayValue("采购清单 Excel")).toBeTruthy();
    expect(screen.getByText(/已识别输出结构：/)).toBeTruthy();
    expect(screen.getByText(/4 列 · 序号、品牌\/厂家、型号、报价单价/)).toBeTruthy();
    expect(screen.getByText(/报价单价.*运行时将留空并提醒确认/)).toBeTruthy();
    expect(screen.getByLabelText("收到什么对应的文件")).toBeTruthy();
    expect(screen.getByLabelText("最后得到对应的文件")).toBeTruthy();
  });

  it("previews a copied Markdown file in a modal without leaving the wizard", async () => {
    const markdownArtifact = {
      ...artifacts[0],
      id: "markdown-input",
      name: "询价单-RFQ-HIST-001.md",
      relativePath: "cases/case-1/raw/inputs/询价单-RFQ-HIST-001.md",
      extension: ".md",
      family: "markdown",
    };
    mocks.listArtifacts.mockResolvedValueOnce({ artifacts: [markdownArtifact] });
    renderWizard();

    const learnedFiles = await screen.findByLabelText("本次学习的文件");
    fireEvent.click(within(learnedFiles).getByRole("button", { name: "预览文件：询价单-RFQ-HIST-001.md" }));

    expect(await screen.findByRole("dialog", { name: "询价单-RFQ-HIST-001.md" })).toBeTruthy();
    await waitFor(() => expect(mocks.projectAssetPreview).toHaveBeenCalledWith(
      "project-1",
      "cases/case-1/raw/inputs/询价单-RFQ-HIST-001.md",
    ));
    expect(screen.getByRole("heading", { name: "客户报价单" })).toBeTruthy();
  });

  it("explains what to do when no clear input-to-result cases are found", async () => {
    classifications = classifications.map((row) => ({ ...row, confirmationState: "confirmed" }));
    mocks.discoverCases.mockResolvedValueOnce({ candidates: [], count: 0 });
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: "整理成历史工作案例" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("没有找到清晰的“输入 → 最终结果”组合"));
    expect(screen.getByRole("button", { name: "查看识别详情" })).toBeTruthy();
  });
});
