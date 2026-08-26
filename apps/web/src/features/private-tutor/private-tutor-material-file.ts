export type PrivateTutorMaterialFileType = "markdown" | "pdf" | "plain_text";

export async function readPrivateTutorMaterialFile(file: File, fileType: PrivateTutorMaterialFileType) {
  if (fileType !== "pdf") {
    return { fileContent: await readFileAsText(file), fileEncoding: "utf8" as const };
  }
  const dataUrl = await readFileAsDataUrl(file);
  if (!/^data:[^,]*;base64,/i.test(dataUrl)) {
    throw new Error("PDF 文件读取失败，请重新选择文件。");
  }
  return {
    fileContent: dataUrl.slice(dataUrl.indexOf(",") + 1),
    fileEncoding: "base64" as const,
  };
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取所选文件。"));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("无法读取所选文件。"));
    reader.readAsText(file, "utf-8");
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取所选文件。"));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("无法读取所选文件。"));
    reader.readAsDataURL(file);
  });
}
