import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { uploadPrivateTutorMaterial, type MaterialDocument } from "../private-tutor-api";

const ACCEPTED_FILE_TYPES = ["markdown", "pdf", "plain_text"] as const;
type AcceptedFileType = (typeof ACCEPTED_FILE_TYPES)[number];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface PrivateTutorMaterialImportProps {
  onClose: () => void;
  onUploaded: (material: MaterialDocument) => void;
}

export function PrivateTutorMaterialImport({ onClose, onUploaded }: PrivateTutorMaterialImportProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    if (file.size > MAX_FILE_SIZE) {
      setError("文件大小不能超过 10MB。");
      return;
    }
    const fileName = file.name;
    const lowerName = fileName.toLowerCase();
    let fileType: AcceptedFileType = "plain_text";
    if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
      fileType = "markdown";
    } else if (lowerName.endsWith(".pdf")) {
      fileType = "pdf";
    } else if (lowerName.endsWith(".txt") || lowerName.endsWith(".text")) {
      fileType = "plain_text";
    } else {
      setError("目前仅支持 Markdown (.md)、纯文本 (.txt) 或 PDF 文档。");
      return;
    }

    setBusy(true);
    try {
      const fileContent = await file.text();
      const material = await uploadPrivateTutorMaterial({
        fileName,
        fileType,
        fileContent,
        fileSize: file.size,
      });
      onUploaded(material);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <Card className="relative mt-4 border-emerald-200 bg-emerald-50/30 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="size-4" />
      </button>
      <h3 className="text-base font-bold">导入学习资料</h3>
      <p className="mt-1 text-xs text-muted-foreground">上传你的讲义、笔记或大纲，AI 会帮你提炼知识地图，生成专属学习内容。</p>

      <div
        className={`mt-4 flex min-h-32 flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragActive ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : "border-muted-foreground/25 bg-card hover:bg-muted/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <Upload className="size-6 text-emerald-600" />
        <p className="mt-2 text-sm font-medium">拖拽文件到这里，或</p>
        <Button variant="secondary" size="sm" className="mt-3" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          {busy ? "正在上传…" : "选择文件"}
        </Button>
        <p className="mt-3 text-[10px] text-muted-foreground">支持 .md / .txt / .pdf，单文件不超过 10MB</p>
      </div>

      <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt,.text,.pdf" className="hidden" onChange={onFileInputChange} />

      {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">{error}</p> : null}
    </Card>
  );
}
