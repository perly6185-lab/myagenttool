import { realpathSync, statSync } from "node:fs";
import { extname } from "node:path";

export function registerPrivateTutorMaterialPicker({ ipcMain, dialog, getWindow, requestServer }) {
  ipcMain.removeHandler("private-tutor:import-local-material");
  ipcMain.handle("private-tutor:import-local-material", async (_event, input = {}) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "选择本地教材 PDF",
      properties: ["openFile"],
      filters: [{ name: "PDF 教材", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = realpathSync(result.filePaths[0]);
    if (!statSync(path).isFile() || extname(path).toLowerCase() !== ".pdf") {
      throw new Error("请选择有效的 PDF 教材。");
    }
    return requestServer({
      path,
      startOcr: input.startOcr === true,
      cloudAllowed: input.cloudAllowed === true,
    });
  });
}
